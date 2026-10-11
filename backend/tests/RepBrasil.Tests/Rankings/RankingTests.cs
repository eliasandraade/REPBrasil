using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Electoral;
using RepBrasil.Application.Rankings;
using RepBrasil.Infrastructure.Repositories;
using RepBrasil.Tests.Electoral;

namespace RepBrasil.Tests.Rankings;

/// <summary>Rankings: regras de comparabilidade (serviço) e SQL contra o schema real. Dados fictícios.</summary>
public class RankingTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private sealed class FakeRankings : IRankingRepository
    {
        public List<RankingCandidacyRow> Rows { get; } = [];
        public List<RankingCoverageRow> Coverage { get; } = [];

        public Task<IReadOnlyList<RankingCandidacyRow>> CandidaciesAsync(RankingFilter filter, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<RankingCandidacyRow>>(Rows);

        public Task<IReadOnlyList<RankingCoverageRow>> CoverageAsync(int office, string uf, string? municipalityTseCode, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<RankingCoverageRow>>(Coverage);

        public Task<IReadOnlyList<RankingPartyRow>> PartiesAsync(RankingFilter filter, bool includeLegend, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<RankingPartyRow>>([]);

        public Task<IReadOnlyList<RankingRecurrenceRow>> RecurrenceAsync(string uf, int? office, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<RankingRecurrenceRow>>([]);
    }

    private static RankingCandidacyRow Row(string name, long? votes, bool link = true, long valid = 1000, decimal? assets = null,
        long? previous = null, short? previousYear = null, string scope = "state", string unit = "CE", int office = 7) => new()
        {
            CandidacyId = Guid.NewGuid(),
            BallotName = name,
            OfficeCode = office,
            OfficeName = "Deputado Estadual",
            Scope = scope,
            ElectoralUnit = unit,
            HasLink = link,
            Votes = votes,
            ValidVotes = valid,
            Assets = assets,
            MunicipalitiesCovered = 2,
            MunicipalitiesWithVotes = votes > 0 ? 2 : 0,
            PreviousVotes = previous,
            PreviousYear = previousYear,
            PreviousRound = previousYear is null ? null : (short)1,
        };

    private static (RankingService Service, FakeRankings Repo) Service()
    {
        var repo = new FakeRankings();
        repo.Coverage.AddRange([
            new RankingCoverageRow { Year = 2026, Round = 1, MunicipalityTseCode = "13897", ZonesExpected = 2, ZonesCovered = 2 },
            new RankingCoverageRow { Year = 2022, Round = 1, MunicipalityTseCode = "13897", ZonesExpected = 2, ZonesCovered = 2 },
        ]);
        return (new RankingService(repo, new FakeXrayRepository()), repo);
    }

    [Fact]
    public void Ties_share_the_competition_position() =>
        Assert.Equal([1, 2, 2, 4], RankingService.Positions([30, 20, 20, 10]));

    [Fact]
    public async Task Missing_metrics_are_excluded_and_counted_never_ranked_as_zero()
    {
        var (service, repo) = Service();
        repo.Rows.AddRange([Row("A", 300), Row("B", 120), Row("SEM VÍNCULO", null, link: false), Row("C", 120)]);
        var result = await service.RankAsync("votes", 2026, 1, 7, "ce", null, null, 1, 50, Ct);
        Assert.Equal(["A", "B", "C"], result.Items.Select(i => i.Name));
        Assert.Equal([1, 2, 2], result.Items.Select(i => i.Position));
        Assert.Equal(1, result.Excluded);
        Assert.Contains("nunca contadas como zero", result.ExcludedNote);
        Assert.True(result.Coverage!.Complete);
    }

    [Fact]
    public async Task Ticket_members_rank_by_their_own_declarations_but_never_by_votes()
    {
        var (service, repo) = Service();
        repo.Rows.AddRange([Row("TITULAR", 300, assets: 100m), Row("VICE", 300, assets: 500m, office: 4)]);

        var assets = await service.RankAsync("assets", 2026, 1, null, "CE", null, null, 1, 50, Ct);
        Assert.Equal(["VICE", "TITULAR"], assets.Items.Select(i => i.Name)); // bens são de cada candidatura
        Assert.Equal(2, (await service.RankAsync("assets", 2026, 1, 4, "CE", null, null, 1, 50, Ct)).Total);

        var votes = await service.RankAsync("votes", 2026, 1, 3, "CE", null, null, 1, 50, Ct);
        Assert.Equal(["TITULAR"], votes.Items.Select(i => i.Name)); // voto é da chapa: só o titular
        await Assert.ThrowsAsync<ElectoralBadRequestException>(() => service.RankAsync("votes", 2026, 1, 4, "CE", null, null, 1, 50, Ct));
    }

    [Fact]
    public async Task Municipal_offices_need_a_municipality_for_absolute_votes()
    {
        var (service, _) = Service();
        var error = await Assert.ThrowsAsync<ElectoralBadRequestException>(() => service.RankAsync("votes", 2024, 1, 13, "CE", null, null, 1, 50, Ct));
        Assert.Contains("município", error.Message);
        await Assert.ThrowsAsync<ElectoralBadRequestException>(() => service.RankAsync("capillarity", 2024, 1, 11, "CE", null, null, 1, 50, Ct));
        await Assert.ThrowsAsync<ElectoralBadRequestException>(() => service.RankAsync("votes", 2024, 1, 12, "CE", "13935", null, 1, 50, Ct)); // vice
        await Assert.ThrowsAsync<ElectoralBadRequestException>(() => service.RankAsync("votes", null, 1, 7, "CE", null, null, 1, 50, Ct));
        await Assert.ThrowsAsync<ElectoralBadRequestException>(() => service.RankAsync("nada", 2024, 1, 7, "CE", null, null, 1, 50, Ct));
    }

    [Fact]
    public async Task Growth_needs_the_same_contest_and_complete_coverage_in_both_elections()
    {
        var (service, repo) = Service();
        repo.Rows.AddRange([
            Row("CRESCEU", 500, previous: 200, previousYear: 2022),
            Row("CAIU", 100, previous: 400, previousYear: 2022),
            Row("ESTREANTE", 900),
        ]);
        var growth = await service.RankAsync("growth", 2026, 1, 7, "CE", null, null, 1, 50, Ct);
        Assert.Equal(["CRESCEU"], growth.Items.Select(i => i.Name));
        Assert.Equal(300, growth.Items[0].Value);
        var decline = await service.RankAsync("decline", 2026, 1, 7, "CE", null, null, 1, 50, Ct);
        Assert.Equal(["CAIU"], decline.Items.Select(i => i.Name));

        repo.Coverage.RemoveAll(c => c.Year == 2022);
        repo.Coverage.Add(new RankingCoverageRow { Year = 2022, Round = 1, MunicipalityTseCode = "13897", ZonesExpected = 2, ZonesCovered = 1 });
        var partial = await service.RankAsync("growth", 2026, 1, 7, "CE", null, null, 1, 50, Ct);
        Assert.Empty(partial.Items); // cobertura parcial na eleição anterior: sem variação afirmada
    }

    [Fact]
    public async Task Without_bu_coverage_vote_rankings_are_empty_with_the_reason()
    {
        var (service, repo) = Service();
        repo.Coverage.Clear();
        repo.Rows.Add(Row("A", 300));
        var result = await service.RankAsync("votes", 2026, 1, 7, "CE", null, null, 1, 50, Ct);
        Assert.Empty(result.Items);
        Assert.Contains("Sem Boletim de Urna", result.ExcludedNote);
    }

    // ── SQL (schema real, dados fictícios revertidos) ───────────────────────

    [ElectoralSchemaFact]
    public async Task Ranking_sql_reads_votes_growth_assets_and_recurrence_from_the_derived_aggregates()
    {
        await using var db = ElectoralXraySchemaTests.Db();
        await using var tx = await db.Database.BeginTransactionAsync(Ct);
        await db.Database.ExecuteSqlRawAsync(ElectoralXraySchemaTests.Seed, Ct);
        try
        {
            var service = new RankingService(new RankingRepository(db), new ElectoralXrayRepository(db));
            var votes = await service.RankAsync("votes", 2099, 1, 7, "XX", null, null, 1, 50, Ct);
            Assert.Equal([("CANDIDATA A", 33.0), ("CANDIDATO B", 18.0)], votes.Items.Select(i => (i.Name, i.Value)));
            Assert.True(votes.Coverage!.Complete);
            Assert.Equal(50.0, votes.Items[0].Details["share"]); // 33 ÷ 66 válidos (nominais + legenda)

            var growth = await service.RankAsync("growth", 2099, 1, 7, "XX", null, null, 1, 50, Ct);
            var a = Assert.Single(growth.Items);
            Assert.Equal((18.0, (short?)2098), (a.Value, (short?)a.Details["previousYear"]));
            var decline = await service.RankAsync("decline", 2099, 1, 7, "XX", null, null, 1, 50, Ct);
            Assert.Equal(11.0, Assert.Single(decline.Items).Value);

            var strength = await service.RankAsync("territorial_strength", 2099, 1, 7, "XX", null, null, 1, 50, Ct);
            Assert.Equal("CANDIDATA A", Assert.Single(strength.Items).Name);

            var assets = await service.RankAsync("assets", 2099, 1, null, "XX", null, null, 1, 50, Ct);
            Assert.Equal((150000.0, 1), (Assert.Single(assets.Items).Value, assets.Excluded));
            var assetGrowth = await service.RankAsync("asset_growth", 2099, 1, null, "XX", null, null, 1, 50, Ct);
            Assert.Equal(50000.0, Assert.Single(assetGrowth.Items).Value);

            var recurrence = await service.RankAsync("recurrence", null, null, null, "XX", null, null, 1, 50, Ct);
            Assert.Equal([2.0, 2.0], recurrence.Items.Select(i => i.Value));
        }
        finally
        {
            await tx.RollbackAsync(Ct);
        }
    }
}
