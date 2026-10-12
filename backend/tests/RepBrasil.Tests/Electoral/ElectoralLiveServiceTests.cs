using RepBrasil.Application.ElectoralLive;

namespace RepBrasil.Tests.Electoral;

public sealed class ElectoralLiveServiceTests
{
    [Fact]
    public async Task RegisteredPollRemainsVisibleWithoutResultScenario()
    {
        var row = new PollRow(
            Guid.NewGuid(), "CE-00001/2026", "Instituto Exemplo",
            new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 3), null,
            1200, 2.5m, 95m, "Entrevistas presenciais", "https://example.test/source",
            DateTimeOffset.Parse("2026-10-04T12:00:00Z"),
            null, null, null, null, null, null, null, null, null);
        var service = new ElectoralLiveService(new FakeRepository([row], []));

        var response = await service.PollsAsync(2026, 1, 3, "ce", null, CancellationToken.None);

        var poll = Assert.Single(response.Polls);
        Assert.Equal("CE", response.Uf);
        Assert.Equal("CE-00001/2026", poll.RegistrationNumber);
        Assert.Empty(poll.Scenarios);
    }

    [Fact]
    public async Task LiveCountKeepsMissingVotesAndPercentagesMissing()
    {
        var snapshotId = Guid.NewGuid();
        var row = new LiveCountRow(
            snapshotId, "state", "partial", 100, 200, 50m,
            DateTimeOffset.Parse("2026-10-04T20:00:00Z"), null,
            "https://resultados.tse.jus.br/example.json", 1, null, 55,
            "Candidata Exemplo", "ABC", null, null, null);
        var service = new ElectoralLiveService(new FakeRepository([], [row]));

        var response = await service.LiveCountAsync(2026, 1, 3, "CE", null, CancellationToken.None);

        Assert.NotNull(response.Snapshot);
        var candidate = Assert.Single(response.Snapshot!.Results);
        Assert.Null(candidate.Votes);
        Assert.Null(candidate.Percentage);
        Assert.Equal("partial", response.Snapshot.Status);
    }

    [Fact]
    public async Task MunicipalityRequiresUfBeforeRepositoryCall()
    {
        var service = new ElectoralLiveService(new FakeRepository([], []));
        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.LiveCountAsync(2026, 1, 3, null, "13897", CancellationToken.None));
    }

    private sealed class FakeRepository(
        IReadOnlyList<PollRow> polls,
        IReadOnlyList<LiveCountRow> live) : IElectoralLiveRepository
    {
        public Task<IReadOnlyList<PollRow>> PollsAsync(
            int year, int round, int office, string? uf, string? municipalityTseCode,
            CancellationToken ct) => Task.FromResult(polls);

        public Task<IReadOnlyList<LiveCountRow>> LatestLiveCountAsync(
            int year, int round, int office, string scope, string? uf,
            string? municipalityTseCode, CancellationToken ct) => Task.FromResult(live);
    }
}
