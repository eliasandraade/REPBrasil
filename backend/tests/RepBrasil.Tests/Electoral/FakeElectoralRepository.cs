using RepBrasil.Application.Electoral;
using RepBrasil.Application.Interfaces;

namespace RepBrasil.Tests.Electoral;

/// <summary>Repositório em memória: território sintético no formato das linhas do schema electoral.</summary>
public sealed class FakeElectoralRepository : IElectoralReadRepository
{
    public static readonly Guid ElectionId = Guid.Parse("00000000-0000-0000-0000-000000002026");

    public List<ElectionRow> Elections { get; } =
    [
        new() { Id = ElectionId, Year = 2026, Round = 1, ElectionDate = new DateOnly(2026, 10, 4), Description = "1º Turno", CadasterMunicipalities = 2, ResultsMunicipalities = 1 },
    ];

    public List<StateRow> States { get; } =
    [
        new() { Uf = "CE", Name = "Ceará", IbgeCode = 23, Municipalities = 3, CadasterMunicipalities = 2, ResultsMunicipalities = 1 },
    ];

    public List<MunicipalityRow> Municipalities { get; } = [];
    public Dictionary<Guid, List<ZoneRow>> Zones { get; } = [];
    public Dictionary<(Guid, int), List<SectionRow>> Sections { get; } = [];
    public Dictionary<(Guid, int), List<PlaceRow>> Places { get; } = [];
    public Dictionary<(string, int), BatchRow> Batches { get; } = [];
    public Dictionary<(Guid, int), List<UrnOfficeRow>> Urns { get; } = [];
    public Dictionary<(Guid, int), List<int>> PrincipalsOfAggregated { get; } = [];
    public Dictionary<long, List<VoteRow>> Votes { get; } = [];
    public List<CandidacyRow> Candidacies { get; } = [];
    public Dictionary<Guid, List<TerritoryVotesRow>> CandidacyVotes { get; } = [];
    public List<CoverageRow> Coverage { get; } = [];
    public List<string> VoteQueries { get; } = [];

    public Task<IReadOnlyList<ElectionRow>> ElectionsAsync(CancellationToken ct) => Task.FromResult<IReadOnlyList<ElectionRow>>(Elections);

    public Task<ElectionRow?> ElectionAsync(int year, int round, CancellationToken ct) =>
        Task.FromResult(Elections.FirstOrDefault(e => e.Year == year && e.Round == round));

    public Task<IReadOnlyList<StateRow>> StatesAsync(Guid electionId, CancellationToken ct) => Task.FromResult<IReadOnlyList<StateRow>>(States);

    public Task<StateRow?> StateAsync(Guid electionId, string uf, CancellationToken ct) =>
        Task.FromResult(States.FirstOrDefault(s => s.Uf == uf));

    public Task<IReadOnlyList<MunicipalityRow>> MunicipalitiesAsync(Guid electionId, string uf, string? slugQuery, string? code, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<MunicipalityRow>>(Municipalities
            .Where(m => m.Uf == uf && (slugQuery is null || m.Slug.Contains(slugQuery, StringComparison.Ordinal) || m.TseCode == code))
            .ToList());

    public Task<IReadOnlyList<MunicipalityRow>> MunicipalityAsync(Guid electionId, string uf, string key, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<MunicipalityRow>>(Municipalities
            .Where(m => m.Uf == uf && (m.Slug == key || m.TseCode == key || m.IbgeCode?.ToString(System.Globalization.CultureInfo.InvariantCulture) == key))
            .ToList());

    public Task<IReadOnlyList<ZoneRow>> ZonesAsync(Guid electionId, Guid municipalityId, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<ZoneRow>>(Zones.GetValueOrDefault(municipalityId) ?? []);

    public Task<IReadOnlyList<PlaceRow>> PlacesAsync(Guid electionId, Guid municipalityId, int zone, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<PlaceRow>>(Places.GetValueOrDefault((municipalityId, zone)) ?? []);

    public Task<IReadOnlyList<SectionRow>> SectionsAsync(Guid electionId, Guid municipalityId, int zone, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<SectionRow>>(Sections.GetValueOrDefault((municipalityId, zone)) ?? []);

    public Task<CadasterProvenanceRow?> CadasterProvenanceAsync(Guid electionId, Guid municipalityId, CancellationToken ct) =>
        Task.FromResult<CadasterProvenanceRow?>(null);

    public Task<BatchRow?> LatestBatchAsync(int year, int round, string uf, string municipalityTseCode, int zone, CancellationToken ct) =>
        Task.FromResult(Batches.GetValueOrDefault((municipalityTseCode, zone)));

    public Task<IReadOnlyList<UrnOfficeRow>> UrnOfficesAsync(Guid batchId, string municipalityTseCode, int zone, int principal, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<UrnOfficeRow>>(Urns.GetValueOrDefault((batchId, principal)) ?? []);

    public Task<IReadOnlyList<int>> PrincipalsForAsync(Guid batchId, string municipalityTseCode, int zone, int section, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<int>>(PrincipalsOfAggregated.GetValueOrDefault((batchId, section)) ?? []);

    public Task<IReadOnlyList<VoteRow>> VotesAsync(long resultId, string uf, CancellationToken ct)
    {
        VoteQueries.Add($"{resultId}/{uf}");
        return Task.FromResult<IReadOnlyList<VoteRow>>(Votes.GetValueOrDefault(resultId) ?? []);
    }

    public Task<IReadOnlyList<CandidacyRow>> CandidaciesByPoliticianAsync(Guid politicianId, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<CandidacyRow>>(Candidacies.Where(c => c.PoliticianId == politicianId).ToList());

    public Task<CandidacyRow?> CandidacyAsync(Guid candidacyId, CancellationToken ct) =>
        Task.FromResult(Candidacies.FirstOrDefault(c => c.Id == candidacyId));

    public Task<IReadOnlyList<TerritoryVotesRow>> CandidacyVotesByMunicipalityAsync(Guid candidacyId, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<TerritoryVotesRow>>(CandidacyVotes.GetValueOrDefault(candidacyId) ?? []);

    public Task<IReadOnlyList<CoverageRow>> ResultsCoverageAsync(int year, int round, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<CoverageRow>>(Coverage);
}
