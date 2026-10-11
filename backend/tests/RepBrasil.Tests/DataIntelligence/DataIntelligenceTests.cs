using RepBrasil.Application.DataIntelligence;

namespace RepBrasil.Tests.DataIntelligence;

public class DataIntelligenceTests
{
    [Fact]
    public void PearsonPerfectPositive()
    {
        var value = DataIntelligenceService.Pearson([1, 2, 3, 4], [2, 4, 6, 8]);
        Assert.NotNull(value);
        Assert.Equal(1d, value!.Value, 10);
    }

    [Fact]
    public void SpearmanUsesAverageRanksForTies()
    {
        var value = DataIntelligenceService.Spearman([1, 1, 3, 4], [10, 10, 30, 40]);
        Assert.NotNull(value);
        Assert.Equal(1d, value!.Value, 10);
    }

    [Fact]
    public void CorrelationNeedsTwoObservedPairs()
    {
        Assert.Null(DataIntelligenceService.Pearson([1], [2]));
        Assert.Null(DataIntelligenceService.Spearman([1], [2]));
    }

    [Fact]
    public async Task CandidacyCorrelationRejectsMismatchedPeriodBeforeRepository()
    {
        var service = new DataIntelligenceService(new NeverRepository());
        await Assert.ThrowsAsync<ArgumentException>(() => service.CorrelationAsync(
            "ibge.population", null, 2021, "CE", Guid.NewGuid(), 2022, 1, 7, CancellationToken.None));
    }

    private sealed class NeverRepository : IDataIntelligenceRepository
    {
        private static Exception Unexpected() => new InvalidOperationException("repository should not be called");
        public Task<IReadOnlyList<IndicatorDto>> CatalogAsync(CancellationToken ct) => throw Unexpected();
        public Task<IReadOnlyList<IndicatorValueDto>> ValuesAsync(string indicator, int? period, string? uf, CancellationToken ct) => throw Unexpected();
        public Task<IReadOnlyList<CorrelationPointDto>> IndicatorPairsAsync(string xIndicator, string yIndicator, int period, string? uf, CancellationToken ct) => throw Unexpected();
        public Task<IReadOnlyList<CorrelationPointDto>> CandidacySharePairsAsync(string xIndicator, Guid candidacyId, int period, string uf, int year, int round, int office, CancellationToken ct) => throw Unexpected();
    }
}
