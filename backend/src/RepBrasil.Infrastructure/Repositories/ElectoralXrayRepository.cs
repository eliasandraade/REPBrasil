using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using RepBrasil.Application.Electoral;
using RepBrasil.Application.Interfaces;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.Infrastructure.Repositories;

/// <summary>
/// Leituras do Raio X eleitoral com SQL explícito. Estado/município/zona partem dos agregados
/// derivados por zona × cargo (<c>votable_zone_votes_current</c>, <c>zone_office_totals_current</c>);
/// seção e local de votação partem dos fatos do BU, sempre só dos lotes vigentes
/// (<c>latest_bu_ingestion_run</c>). Nenhuma consulta converte ausência em zero: COALESCE(…, 0)
/// só aparece onde a urna/linha existe e a soma de um tipo de voto é de fato vazia.
/// </summary>
public class ElectoralXrayRepository(ApplicationDbContext db) : IElectoralXrayRepository
{
    private const string CandidacySelect = """
        SELECT c.id AS "Id", c.tse_candidate_id AS "TseCandidateId", c.candidate_number AS "CandidateNumber",
               c.ballot_name AS "BallotName", c.party_number AS "PartyNumber", c.party_acronym AS "PartyAcronym",
               c.party_name AS "PartyName", c.federation_acronym AS "FederationAcronym", c.coalition_name AS "CoalitionName",
               c.candidacy_status AS "CandidacyStatus", c.round_outcome AS "RoundOutcome", c.elected AS "Elected",
               c.identity_status AS "IdentityStatus", c.identity_method AS "IdentityMethod", c.person_id AS "PersonId",
               p."Id" AS "PoliticianId", p."Name" AS "PoliticianName",
               e.year AS "Year", e.round AS "Round", k.tse_election_code AS "TseElectionCode", k.office_code AS "OfficeCode",
               k.office_name AS "OfficeName", k.scope AS "Scope", k.electoral_unit AS "ElectoralUnit", k.uf::text AS "ContestUf",
               CASE k.scope WHEN 'federal' THEN 'Brasil' WHEN 'state' THEN st.name ELSE mu.name END AS "UnitName",
               f.url AS "SourceUrl", f.zip_sha256::text AS "SourceZipSha256", c.source_member AS "SourceMember",
               c.source_line AS "SourceLine",
               EXISTS (SELECT 1 FROM electoral.votable_candidacy vc WHERE vc.candidacy_id = c.id) AS "HasLink",
               (SELECT r.payload->>'inserted_in_urn' FROM electoral.candidacy_source_record r
                 WHERE r.candidacy_id = c.id AND r.record_kind = 'complement' ORDER BY r.id DESC LIMIT 1) AS "InsertedInUrn"
          FROM electoral.candidacy c
          JOIN electoral.contest k ON k.id = c.contest_id
          JOIN electoral.election e ON e.id = k.election_id
          JOIN electoral.open_data_source_file f ON f.id = c.source_file_id
          LEFT JOIN public."Politicians" p ON p."Id" = c.politician_id AND p."DeletedAt" IS NULL
          LEFT JOIN electoral.state st ON st.code = k.uf
          LEFT JOIN electoral.municipality mu ON k.scope = 'municipal' AND mu.state_code = k.uf AND mu.tse_code = k.electoral_unit
        """;

    private const string KeysCte = """
        keys AS (SELECT * FROM unnest({0}::int[], {1}::int[], {2}::int[]) AS k(year, round, office_code))
        """;

    private static NpgsqlParameter Uuids(string name, IEnumerable<Guid> ids) =>
        new(name, NpgsqlDbType.Array | NpgsqlDbType.Uuid) { Value = ids.Distinct().ToArray() };

    private static NpgsqlParameter Ints(string name, IEnumerable<int> values) =>
        new(name, NpgsqlDbType.Array | NpgsqlDbType.Integer) { Value = values.ToArray() };

    private static NpgsqlParameter Uuid(string name, Guid? value) =>
        new(name, NpgsqlDbType.Uuid) { Value = (object?)value ?? DBNull.Value };

    private async Task<IReadOnlyList<T>> Query<T>(string sql, CancellationToken ct, params object[] parameters) =>
        await db.Database.SqlQueryRaw<T>(sql, parameters).ToListAsync(ct);

    public async Task<PoliticianRefRow?> PoliticianAsync(Guid politicianId, CancellationToken ct) =>
        (await Query<PoliticianRefRow>("""
            SELECT p."Id" AS "Id", p."Name" AS "Name", p."PersonId" AS "PersonId"
              FROM public."Politicians" p WHERE p."Id" = {0} AND p."DeletedAt" IS NULL
            """, ct, politicianId)).FirstOrDefault();

    public Task<IReadOnlyList<XrayCandidacyRow>> SubjectCandidaciesAsync(Guid politicianId, Guid? personId, CancellationToken ct) =>
        Query<XrayCandidacyRow>(
            $"{CandidacySelect} WHERE c.politician_id = {{0}} OR ({{1}} IS NOT NULL AND c.person_id = {{1}})",
            ct, Uuid("politician", politicianId), Uuid("person", personId));

    public Task<IReadOnlyList<XrayCandidacyRow>> CandidaciesAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct) =>
        Query<XrayCandidacyRow>($"{CandidacySelect} WHERE c.id = ANY({{0}})", ct, Uuids("ids", candidacyIds));

    public Task<IReadOnlyList<CandidacyZoneVotesRow>> ZoneVotesAsync(
        IReadOnlyList<Guid> candidacyIds, string? uf, string? municipalityTseCode, CancellationToken ct) =>
        Query<CandidacyZoneVotesRow>("""
            SELECT vc.candidacy_id AS "CandidacyId", m.uf::text AS "Uf", m.municipality_tse_code::text AS "MunicipalityTseCode",
                   m.zone AS "Zone", sum(m.votes)::bigint AS "Votes", sum(m.urns_with_votes)::int AS "UrnsWithVotes"
              FROM electoral.votable_candidacy vc
              JOIN electoral.votable_zone_votes_current m ON m.votable_id = vc.votable_id AND m.uf = vc.uf
             WHERE vc.candidacy_id = ANY({0})
               AND ({1} = '' OR m.uf = {1}) AND ({2} = '' OR m.municipality_tse_code = {2})
             GROUP BY vc.candidacy_id, m.uf, m.municipality_tse_code, m.zone
            """, ct, Uuids("ids", candidacyIds), uf ?? "", municipalityTseCode ?? "");

    public Task<IReadOnlyList<ZoneTotalsRow>> ZoneTotalsAsync(
        IReadOnlyList<ElectionOffice> keys, string? uf, string? municipalityTseCode, CancellationToken ct) =>
        Query<ZoneTotalsRow>($$"""
            WITH {{KeysCte}}
            SELECT t.year AS "Year", t.turn AS "Round", t.office_code AS "OfficeCode", t.uf::text AS "Uf",
                   t.municipality_tse_code::text AS "MunicipalityTseCode", t.municipality_name AS "MunicipalityName",
                   t.zone AS "Zone", t.urns AS "Urns", t.eligible AS "Eligible", t.turnout AS "Turnout",
                   (t.nominal_votes + t.legend_votes)::bigint AS "ValidVotes", t.votes_total AS "VotesTotal"
              FROM electoral.zone_office_totals_current t
              JOIN keys ON keys.year = t.year AND keys.round = t.turn AND keys.office_code = t.office_code
             WHERE ({3} = '' OR t.uf = {3}) AND ({4} = '' OR t.municipality_tse_code = {4})
            """, ct, Ints("years", keys.Select(k => k.Year)), Ints("rounds", keys.Select(k => k.Round)),
            Ints("offices", keys.Select(k => k.OfficeCode)), uf ?? "", municipalityTseCode ?? "");

    public Task<IReadOnlyList<ExpectedZoneRow>> ExpectedZonesAsync(
        IReadOnlyList<(int Year, int Round)> elections, string? uf, string? municipalityTseCode, CancellationToken ct) =>
        Query<ExpectedZoneRow>("""
            WITH keys AS (SELECT * FROM unnest({0}::int[], {1}::int[]) AS k(year, round))
            SELECT e.year AS "Year", e.round AS "Round", m.state_code::text AS "Uf", m.tse_code::text AS "MunicipalityTseCode",
                   m.name AS "MunicipalityName", m.ibge_code AS "IbgeCode", z.zone_number AS "Zone"
              FROM electoral.zone_municipality zm
              JOIN electoral.election e ON e.id = zm.election_id
              JOIN keys ON keys.year = e.year AND keys.round = e.round
              JOIN electoral.municipality m ON m.id = zm.municipality_id
              JOIN electoral.electoral_zone z ON z.id = zm.zone_id
             WHERE ({2} = '' OR m.state_code = {2}) AND ({3} = '' OR m.tse_code = {3})
            """, ct, Ints("years", elections.Select(e => e.Year)), Ints("rounds", elections.Select(e => e.Round)),
            uf ?? "", municipalityTseCode ?? "");

    public Task<IReadOnlyList<ContestRankRow>> RanksAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct) =>
        Query<ContestRankRow>("""
            WITH sel AS (
                   SELECT c.id, c.candidate_number, e.year, e.round, k.office_code, k.scope, k.electoral_unit, k.uf,
                          k.tse_election_code
                     FROM electoral.candidacy c
                     JOIN electoral.contest k ON k.id = c.contest_id
                     JOIN electoral.election e ON e.id = k.election_id
                    WHERE c.id = ANY({0})),
                 numbers AS (
                   -- votos de cada NÚMERO nominal da disputa na unidade inteira (o número só é único dentro da disputa)
                   SELECT s.id AS candidacy_id, t.number, sum(m.votes)::bigint AS votes
                     FROM sel s
                     JOIN electoral.votable_zone_votes_current m
                       ON m.year = s.year AND m.turn = s.round AND m.office_code = s.office_code
                      AND (s.scope = 'federal' OR m.uf = s.uf)
                      AND (s.scope <> 'municipal' OR m.municipality_tse_code = s.electoral_unit)
                     JOIN electoral.votable t ON t.id = m.votable_id
                    WHERE t.vote_kind = 'candidate' AND t.election_code = s.tse_election_code
                    GROUP BY s.id, t.number),
                 own AS (
                   SELECT s.id AS candidacy_id, sum(m.votes)::bigint AS votes
                     FROM sel s
                     JOIN electoral.votable_candidacy vc ON vc.candidacy_id = s.id
                     JOIN electoral.votable_zone_votes_current m ON m.votable_id = vc.votable_id AND m.uf = vc.uf
                    GROUP BY s.id)
            SELECT s.id AS "CandidacyId", o.votes AS "Votes",
                   CASE WHEN o.votes IS NULL THEN NULL
                        ELSE 1 + (SELECT count(*) FROM numbers n
                                   WHERE n.candidacy_id = s.id AND n.number <> s.candidate_number AND n.votes > o.votes)::int
                   END AS "Rank",
                   (SELECT count(*) FROM numbers n WHERE n.candidacy_id = s.id AND n.votes > 0)::int AS "CandidatesWithVotes"
              FROM sel s
              LEFT JOIN own o ON o.candidacy_id = s.id
            """, ct, Uuids("ids", candidacyIds));

    public Task<IReadOnlyList<TicketRow>> TicketsAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct) =>
        Query<TicketRow>("""
            SELECT v.id AS "CandidacyId", h.id AS "HeadCandidacyId", h.ballot_name AS "HeadBallotName",
                   kh.office_code AS "HeadOfficeCode"
              FROM electoral.candidacy v
              JOIN electoral.contest kv ON kv.id = v.contest_id
              JOIN electoral.contest kh
                ON kh.election_id = kv.election_id AND kh.electoral_unit = kv.electoral_unit
               AND kh.office_code = CASE kv.office_code WHEN 2 THEN 1 WHEN 4 THEN 3 WHEN 9 THEN 5 WHEN 10 THEN 5 WHEN 12 THEN 11 END
              JOIN electoral.candidacy h ON h.contest_id = kh.id AND h.candidate_number = v.candidate_number
             WHERE v.id = ANY({0})
            """, ct, Uuids("ids", candidacyIds));

    public Task<IReadOnlyList<AssetRow>> AssetsAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct) =>
        Query<AssetRow>("""
            SELECT a.candidacy_id AS "CandidacyId", a.asset_type_code AS "TypeCode", a.asset_type AS "Type",
                   a.description AS "Description", a.value AS "Value"
              FROM electoral.candidacy_asset a
             WHERE a.candidacy_id = ANY({0})
             ORDER BY a.candidacy_id, a.value DESC, a.id
            """, ct, Uuids("ids", candidacyIds));

    public Task<IReadOnlyList<SourceRecordRow>> RecordsAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct) =>
        Query<SourceRecordRow>("""
            SELECT r.candidacy_id AS "CandidacyId", r.record_kind AS "Kind", r.payload::text AS "PayloadJson"
              FROM electoral.candidacy_source_record r
             WHERE r.candidacy_id = ANY({0}) AND r.record_kind IN ('complement', 'social_network')
             ORDER BY r.candidacy_id, r.record_kind, r.id
            """, ct, Uuids("ids", candidacyIds));

    public Task<IReadOnlyList<FinanceTotalsRow>> FinanceTotalsAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct) =>
        Query<FinanceTotalsRow>("""
            SELECT f.candidacy_id AS "CandidacyId", f.record_kind AS "RecordKind",
                   COALESCE(sum(f.amount), 0)::numeric AS "Amount", count(*)::int AS "Records",
                   max(f.payload->>'accounts_type') AS "AccountsType"
              FROM electoral.candidacy_finance_record f
             WHERE f.candidacy_id = ANY({0}) AND f.record_kind IN ('revenue', 'expense_contracted', 'expense_paid')
             GROUP BY f.candidacy_id, f.record_kind
            """, ct, Uuids("ids", candidacyIds));

    public Task<IReadOnlyList<FinanceCategoryRow>> FinanceCategoriesAsync(Guid candidacyId, CancellationToken ct) =>
        Query<FinanceCategoryRow>("""
            SELECT f.record_kind AS "RecordKind", COALESCE(f.category, 'Não informado') AS "Category",
                   COALESCE(sum(f.amount), 0)::numeric AS "Amount", count(*)::int AS "Records"
              FROM electoral.candidacy_finance_record f
             WHERE f.candidacy_id = {0} AND f.record_kind IN ('revenue', 'expense_contracted', 'expense_paid')
             GROUP BY f.record_kind, COALESCE(f.category, 'Não informado')
             ORDER BY f.record_kind, 3 DESC
            """, ct, candidacyId);

    public Task<IReadOnlyList<FinanceCounterpartyRow>> FinanceCounterpartiesAsync(
        Guid candidacyId, string recordKind, int limit, CancellationToken ct) =>
        Query<FinanceCounterpartyRow>("""
            SELECT f.record_kind AS "RecordKind", max(f.counterparty_name) AS "Name",
                   COALESCE(f.counterparty_kind, 'unidentified') AS "CounterpartyKind", f.counterparty_cnpj::text AS "Cnpj",
                   COALESCE(sum(f.amount), 0)::numeric AS "Amount", count(*)::int AS "Records"
              FROM electoral.candidacy_finance_record f
             WHERE f.candidacy_id = {0} AND f.record_kind = {1}
             -- agrupado pela identidade (HMAC do documento), que nunca sai do banco
             GROUP BY f.record_kind, COALESCE(f.counterparty_document_hash::text, 'name:' || COALESCE(f.counterparty_name, '')),
                      COALESCE(f.counterparty_kind, 'unidentified'), f.counterparty_cnpj
             ORDER BY 5 DESC, 2
             LIMIT {2}
            """, ct, candidacyId, recordKind, limit);

    public Task<IReadOnlyList<PriorRow>> PriorsAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct) =>
        Query<PriorRow>("""
            SELECT p.candidacy_id AS "CandidacyId", p.prior_year AS "PriorYear", p.prior_turn AS "PriorTurn",
                   p.prior_tse_candidate_id AS "PriorTseCandidateId", p.prior_office_code AS "PriorOfficeCode",
                   p.prior_office_name AS "PriorOfficeName", p.prior_electoral_unit AS "PriorElectoralUnit",
                   p.prior_unit_name AS "PriorUnitName", p.prior_candidate_number AS "PriorCandidateNumber",
                   p.prior_ballot_name AS "PriorBallotName", p.prior_party_acronym AS "PriorPartyAcronym",
                   p.prior_round_outcome AS "PriorRoundOutcome",
                   (SELECT c2.id FROM electoral.candidacy c2
                      JOIN electoral.contest k2 ON k2.id = c2.contest_id
                      JOIN electoral.election e2 ON e2.id = k2.election_id
                     WHERE c2.tse_candidate_id = p.prior_tse_candidate_id AND e2.year = p.prior_year AND e2.round = p.prior_turn
                     LIMIT 1) AS "ImportedCandidacyId"
              FROM electoral.candidacy_prior p
             WHERE p.candidacy_id = ANY({0})
            """, ct, Uuids("ids", candidacyIds));

    public Task<IReadOnlyList<SectionResultRow>> SectionResultsAsync(
        IReadOnlyList<ElectionOffice> keys, string uf, string municipalityTseCode, int? zone, CancellationToken ct) =>
        Query<SectionResultRow>($$"""
            WITH {{KeysCte}},
                 latest AS (
                   SELECT l.ingestion_run_id FROM electoral.latest_bu_ingestion_run l
                    WHERE l.uf = {3} AND l.municipality_tse_code = {4} AND ({5} < 0 OR l.zone = {5}))
            SELECT r.id AS "ResultId", r.year AS "Year", r.turn AS "Round", r.office_code AS "OfficeCode", r.uf::text AS "Uf",
                   r.municipality_tse_code::text AS "MunicipalityTseCode", r.municipality_name AS "MunicipalityName",
                   r.zone AS "Zone", r.section AS "Section",
                   ARRAY(SELECT DISTINCT x FROM unnest(array_prepend(r.section, COALESCE(r.aggregated_sections, ARRAY[]::integer[]))) x
                          ORDER BY x) AS "SectionMembers",
                   r.polling_place_code::text AS "PollingPlaceCode", r.eligible AS "Eligible", r.turnout AS "Turnout",
                   -- a urna existe: soma vazia de votos válidos é zero real
                   COALESCE((SELECT sum(v.votes) FROM electoral.section_office_vote v
                              JOIN electoral.votable t ON t.id = v.votable_id
                             WHERE v.result_id = r.id AND t.vote_kind IN ('candidate', 'party_legend')), 0)::bigint AS "ValidVotes"
              FROM electoral.section_office_result r
              JOIN latest ON latest.ingestion_run_id = r.ingestion_run_id
              JOIN keys ON keys.year = r.year AND keys.round = r.turn AND keys.office_code = r.office_code
             WHERE r.uf = {3} AND r.municipality_tse_code = {4} AND ({5} < 0 OR r.zone = {5})
            """, ct, Ints("years", keys.Select(k => k.Year)), Ints("rounds", keys.Select(k => k.Round)),
            Ints("offices", keys.Select(k => k.OfficeCode)), uf, municipalityTseCode, zone ?? -1);

    public Task<IReadOnlyList<SectionCandidacyVotesRow>> SectionVotesAsync(
        IReadOnlyList<Guid> candidacyIds, string uf, string municipalityTseCode, int? zone, CancellationToken ct) =>
        Query<SectionCandidacyVotesRow>("""
            SELECT v.result_id AS "ResultId", vc.candidacy_id AS "CandidacyId", sum(v.votes)::bigint AS "Votes"
              FROM electoral.votable_candidacy vc
              JOIN electoral.section_office_vote v ON v.votable_id = vc.votable_id
              JOIN electoral.section_office_result r ON r.id = v.result_id AND r.uf = vc.uf
              JOIN electoral.latest_bu_ingestion_run l ON l.ingestion_run_id = r.ingestion_run_id
             WHERE vc.candidacy_id = ANY({0}) AND r.uf = {1} AND r.municipality_tse_code = {2} AND ({3} < 0 OR r.zone = {3})
             GROUP BY v.result_id, vc.candidacy_id
            """, ct, Uuids("ids", candidacyIds), uf, municipalityTseCode, zone ?? -1);

    public Task<IReadOnlyList<PlaceNameRow>> PlacesAsync(
        IReadOnlyList<(int Year, int Round)> elections, string uf, string municipalityTseCode, int? zone, CancellationToken ct) =>
        Query<PlaceNameRow>("""
            WITH keys AS (SELECT * FROM unnest({0}::int[], {1}::int[]) AS k(year, round))
            SELECT e.year AS "Year", e.round AS "Round", m.tse_code::text AS "MunicipalityTseCode", z.zone_number AS "Zone",
                   p.tse_location_code AS "Code", p.name AS "Name",
                   public.ST_Y(p.geom) AS "Latitude", public.ST_X(p.geom) AS "Longitude"
              FROM electoral.polling_place p
              JOIN electoral.election e ON e.id = p.election_id
              JOIN keys ON keys.year = e.year AND keys.round = e.round
              JOIN electoral.municipality m ON m.id = p.municipality_id
              JOIN electoral.electoral_zone z ON z.id = p.zone_id
             WHERE m.state_code = {2} AND m.tse_code = {3} AND ({4} < 0 OR z.zone_number = {4})
            """, ct, Ints("years", elections.Select(e => e.Year)), Ints("rounds", elections.Select(e => e.Round)),
            uf, municipalityTseCode, zone ?? -1);

    public Task<IReadOnlyList<XrayCandidacyRow>> ElectionCandidaciesAsync(
        int year, int round, string uf, string? municipalityTseCode, CancellationToken ct) =>
        Query<XrayCandidacyRow>(
            $$"""
            {{CandidacySelect}}
             WHERE e.year = {0} AND e.round = {1} AND (k.scope = 'federal' OR k.uf = {2})
               AND ({3} = '' OR k.scope <> 'municipal' OR k.electoral_unit = {3})
            """, ct, year, round, uf, municipalityTseCode ?? "");

    public Task<IReadOnlyList<MunicipalityRefRow>> MunicipalitiesAsync(string uf, CancellationToken ct) =>
        Query<MunicipalityRefRow>("""
            SELECT m.state_code::text AS "Uf", m.tse_code::text AS "TseCode", m.ibge_code AS "IbgeCode", m.name AS "Name",
                   m.slug AS "Slug"
              FROM electoral.municipality m WHERE m.state_code = {0} ORDER BY m.name
            """, ct, uf);

    public async Task<FreshnessRow?> FreshnessAsync(CancellationToken ct)
    {
        var row = (await Query<FreshnessRow>("""
            SELECT (SELECT min(refreshed_at) FROM electoral.derived_refresh) AS "RefreshedAt",
                   COALESCE((SELECT min(bu_runs) FROM electoral.derived_refresh), -1)::int AS "StoredRuns",
                   (SELECT min(bu_last_finished_at) FROM electoral.derived_refresh) AS "StoredLastFinishedAt",
                   (SELECT count(*) FROM electoral.ingestion_run WHERE source = 'tse-open-data-bu' AND status = 'succeeded')::int
                     AS "CurrentRuns",
                   (SELECT max(finished_at) FROM electoral.ingestion_run WHERE source = 'tse-open-data-bu' AND status = 'succeeded')
                     AS "CurrentLastFinishedAt"
            """, ct)).FirstOrDefault();
        return row?.RefreshedAt is null ? null : row;
    }
}
