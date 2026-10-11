using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Rankings;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.Infrastructure.Repositories;

/// <summary>
/// SQL dos rankings. Votos e totais vêm dos agregados derivados híbridos por zona × cargo
/// (<c>votable_zone_votes_current</c>, <c>zone_office_totals_current</c>): escopos quentes e arquivados respondem igual.
/// Nenhuma soma inventa zero: candidatura sem vínculo auditado tem votos NULL; bens e contas sem lançamento, NULL.
/// Parâmetros sempre posicionais; os textos interpolados são constantes.
/// </summary>
public class RankingRepository(ApplicationDbContext db) : IRankingRepository
{
    private async Task<IReadOnlyList<T>> Query<T>(string sql, CancellationToken ct, params object[] parameters) =>
        await db.Database.SqlQueryRaw<T>(sql, parameters).ToListAsync(ct);

    // {0} ano · {1} turno · {2} cargo (-1 = todos) · {3} UF · {4} município TSE ('' = UF inteira) · {5} partido ('' = todos)
    private const string Selected = """
        sel AS (
          SELECT c.id, c.ballot_name, c.party_acronym, c.party_number, c.elected, c.round_outcome, c.person_id, c.politician_id,
                 p."Slug" AS slug, e.year, e.round, k.office_code, k.office_name, k.scope, k.electoral_unit, k.tse_election_code,
                 CASE k.scope WHEN 'federal' THEN 'Brasil' WHEN 'state' THEN st.name ELSE mu.name END AS unit_name,
                 EXISTS (SELECT 1 FROM electoral.votable_candidacy vc WHERE vc.candidacy_id = c.id AND vc.uf = {3}) AS has_link
            FROM electoral.candidacy c
            JOIN electoral.contest k ON k.id = c.contest_id
            JOIN electoral.election e ON e.id = k.election_id
            LEFT JOIN public."Politicians" p ON p."Id" = c.politician_id AND p."DeletedAt" IS NULL
            LEFT JOIN electoral.state st ON st.code = k.uf
            LEFT JOIN electoral.municipality mu ON k.scope = 'municipal' AND mu.state_code = k.uf AND mu.tse_code = k.electoral_unit
           WHERE e.year = {0} AND e.round = {1} AND ({2} < 0 OR k.office_code = {2})
             AND (k.scope = 'federal' OR k.uf = {3})
             AND ({4} = '' OR k.scope <> 'municipal' OR k.electoral_unit = {4})
             AND ({5} = '' OR upper(c.party_acronym) = upper({5}) OR c.party_number::text = {5})
        )
        """;

    public Task<IReadOnlyList<RankingCandidacyRow>> CandidaciesAsync(RankingFilter f, CancellationToken ct) =>
        Query<RankingCandidacyRow>($$"""
            WITH {{Selected}},
            mun_votes AS (
              -- votos da candidatura por município do recorte (só pelo vínculo auditado votável → candidatura)
              SELECT s.id, m.municipality_tse_code AS mun, sum(m.votes)::bigint AS votes
                FROM sel s
                JOIN electoral.votable_candidacy vc ON vc.candidacy_id = s.id AND vc.uf = {3}
                JOIN electoral.votable_zone_votes_current m
                  ON m.votable_id = vc.votable_id AND m.uf = vc.uf AND m.year = s.year AND m.turn = s.round AND m.office_code = s.office_code
               WHERE ({4} = '' OR m.municipality_tse_code = {4})
               GROUP BY s.id, m.municipality_tse_code
            ), valid_mun AS (
              SELECT z.office_code, z.municipality_tse_code AS mun, sum(z.nominal_votes + z.legend_votes)::bigint AS valid
                FROM electoral.zone_office_totals_current z
               WHERE z.year = {0} AND z.turn = {1} AND z.uf = {3} AND ({2} < 0 OR z.office_code = {2})
                 AND ({4} = '' OR z.municipality_tse_code = {4})
               GROUP BY z.office_code, z.municipality_tse_code
            ), top_mun AS (
              -- mais votado de cada disputa em cada município (todos os números votados, vinculados ou não)
              SELECT x.office_code, x.election_code, x.mun, max(x.votes) AS top
                FROM (SELECT m.office_code, t.election_code, m.municipality_tse_code AS mun, m.votable_id, sum(m.votes) AS votes
                        FROM electoral.votable_zone_votes_current m
                        JOIN electoral.votable t ON t.id = m.votable_id AND t.vote_kind = 'candidate'
                       WHERE m.year = {0} AND m.turn = {1} AND m.uf = {3} AND ({2} < 0 OR m.office_code = {2})
                         AND ({4} = '' OR m.municipality_tse_code = {4})
                       GROUP BY 1, 2, 3, 4) x
               GROUP BY 1, 2, 3
            ), unit_valid AS (
              -- válidos e municípios cobertos na unidade da própria disputa ∩ recorte
              SELECT s.id, sum(v.valid)::bigint AS valid, count(v.mun)::int AS muns
                FROM sel s
                JOIN valid_mun v ON v.office_code = s.office_code AND (s.scope <> 'municipal' OR v.mun = s.electoral_unit)
               GROUP BY s.id
            ), agg AS (
              SELECT s.id, sum(mv.votes)::bigint AS votes,
                     (count(*) FILTER (WHERE mv.votes > 0))::int AS muns_with_votes,
                     (count(*) FILTER (WHERE mv.votes > 0 AND mv.votes = tm.top))::int AS muns_led
                FROM sel s
                JOIN mun_votes mv ON mv.id = s.id
                LEFT JOIN top_mun tm ON tm.office_code = s.office_code AND tm.election_code = s.tse_election_code AND tm.mun = mv.mun
               GROUP BY s.id
            ), hhi AS (
              SELECT mv.id, round(sum(power(mv.votes * 100.0 / a.votes, 2))::numeric, 2)::float8 AS hhi
                FROM mun_votes mv JOIN agg a ON a.id = mv.id
               WHERE a.votes > 0
               GROUP BY mv.id
            ), prev AS (
              -- candidatura anterior da mesma pessoa/perfil na MESMA disputa (cargo + unidade)
              SELECT s.id, pc.id AS prev_id, pc.year AS prev_year, pc.round AS prev_round
                FROM sel s
                JOIN LATERAL (
                  SELECT c2.id, e2.year, e2.round
                    FROM electoral.candidacy c2
                    JOIN electoral.contest k2 ON k2.id = c2.contest_id
                    JOIN electoral.election e2 ON e2.id = k2.election_id
                   WHERE c2.id <> s.id
                     AND ((s.person_id IS NOT NULL AND c2.person_id = s.person_id)
                          OR (s.politician_id IS NOT NULL AND c2.politician_id = s.politician_id))
                     AND (e2.year < s.year OR (e2.year = s.year AND e2.round < s.round))
                     AND k2.office_code = s.office_code AND k2.scope = s.scope AND k2.electoral_unit = s.electoral_unit
                   ORDER BY e2.year DESC, e2.round DESC
                   LIMIT 1) pc ON true
            ), prev_votes AS (
              SELECT pv.id, sum(m.votes)::bigint AS votes
                FROM prev pv
                JOIN sel s ON s.id = pv.id
                JOIN electoral.votable_candidacy vc ON vc.candidacy_id = pv.prev_id AND vc.uf = {3}
                JOIN electoral.votable_zone_votes_current m
                  ON m.votable_id = vc.votable_id AND m.uf = vc.uf AND m.year = pv.prev_year AND m.turn = pv.prev_round
                 AND m.office_code = s.office_code
               WHERE ({4} = '' OR m.municipality_tse_code = {4})
               GROUP BY pv.id
            ), prev_assets AS (
              -- declaração de bens anterior mais recente da mesma pessoa/perfil (qualquer cargo)
              SELECT s.id, pa.total, pa.year
                FROM sel s
                JOIN LATERAL (
                  SELECT sum(a.value) AS total, e2.year
                    FROM electoral.candidacy c2
                    JOIN electoral.contest k2 ON k2.id = c2.contest_id
                    JOIN electoral.election e2 ON e2.id = k2.election_id
                    JOIN electoral.candidacy_asset a ON a.candidacy_id = c2.id
                   WHERE c2.id <> s.id
                     AND ((s.person_id IS NOT NULL AND c2.person_id = s.person_id)
                          OR (s.politician_id IS NOT NULL AND c2.politician_id = s.politician_id))
                     AND e2.year < s.year
                   GROUP BY c2.id, e2.year
                   ORDER BY e2.year DESC
                   LIMIT 1) pa ON true
            )
            SELECT s.id AS "CandidacyId", s.politician_id AS "PoliticianId", s.slug AS "Slug", s.ballot_name AS "BallotName",
                   s.party_acronym AS "PartyAcronym", s.party_number AS "PartyNumber", s.elected AS "Elected",
                   s.round_outcome AS "RoundOutcome", s.office_code AS "OfficeCode", s.office_name AS "OfficeName",
                   s.scope AS "Scope", s.electoral_unit AS "ElectoralUnit", s.unit_name AS "UnitName", s.has_link AS "HasLink",
                   CASE WHEN s.has_link AND coalesce(uv.muns, 0) > 0 THEN coalesce(a.votes, 0) END AS "Votes",
                   uv.valid AS "ValidVotes",
                   coalesce(a.muns_with_votes, 0) AS "MunicipalitiesWithVotes", coalesce(uv.muns, 0) AS "MunicipalitiesCovered",
                   coalesce(a.muns_led, 0) AS "MunicipalitiesLed", h.hhi AS "Hhi",
                   (SELECT sum(x.value) FROM electoral.candidacy_asset x WHERE x.candidacy_id = s.id) AS "Assets",
                   (SELECT sum(f.amount) FROM electoral.candidacy_finance_record f WHERE f.candidacy_id = s.id AND f.record_kind = 'revenue') AS "Revenue",
                   (SELECT sum(f.amount) FROM electoral.candidacy_finance_record f WHERE f.candidacy_id = s.id AND f.record_kind = 'expense_contracted') AS "ExpenseContracted",
                   (SELECT sum(f.amount) FROM electoral.candidacy_finance_record f WHERE f.candidacy_id = s.id AND f.record_kind = 'expense_paid') AS "ExpensePaid",
                   pv.prev_id AS "PreviousCandidacyId", pv.prev_year AS "PreviousYear", pv.prev_round AS "PreviousRound",
                   pvv.votes AS "PreviousVotes", pa.total AS "PreviousAssets", pa.year AS "PreviousAssetsYear"
              FROM sel s
              LEFT JOIN agg a ON a.id = s.id
              LEFT JOIN unit_valid uv ON uv.id = s.id
              LEFT JOIN hhi h ON h.id = s.id
              LEFT JOIN prev pv ON pv.id = s.id
              LEFT JOIN prev_votes pvv ON pvv.id = s.id
              LEFT JOIN prev_assets pa ON pa.id = s.id
            """, ct, f.Year, f.Round, f.Office ?? -1, f.Uf, f.MunicipalityTseCode ?? "", f.Party ?? "");

    public Task<IReadOnlyList<RankingCoverageRow>> CoverageAsync(int office, string uf, string? municipalityTseCode, CancellationToken ct) =>
        Query<RankingCoverageRow>("""
            SELECT e.year AS "Year", e.round AS "Round", m.tse_code::text AS "MunicipalityTseCode",
                   count(*)::int AS "ZonesExpected",
                   (count(*) FILTER (WHERE EXISTS (
                      SELECT 1 FROM electoral.zone_office_totals_current z
                       WHERE z.year = e.year AND z.turn = e.round AND z.office_code = {0} AND z.uf = m.state_code
                         AND z.municipality_tse_code = m.tse_code AND z.zone = ez.zone_number)))::int AS "ZonesCovered"
              FROM electoral.zone_municipality zm
              JOIN electoral.election e ON e.id = zm.election_id
              JOIN electoral.municipality m ON m.id = zm.municipality_id
              JOIN electoral.electoral_zone ez ON ez.id = zm.zone_id
             WHERE m.state_code = {1} AND ({2} = '' OR m.tse_code = {2})
             GROUP BY e.year, e.round, m.tse_code
            """, ct, office, uf, municipalityTseCode ?? "");

    public Task<IReadOnlyList<RankingPartyRow>> PartiesAsync(RankingFilter f, bool includeLegend, CancellationToken ct) =>
        Query<RankingPartyRow>($$"""
            WITH {{Selected}},
            votes AS (
              SELECT t.party_number, max(t.party_acronym) AS party_acronym,
                     sum(m.votes) FILTER (WHERE t.vote_kind = 'candidate')::bigint AS nominal,
                     sum(m.votes) FILTER (WHERE t.vote_kind = 'party_legend')::bigint AS legend,
                     count(DISTINCT m.municipality_tse_code) FILTER (WHERE m.votes > 0)::int AS muns
                FROM electoral.votable_zone_votes_current m
                JOIN electoral.votable t ON t.id = m.votable_id AND t.vote_kind IN ('candidate', 'party_legend')
               WHERE m.year = {0} AND m.turn = {1} AND m.office_code = {2} AND m.uf = {3}
                 AND ({4} = '' OR m.municipality_tse_code = {4}) AND t.party_number IS NOT NULL
               GROUP BY t.party_number
            ), valid AS (
              SELECT sum(z.nominal_votes + z.legend_votes)::bigint AS valid
                FROM electoral.zone_office_totals_current z
               WHERE z.year = {0} AND z.turn = {1} AND z.office_code = {2} AND z.uf = {3} AND ({4} = '' OR z.municipality_tse_code = {4})
            ), cands AS (
              SELECT s.party_number, count(*)::int AS candidacies, (count(*) FILTER (WHERE s.elected))::int AS elected
                FROM sel s GROUP BY s.party_number
            )
            SELECT v.party_number AS "PartyNumber", coalesce(max(s.party_acronym), v.party_acronym) AS "PartyAcronym",
                   coalesce(v.nominal, 0) AS "NominalVotes", CASE WHEN {6} THEN coalesce(v.legend, 0) ELSE 0 END AS "LegendVotes",
                   coalesce((SELECT valid FROM valid), 0) AS "ValidVotes",
                   coalesce(c.candidacies, 0) AS "Candidacies", coalesce(c.elected, 0) AS "Elected", v.muns AS "MunicipalitiesWithVotes"
              FROM votes v
              LEFT JOIN cands c ON c.party_number = v.party_number
              LEFT JOIN sel s ON s.party_number = v.party_number
             WHERE ({5} = '' OR upper(v.party_acronym) = upper({5}) OR v.party_number::text = {5})
             GROUP BY v.party_number, v.party_acronym, v.nominal, v.legend, v.muns, c.candidacies, c.elected
            """, ct, f.Year, f.Round, f.Office ?? -1, f.Uf, f.MunicipalityTseCode ?? "", f.Party ?? "", includeLegend);

    public Task<IReadOnlyList<RankingRecurrenceRow>> RecurrenceAsync(string uf, int? office, CancellationToken ct) =>
        Query<RankingRecurrenceRow>("""
            WITH cand AS (
              SELECT coalesce(c.person_id, c.politician_id, c.id) AS subject, c.politician_id, p."Slug" AS slug,
                     coalesce(p."Name", c.full_name, c.ballot_name) AS name, c.elected, e.year, k.office_name
                FROM electoral.candidacy c
                JOIN electoral.contest k ON k.id = c.contest_id
                JOIN electoral.election e ON e.id = k.election_id
                LEFT JOIN public."Politicians" p ON p."Id" = c.politician_id AND p."DeletedAt" IS NULL
               WHERE (k.uf = {0} OR (k.scope = 'federal' AND EXISTS (
                        SELECT 1 FROM electoral.votable_candidacy vc WHERE vc.candidacy_id = c.id AND vc.uf = {0})))
                 AND ({1} < 0 OR k.office_code = {1})
                 AND k.office_code NOT IN (2, 4, 9, 10, 12)
                 AND e.round = 1
            )
            SELECT subject AS "SubjectId", max(politician_id::text)::uuid AS "PoliticianId", max(slug) AS "Slug", max(name) AS "Name",
                   count(*)::int AS "Candidacies", (count(*) FILTER (WHERE elected))::int AS "ElectedCount",
                   min(year)::smallint AS "FirstYear", max(year)::smallint AS "LastYear",
                   string_agg(DISTINCT office_name, ', ' ORDER BY office_name) AS "Offices"
              FROM cand
             GROUP BY subject
            HAVING count(*) > 1
            """, ct, uf, office ?? -1);
}
