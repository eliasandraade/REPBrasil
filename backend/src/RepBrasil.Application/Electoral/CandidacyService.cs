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
        ["coverage"] = "abrangência: escopos município × zona do cadastro com Boletim de Urna vigente; completa só quando todos estão importados",
    };

    /// <summary>Cobertura por UF a partir dos escopos município × zona esperados no cadastro.</summary>
    public static IReadOnlyList<CoverageUfDto> CoverageByUf(IReadOnlyList<CoverageScopeRow> scopes) =>
        scopes.GroupBy(s => s.Uf)
            .OrderBy(g => g.Key, StringComparer.Ordinal)
            .Select(g =>
            {
                var municipalities = g.GroupBy(s => s.MunicipalityTseCode).ToList();
                var expected = g.Count();
                var imported = g.Count(s => s.Imported);
                return new CoverageUfDto(
                    g.Key, expected > 0 && imported == expected, imported, expected,
                    municipalities.Count(m => m.All(s => s.Imported)),
                    municipalities.Count(m => m.Any(s => s.Imported)),
                    municipalities.Count);
            })
            .ToList();

    /// <summary>
    /// Abrangência dos votos somados para uma disputa. Disputa estadual: completa só se todos os escopos
    /// município × zona da UF tiverem resultado vigente. Disputa federal: exige todas as UFs completas e,
    /// como os votos do exterior ainda não são modelados, nunca é declarada completa nesta versão.
    /// </summary>
    public static CoverageDto Coverage(string electoralUnit, IReadOnlyList<CoverageScopeRow> scopes)
    {
        var byUf = CoverageByUf(scopes);
        if (electoralUnit == "BR")
        {
            var imported = byUf.Where(u => u.ZonesWithResults > 0).ToList();
            var partialUfs = imported.Where(u => !u.Complete).Select(u => u.Uf).ToList();
            var note = $"Disputa nacional: votos somados apenas nas UFs importadas ({string.Join(", ", imported.Select(u => u.Uf))})"
                + (partialUfs.Count > 0 ? $", com importação parcial em {string.Join(", ", partialUfs)}" : "")
                + $"; {AllUfs - imported.Count(u => u.Complete)} UF(s) sem cobertura completa e votos do exterior não importados.";
            return new CoverageDto(false, imported, note);
        }

        var uf = byUf.FirstOrDefault(u => u.Uf == electoralUnit);
        if (uf is null)
            return new CoverageDto(false, [], $"Sem cadastro eleitoral importado para {electoralUnit}: nenhuma seção coberta.");
        return uf.Complete
            ? new CoverageDto(true, [uf], "Todas as seções da disputa estão importadas.")
            : new CoverageDto(false, [uf],
                $"Cobertura parcial: {uf.ZonesWithResults} de {uf.ZonesExpected} zonas (município × zona) com Boletim de Urna importado; "
                + $"{uf.MunicipalitiesComplete} de {uf.MunicipalitiesExpected} municípios completos.");
    }

    public static TerritoryPerformanceDto TerritoryView(TerritoryVotesRow r) => new(
        r.Uf, r.MunicipalityTseCode, r.MunicipalityName, r.MunicipalitySlug, r.Votes, r.ValidVotes,
        r.ValidVotes is > 0 ? Math.Round(r.Votes * 10000.0 / r.ValidVotes.Value, MidpointRounding.AwayFromZero) / 100 : null,
        r.Urns);

    private static CandidacyDto View(CandidacyRow c, CandidacyPerformanceDto? performance) => new(
        c.Id, c.TseCandidateId,
        new ContestDto(c.Year, c.Round, c.TseElectionCode, c.TseElectionDescription, c.OfficeCode, c.OfficeName, c.Scope, c.ElectoralUnit),
        c.CandidateNumber, c.BallotName,
        c.PartyNumber is null && c.PartyAcronym is null ? null : new PartyDto(c.PartyNumber, c.PartyAcronym, c.PartyName),
        c.FederationAcronym, c.CoalitionName, c.CandidacyStatus, c.RoundOutcome, c.Elected,
        c.IdentityStatus, c.PersonId, c.PoliticianId, c.PoliticianId is not null,
        new CandidacySourceDto("Tribunal Superior Eleitoral · Dados Abertos (Candidatos)", c.SourceUrl, c.SourceZipSha256,
            c.SourceMember, c.SourceLine),
        performance);

    private async Task<CandidacyPerformanceDto?> PerformanceAsync(
        CandidacyRow c, int? top, Dictionary<(int, int), IReadOnlyList<CoverageScopeRow>> coverageCache, CancellationToken ct)
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
        var cache = new Dictionary<(int, int), IReadOnlyList<CoverageScopeRow>>();
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
