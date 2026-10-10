using RepBrasil.Application.Electoral;
using RepBrasil.Application.Interfaces;

namespace RepBrasil.Tests.Electoral;

/// <summary>Repositório em memória com a MESMA semântica de filtros do SQL (nunca inventa linhas).</summary>
public sealed class FakeXrayRepository : IElectoralXrayRepository
{
    public List<PoliticianRefRow> Politicians { get; } = [];
    public List<XrayCandidacyRow> Candidacies { get; } = [];
    public List<CandidacyZoneVotesRow> ZoneVotes { get; } = [];
    public List<ZoneTotalsRow> Totals { get; } = [];
    public List<ExpectedZoneRow> Expected { get; } = [];
    public List<ContestRankRow> Ranks { get; } = [];
    public List<TicketRow> Tickets { get; } = [];
    public List<AssetRow> Assets { get; } = [];
    public List<SourceRecordRow> Records { get; } = [];
    public List<(Guid CandidacyId, FinanceTotalsRow Row)> Finance { get; } = [];
    public List<PriorRow> Priors { get; } = [];
    public List<SectionResultRow> Sections { get; } = [];
    public List<SectionCandidacyVotesRow> SectionVotes { get; } = [];
    public List<PlaceNameRow> Places { get; } = [];
    public List<MunicipalityRefRow> Municipalities { get; } = [];
    public FreshnessRow? Freshness { get; set; } = new() { RefreshedAt = DateTime.UtcNow, StoredRuns = 1, CurrentRuns = 1 };

    private static IReadOnlyList<T> L<T>(IEnumerable<T> items) => items.ToList();

    public Task<PoliticianRefRow?> PoliticianAsync(Guid politicianId, CancellationToken ct) =>
        Task.FromResult(Politicians.FirstOrDefault(p => p.Id == politicianId));

    public Task<IReadOnlyList<XrayCandidacyRow>> SubjectCandidaciesAsync(Guid politicianId, Guid? personId, CancellationToken ct) =>
        Task.FromResult(L(Candidacies.Where(c => c.PoliticianId == politicianId || (personId is not null && c.PersonId == personId))));

    public Task<IReadOnlyList<XrayCandidacyRow>> CandidaciesAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct) =>
        Task.FromResult(L(Candidacies.Where(c => candidacyIds.Contains(c.Id))));

    public Task<IReadOnlyList<CandidacyZoneVotesRow>> ZoneVotesAsync(IReadOnlyList<Guid> candidacyIds, string? uf, string? municipalityTseCode, CancellationToken ct) =>
        Task.FromResult(L(ZoneVotes.Where(v => candidacyIds.Contains(v.CandidacyId) && (uf is null || v.Uf == uf)
            && (municipalityTseCode is null || v.MunicipalityTseCode == municipalityTseCode))));

    public Task<IReadOnlyList<ZoneTotalsRow>> ZoneTotalsAsync(IReadOnlyList<ElectionOffice> keys, string? uf, string? municipalityTseCode, CancellationToken ct) =>
        Task.FromResult(L(Totals.Where(t => keys.Contains(new ElectionOffice(t.Year, t.Round, t.OfficeCode)) && (uf is null || t.Uf == uf)
            && (municipalityTseCode is null || t.MunicipalityTseCode == municipalityTseCode))));

    public Task<IReadOnlyList<ExpectedZoneRow>> ExpectedZonesAsync(IReadOnlyList<(int Year, int Round)> elections, string? uf, string? municipalityTseCode, CancellationToken ct) =>
        Task.FromResult(L(Expected.Where(e => elections.Contains((e.Year, e.Round)) && (uf is null || e.Uf == uf)
            && (municipalityTseCode is null || e.MunicipalityTseCode == municipalityTseCode))));

    public Task<IReadOnlyList<ContestRankRow>> RanksAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct) =>
        Task.FromResult(L(Ranks.Where(r => candidacyIds.Contains(r.CandidacyId))));

    public Task<IReadOnlyList<TicketRow>> TicketsAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct) =>
        Task.FromResult(L(Tickets.Where(t => candidacyIds.Contains(t.CandidacyId))));

    public Task<IReadOnlyList<AssetRow>> AssetsAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct) =>
        Task.FromResult(L(Assets.Where(a => candidacyIds.Contains(a.CandidacyId))));

    public Task<IReadOnlyList<SourceRecordRow>> RecordsAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct) =>
        Task.FromResult(L(Records.Where(r => candidacyIds.Contains(r.CandidacyId))));

    public Task<IReadOnlyList<FinanceTotalsRow>> FinanceTotalsAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct) =>
        Task.FromResult(L(Finance.Where(f => candidacyIds.Contains(f.CandidacyId)).Select(f => f.Row)));

    public Task<IReadOnlyList<FinanceCategoryRow>> FinanceCategoriesAsync(Guid candidacyId, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<FinanceCategoryRow>>([]);

    public Task<IReadOnlyList<FinanceCounterpartyRow>> FinanceCounterpartiesAsync(Guid candidacyId, string recordKind, int limit, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<FinanceCounterpartyRow>>([]);

    public Task<IReadOnlyList<PriorRow>> PriorsAsync(IReadOnlyList<Guid> candidacyIds, CancellationToken ct) =>
        Task.FromResult(L(Priors.Where(p => candidacyIds.Contains(p.CandidacyId))));

    public Task<IReadOnlyList<SectionResultRow>> SectionResultsAsync(IReadOnlyList<ElectionOffice> keys, string uf, string municipalityTseCode, int? zone, CancellationToken ct) =>
        Task.FromResult(L(Sections.Where(r => keys.Contains(new ElectionOffice(r.Year, r.Round, r.OfficeCode)) && r.Uf == uf
            && r.MunicipalityTseCode == municipalityTseCode && (zone is null || r.Zone == zone))));

    public Task<IReadOnlyList<SectionCandidacyVotesRow>> SectionVotesAsync(IReadOnlyList<Guid> candidacyIds, string uf, string municipalityTseCode, int? zone, CancellationToken ct)
    {
        var results = Sections.Where(r => r.Uf == uf && r.MunicipalityTseCode == municipalityTseCode && (zone is null || r.Zone == zone))
            .Select(r => r.ResultId).ToHashSet();
        return Task.FromResult(L(SectionVotes.Where(v => candidacyIds.Contains(v.CandidacyId) && results.Contains(v.ResultId))));
    }

    public Task<IReadOnlyList<PlaceNameRow>> PlacesAsync(IReadOnlyList<(int Year, int Round)> elections, string uf, string municipalityTseCode, int? zone, CancellationToken ct) =>
        Task.FromResult(L(Places.Where(p => elections.Contains((p.Year, p.Round)) && p.MunicipalityTseCode == municipalityTseCode
            && (zone is null || p.Zone == zone))));

    public Task<IReadOnlyList<XrayCandidacyRow>> ElectionCandidaciesAsync(int year, int round, string uf, string? municipalityTseCode, CancellationToken ct) =>
        Task.FromResult(L(Candidacies.Where(c => c.Year == year && c.Round == round && (c.Scope == "federal" || c.ContestUf == uf)
            && (municipalityTseCode is null || c.Scope != "municipal" || c.ElectoralUnit == municipalityTseCode))));

    public Task<IReadOnlyList<MunicipalityRefRow>> MunicipalitiesAsync(string uf, CancellationToken ct) =>
        Task.FromResult(L(Municipalities.Where(m => m.Uf == uf)));

    public Task<FreshnessRow?> FreshnessAsync(CancellationToken ct) => Task.FromResult(Freshness);
}

/// <summary>Construtores de linhas sintéticas (dados fictícios; nenhum resultado real).</summary>
public static class Xray
{
    public static XrayCandidacyRow Candidacy(
        Guid id, int year, int office, string scope, string unit, int number, string ballot, Guid? person = null,
        Guid? politician = null, bool hasLink = true, int round = 1, string? insertedInUrn = null, string? outcome = null,
        bool? elected = null, string officeName = "Deputado Estadual", string uf = "CE", int electionCode = 0) => new()
        {
            Id = id,
            TseCandidateId = Math.Abs(id.GetHashCode()),
            CandidateNumber = number,
            BallotName = ballot,
            PartyAcronym = "PF",
            PartyNumber = number / 100 > 0 ? number / 1000 : number,
            IdentityStatus = person is null ? "unresolved_document_unavailable" : "resolved",
            PersonId = person,
            PoliticianId = politician,
            PoliticianName = ballot,
            Year = (short)year,
            Round = (short)round,
            TseElectionCode = electionCode == 0 ? year * 10 + round : electionCode,
            OfficeCode = office,
            OfficeName = officeName,
            Scope = scope,
            ElectoralUnit = unit,
            ContestUf = scope == "federal" ? null : uf,
            UnitName = scope == "municipal" ? "Município Fictício" : scope == "state" ? "Estado Fictício" : "Brasil",
            SourceUrl = "https://cdn.tse.jus.br/fixture.zip",
            SourceZipSha256 = new string('a', 64),
            SourceMember = "fixture.csv",
            SourceLine = 2,
            HasLink = hasLink,
            InsertedInUrn = insertedInUrn,
            RoundOutcome = outcome,
            Elected = elected,
        };

    public static SectionResultRow Section(long id, int year, int office, int section, int[] members, string place = "1001",
        long valid = 100, int zone = 1, string municipality = "99999", int round = 1) => new()
        {
            ResultId = id,
            Year = (short)year,
            Round = (short)round,
            OfficeCode = office,
            Uf = "CE",
            MunicipalityTseCode = municipality,
            MunicipalityName = "MUNICÍPIO FICTÍCIO",
            Zone = zone,
            Section = section,
            SectionMembers = members,
            PollingPlaceCode = place,
            Eligible = 200,
            Turnout = 150,
            ValidVotes = valid,
        };

    public static SectionCandidacyVotesRow Votes(long resultId, Guid candidacy, long votes) =>
        new() { ResultId = resultId, CandidacyId = candidacy, Votes = votes };

    public static ZoneTotalsRow Totals(int year, int office, string municipality, int zone, long valid, int round = 1) => new()
    {
        Year = (short)year,
        Round = (short)round,
        OfficeCode = office,
        Uf = "CE",
        MunicipalityTseCode = municipality,
        MunicipalityName = municipality,
        Zone = zone,
        Urns = 10,
        Eligible = 1000,
        Turnout = 800,
        ValidVotes = valid,
        VotesTotal = valid + 50,
    };

    public static ExpectedZoneRow Zone(int year, string municipality, int zone, string name, int round = 1) => new()
    {
        Year = (short)year,
        Round = (short)round,
        Uf = "CE",
        MunicipalityTseCode = municipality,
        MunicipalityName = name,
        Zone = zone,
    };

    public static CandidacyZoneVotesRow ZoneVotes(Guid candidacy, string municipality, int zone, long votes) =>
        new() { CandidacyId = candidacy, Uf = "CE", MunicipalityTseCode = municipality, Zone = zone, Votes = votes, UrnsWithVotes = 1 };
}
