using Microsoft.EntityFrameworkCore;
using RepBrasil.Infrastructure.Repositories;
using RepBrasil.Tests.Electoral;

namespace RepBrasil.Tests.DataIntelligence;

public class DataIntelligenceRepositoryTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    [ElectoralSchemaFact]
    public async Task Latest_complete_snapshot_does_not_resurrect_omitted_municipalities()
    {
        await using var db = ElectoralXraySchemaTests.Db();
        await using var tx = await db.Database.BeginTransactionAsync(Ct);
        try
        {
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO electoral.socioeconomic_source
                    (id, indicator_code, period, provider, dataset, source_url, retrieved_at, sha256, parser_version)
                VALUES
                    (910000001, 'ibge.population', 2099, 'TEST', 'fixture', 'https://example.invalid/old', now() - interval '1 day', repeat('a', 64), 'test'),
                    (910000002, 'ibge.population', 2099, 'TEST', 'fixture', 'https://example.invalid/new', now(), repeat('b', 64), 'test');

                INSERT INTO electoral.indicator_value
                    (indicator_code, municipality_ibge_code, period, value, source_id)
                VALUES
                    ('ibge.population', '9999991', 2099, 100, 910000001),
                    ('ibge.population', '9999992', 2099, 200, 910000001),
                    ('ibge.population', '9999991', 2099, 110, 910000002);
                """, Ct);

            var rows = await new DataIntelligenceRepository(db)
                .ValuesAsync("ibge.population", 2099, null, Ct);

            var row = Assert.Single(rows);
            Assert.Equal("9999991", row.MunicipalityIbgeCode);
            Assert.Equal(110m, row.Value);
            Assert.DoesNotContain(rows, item => item.MunicipalityIbgeCode == "9999992");
        }
        finally
        {
            await tx.RollbackAsync(Ct);
        }
    }
}
