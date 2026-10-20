using System.Text;
using RepBrasil.API.Infrastructure;
using RepBrasil.Application.DataIntelligence;

namespace RepBrasil.Tests.DataIntelligence;

/// <summary>Peças do explorador territorial sem banco: cobertura, matriz por pares e o CSV com proveniência.</summary>
public sealed class DataExplorerUnitTests
{
    private static readonly DateTimeOffset Retrieved = new(2026, 10, 11, 3, 4, 5, TimeSpan.Zero);

    private static IndicatorValueDto Value(string indicator, string municipality, decimal value, int period = 2022) =>
        new(indicator, municipality, $"M{municipality}", period, value, "IBGE", "fixture", Retrieved);

    private static readonly IReadOnlyList<IndicatorDto> Catalog =
    [
        new("ibge.population", "População", "pessoas", "IBGE/SIDRA", "", false),
        new("ibge.literacy", "Alfabetização", "%", "IBGE/SIDRA", "", false),
        new("atlas.idhm", "IDHM", "índice", "Atlas", "", false),
    ];

    [Fact]
    public void Coverage_lists_every_state_and_only_what_is_loaded_in_each()
    {
        var coverage = DataIntelligenceService.BuildCoverage(new CoverageRows(
            [new("CE", "Ceará", 23, 184), new("AC", "Acre", 12, 22)],
            [new("CE", "ibge.population", 2022, 184), new("CE", "ibge.population", 2010, 184)],
            [new("CE", 2022, 1, 184), new("CE", 2026, 1, 184)],
            [new("CE", 2015, 120, 900), new("CE", 2026, 150, 1200)]));

        Assert.Equal(["AC", "CE"], coverage.States.Select(s => s.Uf));
        var acre = coverage.States[0];
        Assert.Empty(acre.Socioeconomic);
        Assert.Empty(acre.Elections);
        Assert.Empty(acre.Amendments);
        var ceara = coverage.States[1];
        Assert.Equal([2022, 2010], ceara.Socioeconomic.Select(i => i.Period));
        Assert.Equal([2026, 2022], ceara.Elections.Select(e => e.Year));
        Assert.Equal([2026, 2015], ceara.Amendments.Select(a => a.Year));
    }

    [Fact]
    public void Matrix_pairs_only_municipalities_observed_in_both_and_skips_indicators_without_values()
    {
        var matrix = DataIntelligenceService.BuildMatrix("CE", 2022, Catalog,
        [
            Value("ibge.population", "1", 10),
            Value("ibge.population", "2", 20),
            Value("ibge.population", "3", 30),
            Value("ibge.literacy", "1", 50),
            Value("ibge.literacy", "2", 60),
            Value("ibge.literacy", "9", 70, period: 2010),
        ]);

        Assert.Equal(["ibge.population", "ibge.literacy"], matrix.Indicators.Select(i => i.Code));
        Assert.Equal([3, 2], matrix.Indicators.Select(i => i.N));
        var cell = Assert.Single(matrix.Cells);
        Assert.Equal(("ibge.population", "ibge.literacy", 2), (cell.X, cell.Y, cell.N));
        Assert.Equal(1d, cell.Pearson!.Value, 10);
        Assert.Contains("Correlação não implica causalidade", matrix.Caveat);
    }

    [Fact]
    public void Matrix_without_enough_shared_municipalities_reports_no_coefficient()
    {
        var matrix = DataIntelligenceService.BuildMatrix("CE", 2022, Catalog,
            [Value("ibge.population", "1", 10), Value("ibge.literacy", "2", 60)]);
        var cell = Assert.Single(matrix.Cells);
        Assert.Equal(0, cell.N);
        Assert.Null(cell.Pearson);
        Assert.Null(cell.Spearman);
    }

    [Fact]
    public async Task Exports_require_a_state_before_touching_the_repository()
    {
        var service = new DataIntelligenceService(new UnusedRepository());
        await Assert.ThrowsAsync<ArgumentException>(() => service.ExportAsync("ibge.population", 2022, null, CancellationToken.None));
        await Assert.ThrowsAsync<ArgumentException>(() => service.BulkExportAsync(" ", null, CancellationToken.None));
        await Assert.ThrowsAsync<ArgumentException>(() => service.CorrelationMatrixAsync(null, 2022, CancellationToken.None));
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => service.BulkExportAsync("CE", 1500, CancellationToken.None));
    }

    [Fact]
    public void Csv_keeps_the_product_format_and_carries_provenance_on_every_row()
    {
        var bytes = IndicatorCsv.Write(
        [
            new IndicatorExportRow("CE", "2304400", "Fortaleza", "ibge.literacy", "Alfabetização; 15+", "%", 2022, 93.1200m, "IBGE/SIDRA", "censo-2022", Retrieved),
        ]);

        Assert.Equal(Encoding.UTF8.GetPreamble(), bytes[..3]);
        var lines = Encoding.UTF8.GetString(bytes[3..]).Split("\r\n");
        Assert.Equal("uf;municipio_ibge;municipio;indicador;indicador_nome;unidade;periodo;valor;fonte;conjunto;coletado_em", lines[0]);
        Assert.Equal("CE;2304400;Fortaleza;ibge.literacy;\"Alfabetização; 15+\";%;2022;93.12;IBGE/SIDRA;censo-2022;2026-10-11T03:04:05Z", lines[1]);
        Assert.Equal("", lines[^1]);
    }

    [Theory]
    [InlineData("=HYPERLINK(\"x\")", "\"'=HYPERLINK(\"\"x\"\")\"")]
    [InlineData("+55", "'+55")]
    [InlineData("@soma", "'@soma")]
    [InlineData("Juazeiro do Norte", "Juazeiro do Norte")]
    public void Csv_text_that_a_spreadsheet_would_run_as_a_formula_is_neutralized(string raw, string expected) =>
        Assert.Equal(expected, IndicatorCsv.Text(raw));

    [Fact]
    public void Csv_numbers_use_a_decimal_point_and_file_names_are_plain()
    {
        Assert.Equal("1234567.5", IndicatorCsv.Number(1234567.50m));
        Assert.Equal("-0.25", IndicatorCsv.Number(-0.2500m));
        Assert.Equal("repbrasil-ibge.population-ce-2022.csv", IndicatorCsv.FileName("ibge.population", "CE", 2022));
        Assert.Equal("repbrasil-indicadores-ce.csv", IndicatorCsv.FileName("indicadores", "CE", null));
        Assert.Equal("repbrasil-a-b-ce.csv", IndicatorCsv.FileName("a/b", "ce", null));
    }

    private sealed class UnusedRepository : IDataIntelligenceRepository
    {
        private static Exception Unexpected() => new InvalidOperationException("repository should not be called");
        public Task<IReadOnlyList<IndicatorDto>> CatalogAsync(CancellationToken ct) => throw Unexpected();
        public Task<IReadOnlyList<IndicatorValueDto>> ValuesAsync(string indicator, int? period, string? uf, CancellationToken ct) => throw Unexpected();
        public Task<IReadOnlyList<IndicatorValueDto>> StateValuesAsync(string uf, int? period, CancellationToken ct) => throw Unexpected();
        public Task<CoverageRows> CoverageAsync(CancellationToken ct) => throw Unexpected();
        public Task<IReadOnlyList<CorrelationPointDto>> IndicatorPairsAsync(string xIndicator, string yIndicator, int period, string? uf, CancellationToken ct) => throw Unexpected();
        public Task<IReadOnlyList<CorrelationPointDto>> CandidacySharePairsAsync(string xIndicator, Guid candidacyId, int period, string uf, int year, int round, int office, CancellationToken ct) => throw Unexpected();
    }
}
