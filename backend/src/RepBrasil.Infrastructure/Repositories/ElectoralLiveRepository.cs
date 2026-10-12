using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.ElectoralLive;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.Infrastructure.Repositories;

public sealed class ElectoralLiveRepository(ApplicationDbContext db) : IElectoralLiveRepository
{
    private async Task<IReadOnlyList<T>> Query<T>(string sql, CancellationToken ct, params object[] parameters) =>
        await db.Database.SqlQueryRaw<T>(sql, parameters).ToListAsync(ct);

    public Task<IReadOnlyList<PollRow>> PollsAsync(
        int year,
        int round,
        int office,
        string? uf,
        string? municipalityTseCode,
        CancellationToken ct) =>
        Query<PollRow>("""
            WITH scoped AS (
              SELECT p.id, p.registration_number, p.institute_id, p.field_start, p.field_end,
                     p.published_at, p.sample_size, p.margin_error_pp, p.confidence_level,
                     p.methodology, p.source_id
                FROM electoral.poll p
                JOIN electoral.election e ON e.id = p.election_id
                LEFT JOIN electoral.municipality m ON m.id = p.municipality_id
               WHERE e.year = {0} AND e.round = {1} AND p.office_code = {2}
                 AND (
                   ({4} <> '' AND p.state_code = {3} AND m.tse_code = {4})
                   OR ({4} = '' AND {3} <> '' AND p.municipality_id IS NULL
                       AND (p.state_code = {3} OR p.state_code IS NULL))
                   OR ({4} = '' AND {3} = '' AND p.municipality_id IS NULL AND p.state_code IS NULL)
                 )
            ), latest AS (
              SELECT DISTINCT ON (s.registration_number) s.id
                FROM scoped s
                JOIN electoral.poll_source src ON src.id = s.source_id
               ORDER BY s.registration_number, src.retrieved_at DESC, src.id DESC, s.id DESC
            )
            SELECT p.id AS "PollId", p.registration_number AS "RegistrationNumber",
                   i.name AS "Institute", p.field_start AS "FieldStart", p.field_end AS "FieldEnd",
                   p.published_at AS "PublishedAt", p.sample_size AS "SampleSize",
                   p.margin_error_pp AS "MarginErrorPp", p.confidence_level AS "ConfidenceLevel",
                   p.methodology AS "Methodology", src.source_url AS "SourceUrl",
                   src.retrieved_at AS "RetrievedAt", sc.id AS "ScenarioId", sc.name AS "ScenarioName",
                   sc.scenario_order AS "ScenarioOrder", r.option_order AS "OptionOrder",
                   r.option_label AS "OptionLabel", r.option_kind AS "OptionKind",
                   r.candidacy_id AS "CandidacyId", r.party_acronym AS "PartyAcronym",
                   r.percentage AS "Percentage"
              FROM latest l
              JOIN electoral.poll p ON p.id = l.id
              JOIN electoral.poll_source src ON src.id = p.source_id
              JOIN electoral.poll_institute i ON i.id = p.institute_id
              LEFT JOIN electoral.poll_scenario sc ON sc.poll_id = p.id
              LEFT JOIN electoral.poll_result r ON r.scenario_id = sc.id
             ORDER BY p.field_end DESC, p.registration_number, sc.scenario_order NULLS LAST, r.option_order NULLS LAST
            """, ct, year, round, office, uf ?? "", municipalityTseCode ?? "");

    public Task<IReadOnlyList<LiveCountRow>> LatestLiveCountAsync(
        int year,
        int round,
        int office,
        string scope,
        string? uf,
        string? municipalityTseCode,
        CancellationToken ct) =>
        Query<LiveCountRow>("""
            WITH latest AS (
              SELECT s.id
                FROM electoral.totalization_snapshot s
                JOIN electoral.election e ON e.id = s.election_id
                LEFT JOIN electoral.municipality m ON m.id = s.municipality_id
               WHERE e.year = {0} AND e.round = {1} AND s.office_code = {2} AND s.scope = {3}
                 AND ({4} = '' OR s.state_code = {4})
                 AND ({5} = '' OR m.tse_code = {5})
               ORDER BY coalesce(s.tse_generated_at, s.captured_at) DESC, s.captured_at DESC, s.id DESC
               LIMIT 1
            )
            SELECT s.id AS "SnapshotId", s.scope AS "Scope", s.status AS "Status",
                   s.counted_sections AS "CountedSections", s.total_sections AS "TotalSections",
                   s.counted_percent AS "CountedPercent", s.captured_at AS "CapturedAt",
                   s.tse_generated_at AS "TseGeneratedAt", s.source_url AS "SourceUrl",
                   r.position AS "Position", r.candidacy_id AS "CandidacyId",
                   r.candidate_number AS "CandidateNumber", r.option_label AS "OptionLabel",
                   r.party_acronym AS "PartyAcronym", r.votes AS "Votes",
                   r.percentage AS "Percentage", r.result_status AS "ResultStatus"
              FROM latest l
              JOIN electoral.totalization_snapshot s ON s.id = l.id
              LEFT JOIN electoral.totalization_result r ON r.snapshot_id = s.id
             ORDER BY r.position NULLS LAST, r.id NULLS LAST
            """, ct, year, round, office, scope, uf ?? "", municipalityTseCode ?? "");
}
