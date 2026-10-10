using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Electoral;
using RepBrasil.Application.Interfaces;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.Infrastructure.Repositories;

/// <summary>
/// Consultas analíticas sobre o BU vigente. Nunca soma versões antigas da mesma fonte e nunca
/// transforma ausência de cobertura em zero. Zero só nasce quando a urna/cargo existe e a
/// candidatura vinculada não possui linha nominal naquele resultado.
/// </summary>
public class ElectoralComparisonRepository(ApplicationDbContext db) : IElectoralComparisonRepository
{
    public async Task<IReadOnlyList<CandidacySectionComparisonRow>> SectionsAsync(
        IReadOnlyList<Guid> candidacyIds,
        string uf,
        string? municipalityTseCode,
        int? zone,
        CancellationToken ct)
    {
        var ids = candidacyIds.Distinct().ToArray();
        if (ids.Length == 0) return [];

        return await db.Database.SqlQueryRaw<CandidacySectionComparisonRow>("""
            WITH selected AS (
                   SELECT c.id AS candidacy_id, e.year, e.round, k.office_code, k.office_name
                     FROM electoral.candidacy c
                     JOIN electoral.contest k ON k.id = c.contest_id
                     JOIN electoral.election e ON e.id = k.election_id
                    WHERE c.id = ANY ({0})),
                 latest AS (
                   SELECT DISTINCT ON (s.candidacy_id, f.uf, r.scope->>'municipality', r.scope->>'zone')
                          s.candidacy_id, s.year, s.round, s.office_code, s.office_name, r.id AS ingestion_run_id
                     FROM selected s
                     JOIN electoral.open_data_source_file f ON f.year = s.year AND f.turn = s.round
                     JOIN electoral.ingestion_run r ON r.source_file_id = f.id
                    WHERE r.source = 'tse-open-data-bu'
                      AND r.status = 'succeeded'
                      AND f.uf = {1}
                      AND ({2}::text IS NULL OR r.scope->>'municipality' = {2})
                      AND ({3}::int IS NULL OR (r.scope->>'zone')::int = {3})
                    ORDER BY s.candidacy_id, f.uf, r.scope->>'municipality', r.scope->>'zone',
                             r.finished_at DESC, r.id DESC),
                 urns AS (
                   SELECT l.candidacy_id, l.year, l.round, l.office_code, l.office_name,
                          r.id AS result_id, r.uf::text AS uf,
                          r.municipality_tse_code::text AS municipality_tse_code,
                          r.municipality_name, r.zone, r.section,
                          ARRAY(
                            SELECT DISTINCT member
                              FROM unnest(array_prepend(r.section, COALESCE(r.aggregated_sections, '{}'::integer[]))) member
                             ORDER BY member
                          ) AS section_members
                     FROM latest l
                     JOIN electoral.section_office_result r ON r.ingestion_run_id = l.ingestion_run_id
                    WHERE r.office_code = l.office_code
                      AND r.uf = {1}
                      AND ({2}::text IS NULL OR r.municipality_tse_code = {2})
                      AND ({3}::int IS NULL OR r.zone = {3}))
            SELECT u.candidacy_id AS "CandidacyId",
                   u.year AS "Year", u.round AS "Round",
                   u.office_code AS "OfficeCode", u.office_name AS "OfficeName",
                   u.uf AS "Uf", u.municipality_tse_code AS "MunicipalityTseCode",
                   u.municipality_name AS "MunicipalityName", u.zone AS "Zone",
                   u.section AS "Section", u.section_members AS "SectionMembers",
                   COALESCE((
                       SELECT sum(v.votes)::bigint
                         FROM electoral.section_office_vote v
                         JOIN electoral.votable_candidacy vc
                           ON vc.votable_id = v.votable_id AND vc.uf = u.uf
                        WHERE v.result_id = u.result_id
                          AND vc.candidacy_id = u.candidacy_id
                   ), 0)::bigint AS "Votes",
                   (
                       SELECT sum(v.votes)::bigint
                         FROM electoral.section_office_vote v
                         JOIN electoral.votable t ON t.id = v.votable_id
                        WHERE v.result_id = u.result_id
                          AND t.vote_kind IN ('candidate', 'party_legend')
                   ) AS "ValidVotes"
              FROM urns u
             ORDER BY u.municipality_tse_code, u.zone, u.section, u.year, u.round, u.candidacy_id
            """, ids, uf, municipalityTseCode, zone).ToListAsync(ct);
    }
}
