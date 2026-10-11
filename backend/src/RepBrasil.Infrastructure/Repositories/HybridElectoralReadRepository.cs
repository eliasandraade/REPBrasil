using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Electoral;
using RepBrasil.Application.Interfaces;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.Infrastructure.Repositories;

public sealed class HybridElectoralReadRepository(
    ElectoralReadRepository inner,
    ApplicationDbContext db,
    IElectoralLakeClient lake) : IElectoralReadRepository
{
    public Task<IReadOnlyList<ElectionRow>> ElectionsAsync(CancellationToken ct) => inner.ElectionsAsync(ct);

    public Task<ElectionRow?> ElectionAsync(int year, int round, CancellationToken ct) =>
        inner.ElectionAsync(year, round, ct);

    public Task<IReadOnlyList<StateRow>> StatesAsync(Guid electionId, CancellationToken ct) =>
        inner.StatesAsync(electionId, ct);

    public Task<StateRow?> StateAsync(Guid electionId, string uf, CancellationToken ct) =>
        inner.StateAsync(electionId, uf, ct);

    public Task<IReadOnlyList<MunicipalityRow>> MunicipalitiesAsync(
        Guid electionId, string uf, string? slugQuery, string? code, CancellationToken ct) =>
        inner.MunicipalitiesAsync(electionId, uf, slugQuery, code, ct);

    public Task<IReadOnlyList<MunicipalityRow>> MunicipalityAsync(
        Guid electionId, string uf, string key, CancellationToken ct) =>
        inner.MunicipalityAsync(electionId, uf, key, ct);

    public Task<IReadOnlyList<ZoneRow>> ZonesAsync(Guid electionId, Guid municipalityId, CancellationToken ct) =>
        inner.ZonesAsync(electionId, municipalityId, ct);

    public Task<IReadOnlyList<PlaceRow>> PlacesAsync(
        Guid electionId, Guid municipalityId, int zone, CancellationToken ct) =>
        inner.PlacesAsync(electionId, municipalityId, zone, ct);

    public Task<IReadOnlyList<SectionRow>> SectionsAsync(
        Guid electionId, Guid municipalityId, int zone, CancellationToken ct) =>
        inner.SectionsAsync(electionId, municipalityId, zone, ct);

    public Task<CadasterProvenanceRow?> CadasterProvenanceAsync(
        Guid electionId, Guid municipalityId, CancellationToken ct) =>
        inner.CadasterProvenanceAsync(electionId, municipalityId, ct);

    public Task<BatchRow?> LatestBatchAsync(
        int year, int round, string uf, string municipalityTseCode, int zone, CancellationToken ct) =>
        inner.LatestBatchAsync(year, round, uf, municipalityTseCode, zone, ct);

    public Task<IReadOnlyList<UrnOfficeRow>> UrnOfficesAsync(
        Guid batchId, string municipalityTseCode, int zone, int principal, CancellationToken ct) =>
        inner.UrnOfficesAsync(batchId, municipalityTseCode, zone, principal, ct);

    public Task<IReadOnlyList<int>> PrincipalsForAsync(
        Guid batchId, string municipalityTseCode, int zone, int section, CancellationToken ct) =>
        inner.PrincipalsForAsync(batchId, municipalityTseCode, zone, section, ct);

    public async Task<IReadOnlyList<VoteRow>> VotesAsync(long resultId, string uf, CancellationToken ct)
    {
        var live = await inner.VotesAsync(resultId, uf, ct);
        if (live.Count > 0)
            return live;

        var archived = await db.Database.SqlQueryRaw<int>("""
            SELECT 1 AS "Value"
              FROM electoral.section_office_result r
              JOIN electoral_archive.derived_archive_scope a
                ON a.year = r.year AND a.turn = r.turn AND a.uf = r.uf
             WHERE r.id = {0} AND r.uf = {1}
             LIMIT 1
            """, resultId, uf.Trim().ToUpperInvariant()).ToListAsync(ct);

        if (archived.Count == 0)
            return live;

        var cold = await lake.ResultVotesAsync(resultId, uf, ct);
        if (cold.Count == 0)
            throw new ElectoralIntegrityException($"Resultado eleitoral arquivado {resultId} não possui votos no lake.");
        return cold;
    }

    public Task<IReadOnlyList<CandidacyRow>> CandidaciesByPoliticianAsync(Guid politicianId, CancellationToken ct) =>
        inner.CandidaciesByPoliticianAsync(politicianId, ct);

    public Task<CandidacyRow?> CandidacyAsync(Guid candidacyId, CancellationToken ct) =>
        inner.CandidacyAsync(candidacyId, ct);

    public async Task<IReadOnlyList<TerritoryVotesRow>> CandidacyVotesByMunicipalityAsync(
        Guid candidacyId, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<TerritoryVotesRow>("""
            WITH cand AS (
                   SELECT e.year::int AS year, e.round::int AS turn, k.office_code::int AS office_code
                     FROM electoral.candidacy c
                     JOIN electoral.contest k ON k.id = c.contest_id
                     JOIN electoral.election e ON e.id = k.election_id
                    WHERE c.id = {0}),
                 mine AS (
                   SELECT z.uf, z.municipality_tse_code, sum(z.votes)::bigint AS votes
                     FROM electoral.votable_zone_votes_current z
                     JOIN cand c ON c.year = z.year AND c.turn = z.turn AND c.office_code = z.office_code
                     JOIN electoral.votable_candidacy vc ON vc.votable_id = z.votable_id AND vc.uf = z.uf
                    WHERE vc.candidacy_id = {0}
                    GROUP BY z.uf, z.municipality_tse_code),
                 valid AS (
                   SELECT z.uf, z.municipality_tse_code,
                          max(z.municipality_name) AS municipality_name,
                          sum(z.urns)::int AS urns,
                          sum(z.nominal_votes + z.legend_votes)::bigint AS valid_votes
                     FROM electoral.zone_office_totals_current z
                     JOIN cand c ON c.year = z.year AND c.turn = z.turn AND c.office_code = z.office_code
                    WHERE EXISTS (
                        SELECT 1 FROM mine m
                         WHERE m.uf = z.uf AND m.municipality_tse_code = z.municipality_tse_code)
                    GROUP BY z.uf, z.municipality_tse_code)
            SELECT m.uf::text AS "Uf", m.municipality_tse_code::text AS "MunicipalityTseCode",
                   COALESCE(mu.name, va.municipality_name) AS "MunicipalityName", mu.slug AS "MunicipalitySlug",
                   m.votes AS "Votes", va.valid_votes AS "ValidVotes", va.urns AS "Urns"
              FROM mine m
              JOIN valid va ON va.uf = m.uf AND va.municipality_tse_code = m.municipality_tse_code
              LEFT JOIN electoral.municipality mu ON mu.state_code = m.uf AND mu.tse_code = m.municipality_tse_code
            """, candidacyId).ToListAsync(ct);

    public Task<IReadOnlyList<CoverageScopeRow>> ResultsCoverageAsync(int year, int round, CancellationToken ct) =>
        inner.ResultsCoverageAsync(year, round, ct);
}
