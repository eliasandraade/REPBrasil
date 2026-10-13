using Microsoft.EntityFrameworkCore;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Repositories;

namespace RepBrasil.Tests.Electoral;

/// <summary>
/// Emendas parlamentares sobre o banco de teste (dados sintéticos, transação sempre revertida):
/// só a edição vigente de cada dataset conta, o histórico fica preservado e valor ausente nunca vira
/// zero nem some de uma soma sem aviso.
/// </summary>
public class ParliamentRepositoryTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static ApplicationDbContext Db() => new(new DbContextOptionsBuilder<ApplicationDbContext>()
        .UseNpgsql(Environment.GetEnvironmentVariable(ElectoralSchemaFactAttribute.Variable))
        .Options);

    private static Task SeedAsync(ApplicationDbContext db) => db.Database.ExecuteSqlRawAsync("""
        SET LOCAL search_path TO electoral, public;
        INSERT INTO state (code, name) VALUES ('XX', 'UF Fictícia');
        INSERT INTO municipality (id, state_code, tse_code, ibge_code, name, slug) VALUES
             ('00000000-0000-0000-0000-0000000000a1', 'XX', '99991', 9999901, 'Município A', 'municipio-a'),
             ('00000000-0000-0000-0000-0000000000a2', 'XX', '99992', 9999902, 'Município B', 'municipio-b'),
             ('00000000-0000-0000-0000-0000000000a3', 'XX', '99993', 9999903, 'Município C', 'municipio-c');
        INSERT INTO parliament_source (provider, dataset, source_url, retrieved_at, sha256, parser_version) VALUES
             ('transparencia', 'emendas-fixture-xx', 'https://portaldatransparencia.gov.br/fixture/1', '2026-01-01T00:00:00Z', repeat('a', 63) || '1', 'parliament-v1'),
             ('transparencia', 'emendas-fixture-xx', 'https://portaldatransparencia.gov.br/fixture/2', '2026-02-01T00:00:00Z', repeat('a', 63) || '2', 'parliament-v1'),
             ('transparencia', 'emendas-fixture-yy', 'https://portaldatransparencia.gov.br/fixture/3', '2026-01-15T00:00:00Z', repeat('a', 63) || '3', 'parliament-v1');
        INSERT INTO parliament_amendment (external_id, author_name, year, municipality_ibge_code, committed_amount, paid_amount, source_id)
        SELECT v.external_id, v.author_name, v.year, v.municipality, v.committed, v.paid, s.id
          FROM (VALUES
                ('EM-1', 'Autor 1', 2025, '9999901', 100.00::numeric, 50.00::numeric, repeat('a', 63) || '1'),
                ('EM-2', 'Autor 2', 2025, '9999901', 300.00, NULL, repeat('a', 63) || '1'),
                ('EM-1', 'Autor 1', 2025, '9999901', 120.00, 60.00, repeat('a', 63) || '2'),
                ('EM-3', 'Autor 3', 2025, '9999901', NULL, NULL, repeat('a', 63) || '2'),
                ('EM-4', 'Autor 4', 2025, '9999903', NULL, NULL, repeat('a', 63) || '2'),
                ('EM-5', 'Autor 5', 2024, '9999902', 40.00, 10.00, repeat('a', 63) || '3')
               ) AS v(external_id, author_name, year, municipality, committed, paid, sha256)
          JOIN parliament_source s ON s.sha256 = v.sha256;
        """, Ct);

    [ElectoralSchemaFact]
    public async Task Amendments_come_only_from_the_current_edition_of_each_dataset()
    {
        await using var db = Db();
        await using var tx = await db.Database.BeginTransactionAsync(Ct);
        await SeedAsync(db);

        var amendments = await new ParliamentRepository(db).AmendmentsAsync(null, null, "XX", 50, Ct);

        Assert.Equal(["EM-1", "EM-3", "EM-4", "EM-5"], amendments.Select(a => a.ExternalId).Order().ToArray());
        Assert.Equal(120.00m, amendments.Single(a => a.ExternalId == "EM-1").CommittedAmount);
        Assert.Null(amendments.Single(a => a.ExternalId == "EM-3").CommittedAmount);
        Assert.Equal("https://portaldatransparencia.gov.br/fixture/2", amendments.Single(a => a.ExternalId == "EM-1").SourceUrl);
        Assert.Equal(1, await db.Database.SqlQueryRaw<int>(
            "SELECT count(*)::int AS \"Value\" FROM electoral.parliament_amendment WHERE external_id = 'EM-2'").SingleAsync(Ct));
    }

    [ElectoralSchemaFact]
    public async Task Amendment_map_sums_only_published_values_and_counts_what_is_missing()
    {
        await using var db = Db();
        await using var tx = await db.Database.BeginTransactionAsync(Ct);
        await SeedAsync(db);

        var map = (await new ParliamentRepository(db).AmendmentMapAsync(null, "XX", Ct))
            .ToDictionary(row => row.MunicipalityIbgeCode);

        var partial = map["9999901"];
        Assert.Equal(2, partial.AmendmentCount);
        Assert.Equal(120.00m, partial.CommittedAmount);
        Assert.Equal(1, partial.CommittedAmountMissing);
        Assert.Equal(60.00m, partial.PaidAmount);
        Assert.Equal(1, partial.PaidAmountMissing);

        var complete = map["9999902"];
        Assert.Equal((1, 40.00m, 0, 10.00m, 0),
            (complete.AmendmentCount, complete.CommittedAmount, complete.CommittedAmountMissing, complete.PaidAmount, complete.PaidAmountMissing));

        var unpublished = map["9999903"];
        Assert.Null(unpublished.CommittedAmount);
        Assert.Equal(1, unpublished.CommittedAmountMissing);
        Assert.Null(unpublished.PaidAmount);
    }

    [ElectoralSchemaFact]
    public async Task Amendment_map_year_filter_applies_to_the_current_edition()
    {
        await using var db = Db();
        await using var tx = await db.Database.BeginTransactionAsync(Ct);
        await SeedAsync(db);

        var map = await new ParliamentRepository(db).AmendmentMapAsync(2024, "XX", Ct);

        var row = Assert.Single(map);
        Assert.Equal("9999902", row.MunicipalityIbgeCode);
    }
}
