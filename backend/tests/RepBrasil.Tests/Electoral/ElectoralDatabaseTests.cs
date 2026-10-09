using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Electoral;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Repositories;

namespace RepBrasil.Tests.Electoral;

/// <summary>Só roda com REPBRASIL_ELECTORAL_DB (banco com o CE 2026 importado). Somente leitura.</summary>
public sealed class ElectoralDatabaseFactAttribute : FactAttribute
{
    public const string Variable = "REPBRASIL_ELECTORAL_DB";

    public ElectoralDatabaseFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(Variable)))
            Skip = $"{Variable} não definida (banco eleitoral de integração)";
    }
}

/// <summary>
/// Integração contra o banco real (CE 2026, 1º turno): repositório SQL + serviços, os mesmos
/// números oficiais conferidos na auditoria do Urnaí. Nada é escrito.
/// </summary>
public class ElectoralDatabaseTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static (ElectoralCatalogService Catalog, SectionResultsService Results, CandidacyService Candidacies, ApplicationDbContext Db) Services()
    {
        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseNpgsql(Environment.GetEnvironmentVariable(ElectoralDatabaseFactAttribute.Variable))
            .Options;
        var db = new ApplicationDbContext(options);
        var repo = new ElectoralReadRepository(db);
        var catalog = new ElectoralCatalogService(repo);
        return (catalog, new SectionResultsService(repo, catalog), new CandidacyService(repo), db);
    }

    [ElectoralDatabaseFact]
    public async Task Catalog_reproduces_the_official_cadaster()
    {
        var (catalog, _, _, db) = Services();
        await using var _ = db;
        var states = await catalog.StatesAsync(2026, 1, Ct);
        var ce = states.States.Single(s => s.Uf == "CE");
        Assert.Equal(184, ce.Municipalities);
        Assert.Equal(184, ce.CadasterMunicipalities);

        var gs = await catalog.MunicipalityDetailAsync(2026, 1, "ce", "general-sampaio", Ct);
        var zone = Assert.Single(gs.Zones);
        Assert.Equal(50, zone.Number);
        Assert.Equal((35, 30, 5, 11), (zone.Sections, zone.PrincipalSections, zone.AggregatedSections, zone.PollingPlaces));
        Assert.Equal(8274, zone.Eligible.Federal);

        Assert.Equal([37, 120, 123], (await catalog.MunicipalityDetailAsync(2026, 1, "ce", "caucaia", Ct)).Zones.Select(z => z.Number));
        Assert.Equal(17, (await catalog.MunicipalityDetailAsync(2026, 1, "ce", "13897", Ct)).Zones.Count);
    }

    [ElectoralDatabaseFact]
    public async Task Section_results_match_the_official_bu()
    {
        var (_, results, _, db) = Services();
        await using var _ = db;
        var none = new ResultFiltersDto(null, null, null, null);

        var caucaia = await results.ExecuteAsync(2026, 1, "ce", "caucaia", 120, 419, none, Ct);
        Assert.Equal("available", caucaia.Status);
        Assert.Equal(new MetricsDto(253, 222, 31, 212, 5, 5), caucaia.Metrics);
        Assert.Equal("db72adfff90313635ee992714b34045f56a65ee2a2c7fd2462b3714ce169e62e", caucaia.Provenance!.SourceFileSha256);

        var aggregated = await results.ExecuteAsync(2026, 1, "ce", "caucaia", 120, 79, none, Ct);
        Assert.Equal(58, aggregated.PrincipalSection);
        Assert.Equal(319, aggregated.Metrics!.Eligible);
        Assert.Equal(281, aggregated.Metrics.Turnout);
    }
}
