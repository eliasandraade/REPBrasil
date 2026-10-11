using System.Globalization;
using RepBrasil.Application.Interfaces;
using RepBrasil.Application.Search;

namespace RepBrasil.Application.Overview;

/// <summary>
/// Visão geral do que a plataforma cobre hoje — só o que está importado (Boletim de Urna presente), nunca promessa.
/// Alimenta a página inicial: pleitos por UF com o tamanho do território e as bases oficiais com a data do download.
/// </summary>
public sealed class OverviewService(IOverviewRepository repo)
{
    /// <summary>Tipo de arquivo oficial → (quem publica, o que é). Tipos desconhecidos aparecem pelo próprio código.</summary>
    private static readonly IReadOnlyDictionary<string, (string Publisher, string Label, int Order)> SourceLabels =
        new Dictionary<string, (string, string, int)>
        {
            ["tse-open-data-bu"] = ("TSE", "Boletins de Urna (votos por seção)", 0),
            ["tse-open-data-candidates"] = ("TSE", "Candidaturas", 1),
            ["tse-open-data-candidate-complement"] = ("TSE", "Situação das candidaturas na urna", 2),
            ["tse-open-data-candidacy-history"] = ("TSE", "Candidaturas de anos anteriores", 3),
            ["tse-open-data-candidate-assets"] = ("TSE", "Bens declarados", 4),
            ["tse-open-data-campaign-finance"] = ("TSE", "Prestação de contas de campanha", 5),
            ["tse-open-data-candidate-social-network"] = ("TSE", "Redes sociais informadas", 6),
            ["tse-open-data-polling-places"] = ("TSE", "Locais de votação", 7),
            ["tse-open-data-municipality-codes"] = ("TSE", "Códigos de municípios TSE × IBGE", 8),
        };

    public async Task<OverviewResponse> GetAsync(CancellationToken ct)
    {
        var data = await repo.OverviewAsync(ct);
        var elections = data.Coverage
            .OrderByDescending(c => c.Year).ThenBy(c => c.Round).ThenBy(c => c.Uf, StringComparer.Ordinal)
            .Select(c => new CoverageElectionDto(c.Year, c.Round, c.Uf.Trim(), c.StateName ?? c.Uf.Trim(), c.Municipalities, c.Zones,
                c.Sections, c.Eligible, Offices(c.Offices)))
            .ToList();
        var sources = data.Sources
            .Select(s => (Row: s, Meta: SourceLabels.TryGetValue(s.Kind, out var meta) ? meta : ("TSE", s.Kind, int.MaxValue)))
            .OrderBy(s => s.Meta.Item3).ThenBy(s => s.Row.Kind, StringComparer.Ordinal)
            .Select(s => new SourceDto(s.Row.Kind, s.Meta.Item1, s.Meta.Item2, s.Row.Files, s.Row.LatestDownload))
            .ToList();
        return new OverviewResponse(elections, data.Totals.Candidacies, data.Totals.Politicians, sources, data.Totals.LatestImport);
    }

    private static IReadOnlyList<OfficeRefDto> Offices(string codes) =>
        codes.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(c => int.TryParse(c, NumberStyles.Integer, CultureInfo.InvariantCulture, out var code) ? code : (int?)null)
            .OfType<int>()
            .Distinct()
            .Order()
            .Select(code => new OfficeRefDto(code, SearchService.OfficeNames.GetValueOrDefault(code, $"Cargo {code}")))
            .ToList();
}
