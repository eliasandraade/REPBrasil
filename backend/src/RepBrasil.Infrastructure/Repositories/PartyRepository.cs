using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Parties;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.Infrastructure.Repositories;

/// <summary>
/// SQL de partidos. Votos e válidos vêm dos agregados derivados híbridos por zona × cargo (escopos quentes e arquivados
/// respondem igual); os votos do partido são os do próprio Boletim de Urna (número do votável), sem depender do vínculo
/// de identidade das candidaturas. SQL constante; parâmetros posicionais.
/// </summary>
public class PartyRepository(ApplicationDbContext db) : IPartyRepository
{
    private async Task<IReadOnlyList<T>> Query<T>(string sql, CancellationToken ct, params object[] parameters) =>
        await db.Database.SqlQueryRaw<T>(sql, parameters).ToListAsync(ct);

    /// <summary>Cargos titulares (vice e suplentes são votados na chapa).</summary>
    private const string TicketMembers = "(2, 4, 9, 10, 12)";

    /// <summary>
    /// Complementar oficial do TSE: candidatura com "NÃO" em inserida-na-urna não estava na urna. `translate` cobre o
    /// "ã" mesmo quando o collation não converte acentos em maiúsculas.
    /// </summary>
    private const string NotInsertedInUrn = """
        translate(upper(trim((SELECT r.payload->>'inserted_in_urn' FROM electoral.candidacy_source_record r
                               WHERE r.candidacy_id = c.id AND r.record_kind = 'complement' ORDER BY r.id DESC LIMIT 1))), 'ãÃ', 'AA')
          IN ('NAO', 'N')
        """;

    public Task<IReadOnlyList<PartyOfficeRow>> OfficeStatsAsync(string uf, CancellationToken ct) =>
        Query<PartyOfficeRow>($$"""
            WITH v AS (
              SELECT m.year, m.turn, m.office_code, t.party_number, max(t.party_acronym) AS acronym,
                     sum(m.votes) FILTER (WHERE t.vote_kind = 'candidate')::bigint AS nominal,
                     sum(m.votes) FILTER (WHERE t.vote_kind = 'party_legend')::bigint AS legend,
                     (count(DISTINCT m.municipality_tse_code) FILTER (WHERE m.votes > 0))::int AS muns
                FROM electoral.votable_zone_votes_current m
                JOIN electoral.votable t ON t.id = m.votable_id AND t.vote_kind IN ('candidate', 'party_legend')
               WHERE m.uf = {0} AND t.party_number IS NOT NULL AND m.office_code NOT IN {{TicketMembers}}
               GROUP BY m.year, m.turn, m.office_code, t.party_number
            ), tot AS (
              SELECT z.year, z.turn, z.office_code, sum(z.nominal_votes + z.legend_votes)::bigint AS valid,
                     count(DISTINCT z.municipality_tse_code)::int AS muns
                FROM electoral.zone_office_totals_current z
               WHERE z.uf = {0}
               GROUP BY z.year, z.turn, z.office_code
            ), c AS (
              SELECT e.year, e.round AS turn, k.office_code, c.party_number,
                     max(c.party_acronym) AS acronym, max(c.party_name) AS name,
                     string_agg(DISTINCT c.federation_acronym, ', ') AS federations,
                     count(*)::int AS candidacies, (count(*) FILTER (WHERE c.elected))::int AS elected,
                     (count(*) FILTER (WHERE NOT coalesce({{NotInsertedInUrn}}, false)))::int AS on_ballot
                FROM electoral.candidacy c
                JOIN electoral.contest k ON k.id = c.contest_id
                JOIN electoral.election e ON e.id = k.election_id
               WHERE (k.uf = {0} OR k.scope = 'federal') AND k.office_code NOT IN {{TicketMembers}} AND c.party_number IS NOT NULL
               GROUP BY e.year, e.round, k.office_code, c.party_number
            ), keys AS (
              SELECT year, turn, office_code, party_number FROM c
              UNION
              SELECT year, turn, office_code, party_number FROM v
            )
            SELECT k.year::smallint AS "Year", k.turn::smallint AS "Round", k.office_code AS "OfficeCode",
                   coalesce(o.name, k.office_code::text) AS "OfficeName", k.party_number AS "PartyNumber",
                   coalesce(c.acronym, v.acronym) AS "PartyAcronym", c.name AS "PartyName", c.federations AS "Federations",
                   coalesce(c.candidacies, 0) AS "Candidacies", coalesce(c.elected, 0) AS "Elected",
                   -- sem BU, ou só candidaturas fora da urna e nenhum voto: votos ausentes (nunca zero)
                   CASE WHEN tot.valid IS NULL OR (coalesce(c.on_ballot, 0) = 0 AND v.party_number IS NULL) THEN NULL
                        ELSE coalesce(v.nominal, 0) END AS "NominalVotes",
                   CASE WHEN tot.valid IS NULL OR (coalesce(c.on_ballot, 0) = 0 AND v.party_number IS NULL) THEN NULL
                        ELSE coalesce(v.legend, 0) END AS "LegendVotes",
                   tot.valid AS "ValidVotes", coalesce(v.muns, 0) AS "MunicipalitiesWithVotes", coalesce(tot.muns, 0) AS "MunicipalitiesCovered"
              FROM keys k
              LEFT JOIN c ON c.year = k.year AND c.turn = k.turn AND c.office_code = k.office_code AND c.party_number = k.party_number
              LEFT JOIN v ON v.year = k.year AND v.turn = k.turn AND v.office_code = k.office_code AND v.party_number = k.party_number
              LEFT JOIN tot ON tot.year = k.year AND tot.turn = k.turn AND tot.office_code = k.office_code
              LEFT JOIN electoral.office o ON o.code = k.office_code
            """, ct, uf);

    public Task<IReadOnlyList<PartyTerritoryRow>> TerritoriesAsync(
        string uf, int year, int round, int office, IReadOnlyList<int> partyNumbers, string? municipalityTseCode, CancellationToken ct) =>
        Query<PartyTerritoryRow>($$"""
            WITH tot AS (
              SELECT z.municipality_tse_code AS mun, CASE WHEN {5} = '' THEN NULL ELSE z.zone END AS zone,
                     sum(z.nominal_votes + z.legend_votes)::bigint AS valid, count(DISTINCT z.zone)::int AS zones
                FROM electoral.zone_office_totals_current z
               WHERE z.uf = {0} AND z.year = {1} AND z.turn = {2} AND z.office_code = {3} AND ({5} = '' OR z.municipality_tse_code = {5})
               GROUP BY 1, 2
            ), expected AS (
              -- zonas do cadastro eleitoral em cada município: BU de só parte delas não vira participação
              SELECT m.tse_code AS mun, count(*)::int AS zones
                FROM electoral.zone_municipality zm
                JOIN electoral.election e ON e.id = zm.election_id
                JOIN electoral.municipality m ON m.id = zm.municipality_id
               WHERE m.state_code = {0} AND e.year = {1} AND e.round = {2} AND ({5} = '' OR m.tse_code = {5})
               GROUP BY 1
            ), v AS (
              SELECT m.municipality_tse_code AS mun, CASE WHEN {5} = '' THEN NULL ELSE m.zone END AS zone,
                     sum(m.votes) FILTER (WHERE t.vote_kind = 'candidate')::bigint AS nominal,
                     sum(m.votes) FILTER (WHERE t.vote_kind = 'party_legend')::bigint AS legend
                FROM electoral.votable_zone_votes_current m
                JOIN electoral.votable t ON t.id = m.votable_id AND t.vote_kind IN ('candidate', 'party_legend')
               WHERE m.uf = {0} AND m.year = {1} AND m.turn = {2} AND m.office_code = {3} AND t.party_number = ANY ({4})
                 AND ({5} = '' OR m.municipality_tse_code = {5})
               GROUP BY 1, 2
            ), c AS (
              SELECT k.scope, k.electoral_unit AS unit, count(*)::int AS candidacies, (count(*) FILTER (WHERE c.elected))::int AS elected,
                     (count(*) FILTER (WHERE NOT coalesce({{NotInsertedInUrn}}, false)))::int AS on_ballot
                FROM electoral.candidacy c
                JOIN electoral.contest k ON k.id = c.contest_id
                JOIN electoral.election e ON e.id = k.election_id
               WHERE (k.uf = {0} OR k.scope = 'federal') AND e.year = {1} AND e.round = {2} AND k.office_code = {3}
                 AND c.party_number = ANY ({4})
               GROUP BY 1, 2
            ), contest AS (
              -- cargo estadual/federal: o partido estava na urna se tem candidatura inserida ou voto no BU da UF
              SELECT coalesce((SELECT sum(on_ballot) FROM c WHERE c.scope <> 'municipal'), 0) > 0
                     OR EXISTS (SELECT 1 FROM v WHERE coalesce(v.nominal, 0) + coalesce(v.legend, 0) > 0) AS on_ballot
            )
            SELECT tot.mun AS "MunicipalityTseCode", mu.name AS "MunicipalityName", mu.slug AS "MunicipalitySlug",
                   mu.ibge_code AS "IbgeCode", tot.zone AS "Zone", tot.valid AS "ValidVotes",
                   coalesce(v.nominal, 0) AS "NominalVotes", coalesce(v.legend, 0) AS "LegendVotes",
                   CASE WHEN {3} IN (11, 13) THEN coalesce(c.candidacies, 0) END AS "Candidacies",
                   CASE WHEN {3} IN (11, 13) THEN coalesce(c.elected, 0) END AS "Elected",
                   CASE WHEN {3} IN (11, 13) THEN coalesce(c.on_ballot, 0) > 0 ELSE (SELECT on_ballot FROM contest) END
                     OR coalesce(v.nominal, 0) + coalesce(v.legend, 0) > 0 AS "OnBallot",
                   CASE WHEN tot.zone IS NULL THEN coalesce(x.zones, 0) ELSE 1 END AS "ZonesExpected",
                   CASE WHEN tot.zone IS NULL THEN tot.zones ELSE 1 END AS "ZonesCovered"
              FROM tot
              LEFT JOIN v ON v.mun = tot.mun AND v.zone IS NOT DISTINCT FROM tot.zone
              LEFT JOIN c ON c.scope = 'municipal' AND c.unit = tot.mun
              LEFT JOIN expected x ON x.mun = tot.mun
              LEFT JOIN electoral.municipality mu ON mu.state_code = {0} AND mu.tse_code = tot.mun
             ORDER BY tot.mun, tot.zone
            """, ct, uf, year, round, office, partyNumbers.ToArray(), municipalityTseCode ?? "");

    public Task<IReadOnlyList<PartyCandidateRow>> CandidatesAsync(
        string uf, int year, int round, int office, IReadOnlyList<int> partyNumbers, string? municipalityTseCode, int limit,
        CancellationToken ct) =>
        Query<PartyCandidateRow>("""
            WITH sel AS (
              SELECT c.id, c.politician_id, p."Slug" AS slug, c.ballot_name, c.candidate_number, c.elected, c.round_outcome,
                     CASE k.scope WHEN 'federal' THEN 'Brasil' WHEN 'state' THEN st.name ELSE mu.name END AS unit_name
                FROM electoral.candidacy c
                JOIN electoral.contest k ON k.id = c.contest_id
                JOIN electoral.election e ON e.id = k.election_id
                LEFT JOIN public."Politicians" p ON p."Id" = c.politician_id AND p."DeletedAt" IS NULL
                LEFT JOIN electoral.state st ON st.code = k.uf
                LEFT JOIN electoral.municipality mu ON k.scope = 'municipal' AND mu.state_code = k.uf AND mu.tse_code = k.electoral_unit
               WHERE e.year = {1} AND e.round = {2} AND k.office_code = {3} AND (k.uf = {0} OR k.scope = 'federal')
                 AND c.party_number = ANY ({4}) AND ({5} = '' OR k.scope <> 'municipal' OR k.electoral_unit = {5})
            ), votes AS (
              SELECT s.id, sum(m.votes)::bigint AS votes
                FROM sel s
                JOIN electoral.votable_candidacy vc ON vc.candidacy_id = s.id AND vc.uf = {0}
                JOIN electoral.votable_zone_votes_current m
                  ON m.votable_id = vc.votable_id AND m.uf = vc.uf AND m.year = {1} AND m.turn = {2} AND m.office_code = {3}
               WHERE ({5} = '' OR m.municipality_tse_code = {5})
               GROUP BY s.id
            )
            SELECT s.id AS "CandidacyId", s.politician_id AS "PoliticianId", s.slug AS "Slug", s.ballot_name AS "BallotName",
                   s.candidate_number AS "CandidateNumber", s.unit_name AS "UnitName",
                   EXISTS (SELECT 1 FROM electoral.votable_candidacy vc WHERE vc.candidacy_id = s.id AND vc.uf = {0}) AS "HasLink",
                   v.votes AS "Votes", s.elected AS "Elected", s.round_outcome AS "RoundOutcome"
              FROM sel s
              LEFT JOIN votes v ON v.id = s.id
             ORDER BY v.votes DESC NULLS LAST, s.ballot_name, s.id
             LIMIT {6}
            """, ct, uf, year, round, office, partyNumbers.ToArray(), municipalityTseCode ?? "", limit);
}
