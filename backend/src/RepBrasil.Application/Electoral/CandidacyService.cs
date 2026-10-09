using RepBrasil.Application.Interfaces;

namespace RepBrasil.Application.Electoral;

/// <summary>
/// Candidaturas oficiais de um perfil e desempenho territorial a partir do BU.
/// Votos são FATO (soma dos lotes vigentes); participação nos válidos é MÉTRICA DERIVADA.
/// Nada aqui alimenta o Score: dados eleitorais são descritivos.
/// </summary>
public class CandidacyService(IElectoralReadRepository repo)
{
    public const int AllUfs = 27;

    public static readonly IReadOnlyDictionary<string, string> Definitions = new Dictionary<string, string>
    {
        ["votes"] = "fato: soma dos votos da candidatura nos Boletins de Urna oficiais importados (lote vigente de cada zona)",
        ["shareOfValidVotes"] = "métrica derivada: votos ÷ votos válidos (nominais + legenda) do mesmo cargo no município",
        ["coverage"] = "abrangência: só UFs cujo Boletim de Urna foi importado; disputa federal fora delas não está somada",
    };

    public static CoverageDto Coverage(string electoralUnit, IReadOnlyList<CoverageRow> coverage)
    {
        static bool Complete(CoverageRow c) => c.MunicipalitiesInCadaster > 0 && c.MunicipalitiesWithResults == c.MunicipalitiesInCadaster;
        var relevant = electoralUnit == "BR"
            ? coverage.Where(c => c.MunicipalitiesWithResults > 0).OrderBy(c => c.Uf).ToList()
            : coverage.Where(c => c.Uf == electoralUnit).ToList();
        var complete = electoralUnit == "BR"
            ? relevant.Count == AllUfs && relevant.All(Complete)
            : relevant.Count == 1 && Complete(relevant[0]);
        var ufs = relevant.Select(c => new CoverageUfDto(c.Uf, c.MunicipalitiesWithResults, c.MunicipalitiesInCadaster)).ToList();
        var note = complete
            ? "Todas as seções da disputa estão importadas."
            : electoralUnit == "BR"
                ? $"Disputa nacional: votos somados apenas nas UFs importadas ({string.Join(", ", ufs.Select(u => u.Uf))})."
                : "Cobertura parcial: nem todos os municípios da UF têm Boletim de Urna importado.";
        return new CoverageDto(complete, ufs, note);
    }

    public static TerritoryPerformanceDto TerritoryView(TerritoryVotesRow r) => new(
        r.Uf, r.MunicipalityTseCode, r.MunicipalityName, r.MunicipalitySlug, r.Votes, r.ValidVotes,
        r.ValidVotes > 0 ? Math.Round(r.Votes * 10000.0 / r.ValidVotes, MidpointRounding.AwayFromZero) / 100 : null,
        r.Urns);

    private static CandidacyDto View(CandidacyRow c, CandidacyPerformanceDto? performance) => new(
        c.Id, c.TseCandidateId,
        new ContestDto(c.Year, c.Round, c.TseElectionCode, c.TseElectionDescription, c.OfficeCode, c.OfficeName, c.Scope, c.ElectoralUnit),
        c.CandidateNumber, c.BallotName,
        c.PartyNumber is null && c.PartyAcronym is null ? null : new PartyDto(c.PartyNumber ?? 0, c.PartyAcronym, c.PartyName),
        c.FederationAcronym, c.CoalitionName, c.CandidacyStatus, c.RoundOutcome, c.Elected,
        c.IdentityStatus, c.PersonId, c.PoliticianId, c.PoliticianId is not null,
        new CandidacySourceDto("Tribunal Superior Eleitoral · Dados Abertos (Candidatos)", c.SourceUrl, c.SourceZipSha256,
            c.SourceMember, c.SourceLine),
        performance);

    private async Task<CandidacyPerformanceDto?> PerformanceAsync(
        CandidacyRow c, int? top, Dictionary<(int, int), IReadOnlyList<CoverageRow>> coverageCache, CancellationToken ct)
    {
        if (!c.HasVotes) return null;
        var rows = await repo.CandidacyVotesByMunicipalityAsync(c.Id, ct);
        if (!coverageCache.TryGetValue((c.Year, c.Round), out var coverage))
        {
            coverage = await repo.ResultsCoverageAsync(c.Year, c.Round, ct);
            coverageCache[(c.Year, c.Round)] = coverage;
        }

        var ordered = rows.OrderByDescending(r => r.Votes).ThenBy(r => r.MunicipalityName).ToList();
        var shown = top is { } n ? ordered.Take(n) : ordered;
        return new CandidacyPerformanceDto(
            rows.Sum(r => r.Votes), Coverage(c.ElectoralUnit, coverage), shown.Select(TerritoryView).ToList(),
            rows.Count(r => r.Votes > 0), Definitions);
    }

    public async Task<PoliticianCandidaciesResponse> ByPoliticianAsync(Guid politicianId, int topMunicipalities, CancellationToken ct)
    {
        var rows = await repo.CandidaciesByPoliticianAsync(politicianId, ct);
        var cache = new Dictionary<(int, int), IReadOnlyList<CoverageRow>>();
        var list = new List<CandidacyDto>();
        foreach (var c in rows)
        {
            list.Add(View(c, await PerformanceAsync(c, topMunicipalities, cache, ct)));
        }

        return new PoliticianCandidaciesResponse(politicianId, list);
    }

    public async Task<CandidacyDto> PerformanceAsync(Guid candidacyId, CancellationToken ct)
    {
        var c = await repo.CandidacyAsync(candidacyId, ct)
            ?? throw new ElectoralNotFoundException($"Candidatura {candidacyId} não encontrada.");
        return View(c, await PerformanceAsync(c, null, [], ct));
    }
}
