using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Electoral;
using RepBrasil.Application.Interfaces;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.Infrastructure.Repositories;

public sealed class HybridElectoralXrayRepository(
    ElectoralXrayRepository inner,
    ApplicationDbContext db,
    IElectoralLakeClient lake) : IElectoralXrayRepository
{
    private sealed class ArchiveScopeRow
    {
        public short Year { get; init; }
        public short Round { get; init; }
    }

    private async Task<HashSet<(int Year, int Round)>> ArchivedScopesAsync(string uf, CancellationToken ct)
    {
        var rows = await db.Database.SqlQueryRaw<ArchiveScopeRow>("""
            SELECT year AS "Year", turn AS "Round"
              FROM electoral_archive.derived_archive_scope
             WHERE uf = {0}
            """, uf.Trim().ToUpperInvariant()).ToListAsync(ct);
        return rows.Select(row => ((int)row.Year, (int)row.Round)).ToHashSet();
    }

    public Task<PoliticianRefRow?> PoliticianAsync(Guid politicianId, CancellationToken ct) =>
        inner.PoliticianAsync(politicianId, ct);

    public Task<IReadOnlyList<XrayCandidacyRow>> SubjectCandidaciesAsync(
        Guid politicianId, Guid? personId, CancellationToken ct) =>
        inner.SubjectCandidaciesAsync(politicianId, personId, ct);

    public Task<IReadOnlyList<XrayCandidacyRow>> CandidaciesAsync(
        IReadOnlyList<Guid> candidacyIds, CancellationToken ct) =>
        inner.CandidaciesAsync(candidacyIds, ct);

    public Task<IReadOnlyList<CandidacyZoneVotesRow>> ZoneVotesAsync(
        IReadOnlyList<Guid> candidacyIds, string? uf, string? municipalityTseCode, CancellationToken ct) =>
        inner.ZoneVotesAsync(candidacyIds, uf, municipalityTseCode, ct);

    public Task<IReadOnlyList<ZoneTotalsRow>> ZoneTotalsAsync(
        IReadOnlyList<ElectionOffice> keys, string? uf, string? municipalityTseCode, CancellationToken ct) =>
        inner.ZoneTotalsAsync(keys, uf, municipalityTseCode, ct);

    public Task<IReadOnlyList<ExpectedZoneRow>> ExpectedZonesAsync(
        IReadOnlyList<(int Year, int Round)> elections, string? uf, string? municipalityTseCode, CancellationToken ct) =>
        inner.ExpectedZonesAsync(elections, uf, municipalityTseCode, ct);

    public Task<IReadOnlyList<ContestRankRow>> RanksAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct) =>
        inner.RanksAsync(candidacyIds, ct);

    public Task<IReadOnlyList<TicketRow>> TicketsAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct) =>
        inner.TicketsAsync(candidacyIds, ct);

    public Task<IReadOnlyList<AssetRow>> AssetsAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct) =>
        inner.AssetsAsync(candidacyIds, ct);

    public Task<IReadOnlyList<SourceRecordRow>> RecordsAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct) =>
        inner.RecordsAsync(candidacyIds, ct);

    public Task<IReadOnlyList<FinanceTotalsRow>> FinanceTotalsAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct) =>
        inner.FinanceTotalsAsync(candidacyIds, ct);

    public Task<IReadOnlyList<FinanceCategoryRow>> FinanceCategoriesAsync(Guid candidacyId, CancellationToken ct) =>
        inner.FinanceCategoriesAsync(candidacyId, ct);

    public Task<IReadOnlyList<FinanceCounterpartyRow>> FinanceCounterpartiesAsync(
        Guid candidacyId, string recordKind, int limit, CancellationToken ct) =>
        inner.FinanceCounterpartiesAsync(candidacyId, recordKind, limit, ct);

    public Task<IReadOnlyList<PriorRow>> PriorsAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct) =>
        inner.PriorsAsync(candidacyIds, ct);

    public async Task<IReadOnlyList<SectionResultRow>> SectionResultsAsync(
        IReadOnlyList<ElectionOffice> keys,
        string uf,
        string municipalityTseCode,
        int? zone,
        CancellationToken ct)
    {
        var rows = await inner.SectionResultsAsync(keys, uf, municipalityTseCode, zone, ct);
        var archivedScopes = await ArchivedScopesAsync(uf, ct);
        var archivedKeys = keys.Where(key => archivedScopes.Contains((key.Year, key.Round))).ToList();
        if (archivedKeys.Count == 0)
            return rows;

        var coldValidVotes = new Dictionary<long, long>();
        foreach (var group in archivedKeys.GroupBy(key => (key.Year, key.Round)))
        {
            var values = await lake.ValidVotesByResultAsync(
                group.Key.Year,
                group.Key.Round,
                uf,
                municipalityTseCode,
                group.Select(key => key.OfficeCode).Distinct().ToArray(),
                zone,
                ct);
            foreach (var value in values)
                coldValidVotes[value.Key] = value.Value;
        }

        return rows.Select(row =>
        {
            if (!archivedScopes.Contains((row.Year, row.Round)))
                return row;
            return new SectionResultRow
            {
                ResultId = row.ResultId,
                Year = row.Year,
                Round = row.Round,
                OfficeCode = row.OfficeCode,
                Uf = row.Uf,
                MunicipalityTseCode = row.MunicipalityTseCode,
                MunicipalityName = row.MunicipalityName,
                Zone = row.Zone,
                Section = row.Section,
                SectionMembers = row.SectionMembers,
                PollingPlaceCode = row.PollingPlaceCode,
                Eligible = row.Eligible,
                Turnout = row.Turnout,
                ValidVotes = coldValidVotes.GetValueOrDefault(row.ResultId),
            };
        }).ToList();
    }

    public async Task<IReadOnlyList<SectionCandidacyVotesRow>> SectionVotesAsync(
        IReadOnlyList<Guid> candidacyIds,
        string uf,
        string municipalityTseCode,
        int? zone,
        CancellationToken ct)
    {
        var live = await inner.SectionVotesAsync(candidacyIds, uf, municipalityTseCode, zone, ct);
        var archivedScopes = await ArchivedScopesAsync(uf, ct);
        if (archivedScopes.Count == 0)
            return live;

        var candidacies = await inner.CandidaciesAsync(candidacyIds, ct);
        var archived = candidacies
            .Where(candidacy => archivedScopes.Contains((candidacy.Year, candidacy.Round)))
            .ToList();
        if (archived.Count == 0)
            return live;

        var archivedIds = archived.Select(candidacy => candidacy.Id).ToHashSet();
        var cold = await lake.CandidacyVotesByResultAsync(
            archivedIds.ToArray(),
            archived.Select(candidacy => new ElectionOffice(candidacy.Year, candidacy.Round, candidacy.OfficeCode))
                .Distinct()
                .ToArray(),
            uf,
            municipalityTseCode,
            zone,
            ct);

        return live
            .Where(row => !archivedIds.Contains(row.CandidacyId))
            .Concat(cold)
            .OrderBy(row => row.ResultId)
            .ThenBy(row => row.CandidacyId)
            .ToList();
    }

    public Task<IReadOnlyList<PlaceNameRow>> PlacesAsync(
        IReadOnlyList<(int Year, int Round)> elections,
        string uf,
        string municipalityTseCode,
        int? zone,
        CancellationToken ct) =>
        inner.PlacesAsync(elections, uf, municipalityTseCode, zone, ct);

    public Task<IReadOnlyList<XrayCandidacyRow>> ElectionCandidaciesAsync(
        int year, int round, string uf, string? municipalityTseCode, CancellationToken ct) =>
        inner.ElectionCandidaciesAsync(year, round, uf, municipalityTseCode, ct);

    public Task<IReadOnlyList<MunicipalityRefRow>> MunicipalitiesAsync(string uf, CancellationToken ct) =>
        inner.MunicipalitiesAsync(uf, ct);

    public Task<FreshnessRow?> FreshnessAsync(CancellationToken ct) => inner.FreshnessAsync(ct);
}
