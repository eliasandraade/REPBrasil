using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using RepBrasil.Application.Interfaces;
using RepBrasil.Application.Overview;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Repositories;

namespace RepBrasil.Tests.Electoral;

/// <summary>Visão geral da cobertura: só o que está importado, cargos pelo nome, fontes na ordem de leitura.</summary>
public class OverviewTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private sealed class FakeOverviewRepository(OverviewData data) : IOverviewRepository
    {
        public Task<OverviewData> OverviewAsync(CancellationToken ct) => Task.FromResult(data);
    }

    [Fact]
    public async Task Coverage_is_newest_first_with_office_names_and_known_sources_in_reading_order()
    {
        var data = new OverviewData(
            [
                new CoverageRow { Year = 2024, Round = 2, Uf = "CE", StateName = "Ceará", Municipalities = 2, Zones = 20, Sections = 6034, Eligible = 2015233, Offices = "11" },
                new CoverageRow { Year = 2026, Round = 1, Uf = "CE", StateName = "Ceará", Municipalities = 184, Zones = 109, Sections = 23765, Eligible = 6996545, Offices = "7,1,6,3,5" },
                new CoverageRow { Year = 2024, Round = 1, Uf = "CE ", StateName = null, Municipalities = 184, Zones = 109, Sections = 23357, Eligible = 6935539, Offices = "13,11,x" },
            ],
            [
                new SourceKindRow { Kind = "tse-open-data-polling-places", Files = 3 },
                new SourceKindRow { Kind = "tse-open-data-bu", Files = 5, LatestDownload = new DateTime(2026, 10, 10, 7, 5, 48, DateTimeKind.Utc) },
                new SourceKindRow { Kind = "algo-novo", Files = 1 },
            ],
            new OverviewTotalsRow { Candidacies = 15011, Politicians = 14432 });

        var r = await new OverviewService(new FakeOverviewRepository(data)).GetAsync(Ct);

        Assert.Equal([(2026, 1), (2024, 1), (2024, 2)], r.Elections.Select(e => (e.Year, e.Round)));
        Assert.Equal(["Presidente", "Governador", "Senador", "Deputado Federal", "Deputado Estadual"], r.Elections[0].Offices.Select(o => o.Name));
        Assert.Equal(("CE", "CE"), (r.Elections[1].Uf, r.Elections[1].StateName)); // sem nome da UF: a sigla
        Assert.Equal([11, 13], r.Elections[1].Offices.Select(o => o.Code)); // código inválido descartado
        Assert.Equal(["Boletins de Urna (votos por seção)", "Locais de votação", "algo-novo"], r.Sources.Select(s => s.Label));
        Assert.Equal((15011, 14432), (r.Candidacies, r.Politicians));
    }

    private static ApplicationDbContext Db() => new(new DbContextOptionsBuilder<ApplicationDbContext>()
        .UseNpgsql(Environment.GetEnvironmentVariable(ElectoralSchemaFactAttribute.Variable))
        .Options);

    [ElectoralSchemaFact]
    public async Task Repository_reads_the_real_schema()
    {
        await using var db = Db();
        var data = await new OverviewRepository(db, new MemoryCache(new MemoryCacheOptions())).OverviewAsync(Ct);
        Assert.NotNull(data.Totals);
        Assert.All(data.Coverage, c => Assert.True(c.Sections >= 0 && c.Municipalities >= 0));
    }
}
