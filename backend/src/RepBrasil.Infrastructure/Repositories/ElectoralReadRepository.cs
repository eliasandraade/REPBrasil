using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Electoral;
using RepBrasil.Application.Interfaces;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.Infrastructure.Repositories;

/// <summary>
/// Leituras do schema <c>electoral</c> com SQL explícito (porte do repositório auditado do Urnaí).
/// Tabelas sempre qualificadas com o schema; parâmetros sempre posicionais ({0}, {1}…).
/// Versão de fonte vigente = lote <c>succeeded</c> mais recente do BU por município + zona;
/// lotes antigos continuam auditáveis e nunca são somados.
/// </summary>
public class ElectoralReadRepository(ApplicationDbContext db) : IElectoralReadRepository
{
    // Municípios/zonas com resultado: lotes succeeded do BU para o pleito (ano + turno) e UF.
    private const string ResultScopes = """
        SELECT f.uf::text AS uf, r.scope->>'municipality' AS tse_code, (r.scope->>'zone')::int AS zone
          FROM electoral.ingestion_run r
          JOIN electoral.open_data_source_file f ON f.id = r.source_file_id
          JOIN electoral.election e ON e.year = f.year AND e.round = f.turn
         WHERE r.source = 'tse-open-data-bu' AND r.status = 'succeeded' AND e.id = {0}
        """;

    private const string MunicipalitySelect = $$"""
        WITH res AS (SELECT tse_code, count(DISTINCT zone)::int AS zones FROM ({{ResultScopes}}) x WHERE uf = {1} GROUP BY tse_code),
             cad AS (SELECT s.municipality_id, count(DISTINCT s.zone_id)::int AS zones, count(*)::int AS sections
                       FROM electoral.electoral_section s JOIN electoral.municipality m ON m.id = s.municipality_id
                      WHERE s.election_id = {0} AND m.state_code = {1}
                      GROUP BY s.municipality_id)
        SELECT m.id AS "Id", m.state_code::text AS "Uf", m.tse_code::text AS "TseCode", m.ibge_code AS "IbgeCode",
               m.name AS "Name", m.slug AS "Slug", COALESCE(cad.zones, 0) AS "Zones",
               COALESCE(cad.sections, 0) AS "Sections", COALESCE(res.zones, 0) AS "ResultsZones"
          FROM electoral.municipality m
          LEFT JOIN cad ON cad.municipality_id = m.id
          LEFT JOIN res ON res.tse_code = m.tse_code
         WHERE m.state_code = {1}
        """;

    private const string ElectionSelect = """
        SELECT e.id AS "Id", e.year AS "Year", e.round AS "Round", e.election_date AS "ElectionDate",
               e.description AS "Description",
               (SELECT count(DISTINCT zm.municipality_id)::int FROM electoral.zone_municipality zm WHERE zm.election_id = e.id)
                 AS "CadasterMunicipalities",
               (SELECT count(DISTINCT (f.uf, r.scope->>'municipality'))::int
                  FROM electoral.ingestion_run r JOIN electoral.open_data_source_file f ON f.id = r.source_file_id
                 WHERE r.source = 'tse-open-data-bu' AND r.status = 'succeeded' AND f.year = e.year AND f.turn = e.round)
                 AS "ResultsMunicipalities"
          FROM electoral.election e
        """;

    private const string StateSelect = $$"""
        SELECT st.code::text AS "Uf", st.name AS "Name", st.ibge_code AS "IbgeCode",
               (SELECT count(*)::int FROM electoral.municipality m WHERE m.state_code = st.code) AS "Municipalities",
               (SELECT count(DISTINCT zm.municipality_id)::int
                  FROM electoral.zone_municipality zm JOIN electoral.municipality m ON m.id = zm.municipality_id
                 WHERE zm.election_id = {0} AND m.state_code = st.code) AS "CadasterMunicipalities",
               (SELECT count(DISTINCT x.tse_code)::int FROM ({{ResultScopes}}) x WHERE x.uf = st.code::text) AS "ResultsMunicipalities"
          FROM electoral.state st
        """;

    // Lote vigente por escopo (UF + município + zona) do pleito/turno da candidatura (CTE "cand").
    private const string CandidacyLatestBatches = """
        SELECT DISTINCT ON (f.uf, r.scope->>'municipality', r.scope->>'zone') r.id
          FROM electoral.ingestion_run r
          JOIN electoral.open_data_source_file f ON f.id = r.source_file_id
         WHERE r.source = 'tse-open-data-bu' AND r.status = 'succeeded'
           AND f.year = (SELECT year FROM cand) AND f.turn = (SELECT round FROM cand)
         ORDER BY f.uf, r.scope->>'municipality', r.scope->>'zone', r.finished_at DESC
        """;

    private const string CandidacySelect = """
        SELECT c.id AS "Id", c.tse_candidate_id AS "TseCandidateId", c.candidate_number AS "CandidateNumber",
               c.ballot_name AS "BallotName", c.party_number AS "PartyNumber", c.party_acronym AS "PartyAcronym",
               c.party_name AS "PartyName", c.federation_acronym AS "FederationAcronym", c.coalition_name AS "CoalitionName",
               c.candidacy_status AS "CandidacyStatus", c.round_outcome AS "RoundOutcome", c.elected AS "Elected",
               c.identity_status AS "IdentityStatus", c.person_id AS "PersonId",
               (SELECT p."Id" FROM public."Politicians" p WHERE p."Id" = c.politician_id AND p."DeletedAt" IS NULL) AS "PoliticianId",
               e.year AS "Year", e.round AS "Round", k.tse_election_code AS "TseElectionCode",
               k.tse_election_description AS "TseElectionDescription", k.office_code AS "OfficeCode",
               k.office_name AS "OfficeName", k.scope AS "Scope", k.electoral_unit::text AS "ElectoralUnit",
               f.url AS "SourceUrl", f.zip_sha256::text AS "SourceZipSha256", c.source_member AS "SourceMember",
               c.source_line AS "SourceLine",
               EXISTS (SELECT 1 FROM electoral.votable_candidacy vc WHERE vc.candidacy_id = c.id) AS "HasVotes"
          FROM electoral.candidacy c
          JOIN electoral.contest k ON k.id = c.contest_id
          JOIN electoral.election e ON e.id = k.election_id
          JOIN electoral.open_data_source_file f ON f.id = c.source_file_id
        """;

    private Task<List<T>> Query<T>(string sql, params object[] parameters) =>
        db.Database.SqlQueryRaw<T>(sql, parameters).ToListAsync();

    public async Task<IReadOnlyList<ElectionRow>> ElectionsAsync(CancellationToken ct) =>
        await db.Database.SqlQueryRaw<ElectionRow>($"{ElectionSelect} ORDER BY e.year DESC, e.round DESC").ToListAsync(ct);

    public async Task<ElectionRow?> ElectionAsync(int year, int round, CancellationToken ct) =>
        (await db.Database.SqlQueryRaw<ElectionRow>($"{ElectionSelect} WHERE e.year = {{0}} AND e.round = {{1}}", year, round)
            .ToListAsync(ct)).FirstOrDefault();

    public async Task<IReadOnlyList<StateRow>> StatesAsync(Guid electionId, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<StateRow>($"{StateSelect} ORDER BY st.name", electionId).ToListAsync(ct);

    public async Task<StateRow?> StateAsync(Guid electionId, string uf, CancellationToken ct) =>
        (await db.Database.SqlQueryRaw<StateRow>($"{StateSelect} WHERE st.code = {{1}}", electionId, uf).ToListAsync(ct))
            .FirstOrDefault();

    public async Task<IReadOnlyList<MunicipalityRow>> MunicipalitiesAsync(
        Guid electionId, string uf, string? slugQuery, string? code, CancellationToken ct)
    {
        if (slugQuery is null)
            return await db.Database.SqlQueryRaw<MunicipalityRow>($"{MunicipalitySelect} ORDER BY m.slug", electionId, uf).ToListAsync(ct);
        // slug = nome sem acento ⇒ busca por nome insensível a acento; códigos exatos
        return await db.Database.SqlQueryRaw<MunicipalityRow>(
            $"{MunicipalitySelect} AND (m.slug LIKE '%' || {{2}} || '%' OR m.tse_code = {{3}} OR m.ibge_code::text = {{3}}) ORDER BY m.slug",
            electionId, uf, slugQuery, code ?? "").ToListAsync(ct);
    }

    public async Task<IReadOnlyList<MunicipalityRow>> MunicipalityAsync(Guid electionId, string uf, string key, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<MunicipalityRow>(
            $"{MunicipalitySelect} AND (m.slug = {{2}} OR m.tse_code = {{2}} OR m.ibge_code::text = {{2}})",
            electionId, uf, key).ToListAsync(ct);

    public async Task<IReadOnlyList<ZoneRow>> ZonesAsync(Guid electionId, Guid municipalityId, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<ZoneRow>($$"""
            WITH res AS (SELECT DISTINCT x.zone FROM ({{ResultScopes}}) x
                           JOIN electoral.municipality m ON m.state_code = x.uf AND m.tse_code = x.tse_code WHERE m.id = {1})
            SELECT z.zone_number AS "Number",
                   count(*)::int AS "Sections",
                   count(*) FILTER (WHERE NOT s.is_aggregated)::int AS "PrincipalSections",
                   count(*) FILTER (WHERE s.is_aggregated)::int AS "AggregatedSections",
                   count(DISTINCT s.polling_place_id)::int AS "PollingPlaces",
                   count(DISTINCT s.polling_place_id) FILTER (WHERE p.geom IS NOT NULL)::int AS "PollingPlacesWithCoordinates",
                   CASE WHEN bool_and(s.eligible_federal IS NOT NULL) FILTER (WHERE NOT s.is_aggregated)
                        THEN (sum(s.eligible_federal) FILTER (WHERE NOT s.is_aggregated))::int END AS "EligibleFederal",
                   CASE WHEN bool_and(s.eligible_state IS NOT NULL) FILTER (WHERE NOT s.is_aggregated)
                        THEN (sum(s.eligible_state) FILTER (WHERE NOT s.is_aggregated))::int END AS "EligibleState",
                   (z.zone_number IN (SELECT zone FROM res)) AS "ResultsAvailable"
              FROM electoral.electoral_section s
              JOIN electoral.electoral_zone z ON z.id = s.zone_id
              JOIN electoral.polling_place p ON p.id = s.polling_place_id
             WHERE s.election_id = {0} AND s.municipality_id = {1}
             GROUP BY z.zone_number
             ORDER BY z.zone_number
            """, electionId, municipalityId).ToListAsync(ct);

    public async Task<IReadOnlyList<PlaceRow>> PlacesAsync(Guid electionId, Guid municipalityId, int zone, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<PlaceRow>("""
            SELECT p.tse_location_code AS "Code", p.name AS "Name", p.address AS "Address", p.neighborhood AS "Neighborhood",
                   p.postal_code AS "PostalCode", p.place_type AS "PlaceType",
                   public.ST_Y(p.geom) AS "Latitude", public.ST_X(p.geom) AS "Longitude", p.coordinates_source AS "CoordinatesSource"
              FROM electoral.polling_place p
              JOIN electoral.electoral_zone z ON z.id = p.zone_id
             WHERE p.election_id = {0} AND p.municipality_id = {1} AND z.zone_number = {2}
             ORDER BY (SELECT min(s.section_number) FROM electoral.electoral_section s WHERE s.polling_place_id = p.id), p.tse_location_code
            """, electionId, municipalityId, zone).ToListAsync(ct);

    public async Task<IReadOnlyList<SectionRow>> SectionsAsync(Guid electionId, Guid municipalityId, int zone, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<SectionRow>("""
            SELECT s.section_number AS "Number", s.is_aggregated AS "IsAggregated",
                   COALESCE(s.principal_section_number, s.section_number) AS "PrincipalNumber",
                   p.tse_location_code AS "PlaceCode", s.eligible_federal AS "EligibleFederal", s.eligible_state AS "EligibleState"
              FROM electoral.electoral_section s
              JOIN electoral.electoral_zone z ON z.id = s.zone_id
              JOIN electoral.polling_place p ON p.id = s.polling_place_id
             WHERE s.election_id = {0} AND s.municipality_id = {1} AND z.zone_number = {2}
             ORDER BY s.section_number
            """, electionId, municipalityId, zone).ToListAsync(ct);

    public async Task<CadasterProvenanceRow?> CadasterProvenanceAsync(Guid electionId, Guid municipalityId, CancellationToken ct) =>
        (await db.Database.SqlQueryRaw<CadasterProvenanceRow>("""
            SELECT f.dataset AS "Dataset", f.resource_id AS "ResourceId", f.resource_name AS "ResourceName", f.url AS "Url",
                   f.zip_sha256::text AS "ZipSha256", f.checksum_status AS "ChecksumStatus",
                   r.stats->'source'->>'csv_name' AS "CsvName", r.stats->'source'->>'csv_sha256' AS "CsvSha256",
                   r.stats->'source'->>'generated_at' AS "SourceGeneratedAt",
                   r.finished_at AS "ImportedAt", r.id AS "ImportBatchId"
              FROM electoral.ingestion_run r
              JOIN electoral.open_data_source_file f ON f.id = r.source_file_id
             WHERE r.id IN (SELECT DISTINCT s.ingestion_run_id FROM electoral.electoral_section s
                             WHERE s.election_id = {0} AND s.municipality_id = {1})
             ORDER BY r.finished_at DESC
             LIMIT 1
            """, electionId, municipalityId).ToListAsync(ct)).FirstOrDefault();

    public async Task<BatchRow?> LatestBatchAsync(int year, int round, string uf, string municipalityTseCode, int zone, CancellationToken ct) =>
        (await db.Database.SqlQueryRaw<BatchRow>("""
            SELECT r.id AS "BatchId", r.finished_at AS "FinishedAt", r.ea20_validation AS "Ea20Validation",
                   COALESCE(r.stats->'warnings', '[]'::jsonb)::text AS "WarningsJson",
                   f.dataset AS "Dataset", f.resource_id AS "ResourceId", f.resource_name AS "ResourceName", f.url AS "Url",
                   f.zip_sha256::text AS "ZipSha256", f.csv_sha256::text AS "CsvSha256",
                   f.source_generated_at AS "SourceGeneratedAt", f.official_checksum_algorithm AS "OfficialChecksumAlgorithm"
              FROM electoral.ingestion_run r
              JOIN electoral.open_data_source_file f ON f.id = r.source_file_id
             WHERE r.source = 'tse-open-data-bu' AND r.status = 'succeeded'
               AND f.year = {0} AND f.turn = {1} AND f.uf = {2}
               AND r.scope->>'municipality' = {3} AND r.scope->>'zone' = {4}
             ORDER BY r.finished_at DESC
             LIMIT 1
            """, year, round, uf, municipalityTseCode, zone.ToString(System.Globalization.CultureInfo.InvariantCulture))
            .ToListAsync(ct)).FirstOrDefault();

    public async Task<IReadOnlyList<UrnOfficeRow>> UrnOfficesAsync(
        Guid batchId, string municipalityTseCode, int zone, int principal, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<UrnOfficeRow>("""
            SELECT s.id AS "ResultId", s.election_code AS "ElectionCode", s.election_description AS "ElectionDescription",
                   s.office_code AS "OfficeCode", s.office_name AS "OfficeName", o.sort_order AS "OfficeSort",
                   s.section AS "Section", s.aggregated_sections AS "AggregatedSections",
                   s.polling_place_code AS "PollingPlaceCode", s.eligible AS "Eligible", s.turnout AS "Turnout",
                   s.abstentions AS "Abstentions", s.urn_number AS "UrnNumber", s.urn_type_description AS "UrnTypeDescription",
                   s.bu_emitted_at AS "BuEmittedAt", s.bu_received_at AS "BuReceivedAt", s.votes_total AS "VotesTotal"
              FROM electoral.section_office_result s JOIN electoral.office o ON o.code = s.office_code
             WHERE s.ingestion_run_id = {0} AND s.municipality_tse_code = {1} AND s.zone = {2} AND s.section = {3}
             ORDER BY o.sort_order, s.office_code
            """, batchId, municipalityTseCode, zone, principal).ToListAsync(ct);

    public async Task<IReadOnlyList<int>> PrincipalsForAsync(
        Guid batchId, string municipalityTseCode, int zone, int section, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<int>("""
            SELECT DISTINCT section AS "Value" FROM electoral.section_office_result
             WHERE ingestion_run_id = {0} AND municipality_tse_code = {1} AND zone = {2} AND {3} = ANY (aggregated_sections)
            """, batchId, municipalityTseCode, zone, section).ToListAsync(ct);

    public async Task<IReadOnlyList<VoteRow>> VotesAsync(long resultId, string uf, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<VoteRow>("""
            SELECT t.vote_kind::text AS "VoteKind", t.type_code AS "TypeCode", t.type_description AS "TypeDescription",
                   t.number AS "Number", t.name AS "Name", t.party_number AS "PartyNumber",
                   t.party_acronym AS "PartyAcronym", t.party_name AS "PartyName", v.votes AS "Votes",
                   c.id AS "CandidacyId", c.tse_candidate_id AS "TseCandidateId", c.person_id AS "PersonId",
                   p."Id" AS "PoliticianId"
              FROM electoral.section_office_vote v
              JOIN electoral.votable t ON t.id = v.votable_id
              LEFT JOIN electoral.votable_candidacy vc ON vc.votable_id = t.id AND vc.uf = {1}
              LEFT JOIN electoral.candidacy c ON c.id = vc.candidacy_id
              LEFT JOIN public."Politicians" p ON p."Id" = c.politician_id AND p."DeletedAt" IS NULL
             WHERE v.result_id = {0}
            """, resultId, uf).ToListAsync(ct);

    public async Task<IReadOnlyList<CandidacyRow>> CandidaciesByPoliticianAsync(Guid politicianId, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<CandidacyRow>(
            $"{CandidacySelect} WHERE c.politician_id = {{0}} ORDER BY e.year DESC, e.round DESC, k.office_code, c.tse_candidate_id",
            politicianId).ToListAsync(ct);

    public async Task<CandidacyRow?> CandidacyAsync(Guid candidacyId, CancellationToken ct) =>
        (await db.Database.SqlQueryRaw<CandidacyRow>($"{CandidacySelect} WHERE c.id = {{0}}", candidacyId).ToListAsync(ct))
            .FirstOrDefault();

    public async Task<IReadOnlyList<TerritoryVotesRow>> CandidacyVotesByMunicipalityAsync(Guid candidacyId, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<TerritoryVotesRow>($$"""
            WITH cand AS (
                   SELECT c.id, e.year, e.round, k.office_code
                     FROM electoral.candidacy c
                     JOIN electoral.contest k ON k.id = c.contest_id
                     JOIN electoral.election e ON e.id = k.election_id
                    WHERE c.id = {0}),
                 latest AS ({{CandidacyLatestBatches}}),
                 urns AS (
                   SELECT r.id, r.uf, r.municipality_tse_code, r.municipality_name
                     FROM electoral.section_office_result r
                     JOIN latest l ON l.id = r.ingestion_run_id
                    WHERE r.office_code = (SELECT office_code FROM cand)),
                 mine AS (
                   SELECT u.uf, u.municipality_tse_code, sum(v.votes)::bigint AS votes
                     FROM urns u
                     JOIN electoral.section_office_vote v ON v.result_id = u.id
                     JOIN electoral.votable_candidacy vc ON vc.votable_id = v.votable_id AND vc.uf = u.uf
                    WHERE vc.candidacy_id = {0}
                    GROUP BY u.uf, u.municipality_tse_code),
                 valid AS (
                   SELECT u.uf, u.municipality_tse_code, max(u.municipality_name) AS municipality_name,
                          count(DISTINCT u.id)::int AS urns,
                          COALESCE(sum(v.votes) FILTER (WHERE t.vote_kind IN ('candidate', 'party_legend')), 0)::bigint AS valid_votes
                     FROM urns u
                     JOIN electoral.section_office_vote v ON v.result_id = u.id
                     JOIN electoral.votable t ON t.id = v.votable_id
                    WHERE (u.uf, u.municipality_tse_code) IN (SELECT uf, municipality_tse_code FROM mine)
                    GROUP BY u.uf, u.municipality_tse_code)
            SELECT m.uf::text AS "Uf", m.municipality_tse_code::text AS "MunicipalityTseCode",
                   COALESCE(mu.name, va.municipality_name) AS "MunicipalityName", mu.slug AS "MunicipalitySlug",
                   m.votes AS "Votes", va.valid_votes AS "ValidVotes", va.urns AS "Urns"
              FROM mine m
              JOIN valid va ON va.uf = m.uf AND va.municipality_tse_code = m.municipality_tse_code
              LEFT JOIN electoral.municipality mu ON mu.state_code = m.uf AND mu.tse_code = m.municipality_tse_code
            """, candidacyId).ToListAsync(ct);

    public async Task<IReadOnlyList<CoverageRow>> ResultsCoverageAsync(int year, int round, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<CoverageRow>("""
            WITH e AS (SELECT id FROM electoral.election WHERE year = {0} AND round = {1}),
                 res AS (SELECT f.uf::text AS uf, count(DISTINCT r.scope->>'municipality')::int AS n
                           FROM electoral.ingestion_run r JOIN electoral.open_data_source_file f ON f.id = r.source_file_id
                          WHERE r.source = 'tse-open-data-bu' AND r.status = 'succeeded' AND f.year = {0} AND f.turn = {1}
                          GROUP BY f.uf),
                 cad AS (SELECT m.state_code::text AS uf, count(DISTINCT zm.municipality_id)::int AS n
                           FROM electoral.zone_municipality zm JOIN electoral.municipality m ON m.id = zm.municipality_id
                          WHERE zm.election_id = (SELECT id FROM e)
                          GROUP BY m.state_code)
            SELECT COALESCE(res.uf, cad.uf) AS "Uf", COALESCE(res.n, 0) AS "MunicipalitiesWithResults",
                   COALESCE(cad.n, 0) AS "MunicipalitiesInCadaster"
              FROM res FULL JOIN cad ON cad.uf = res.uf
            """, year, round).ToListAsync(ct);
}
