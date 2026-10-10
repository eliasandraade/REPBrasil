using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Electoral;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Repositories;

namespace RepBrasil.Tests.Electoral;

/// <summary>
/// Só roda com REPBRASIL_ELECTORAL_TEST_DB: um banco DESCARTÁVEL (nome terminado em _test) com as
/// migrations EF aplicadas — o mesmo do CI. Cada teste semeia dados sintéticos numa transação
/// que é sempre revertida.
/// </summary>
public sealed class ElectoralSchemaFactAttribute : FactAttribute
{
    public const string Variable = "REPBRASIL_ELECTORAL_TEST_DB";

    public ElectoralSchemaFactAttribute()
    {
        var url = Environment.GetEnvironmentVariable(Variable);
        if (string.IsNullOrWhiteSpace(url))
            Skip = $"{Variable} não definida (banco *_test com migrations)";
        else if (!url.Contains("_test", StringComparison.Ordinal))
            Skip = $"{Variable} precisa apontar para um banco cujo nome termina em _test";
    }
}

public class ElectoralSchemaTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static ApplicationDbContext Db() => new(new DbContextOptionsBuilder<ApplicationDbContext>()
        .UseNpgsql(Environment.GetEnvironmentVariable(ElectoralSchemaFactAttribute.Variable))
        .Options);

    /// <summary>Cadastro sintético (UF XX, ano 2099): município A com 1 zona, município B com 3 zonas.</summary>
    private static async Task SeedAsync(ApplicationDbContext db, params (string Municipality, int Zone)[] imported)
    {
        await db.Database.ExecuteSqlRawAsync("""
            SET LOCAL search_path TO electoral, public;
            INSERT INTO state (code, name) VALUES ('XX', 'UF Fictícia');
            INSERT INTO election (id, year, round, election_date, tse_cycle)
                 VALUES ('00000000-0000-0000-0000-000000002099', 2099, 1, '2099-10-04', 'ele2099');
            INSERT INTO municipality (id, state_code, tse_code, name, slug) VALUES
                 ('00000000-0000-0000-0000-00000000000a', 'XX', '99991', 'Município A', 'municipio-a'),
                 ('00000000-0000-0000-0000-00000000000b', 'XX', '99992', 'Município B', 'municipio-b');
            INSERT INTO electoral_zone (id, state_code, zone_number) VALUES
                 ('00000000-0000-0000-0000-000000000001', 'XX', 1),
                 ('00000000-0000-0000-0000-000000000002', 'XX', 2),
                 ('00000000-0000-0000-0000-000000000003', 'XX', 3);
            INSERT INTO zone_municipality (zone_id, municipality_id, election_id) VALUES
                 ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000002099'),
                 ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000002099'),
                 ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000002099'),
                 ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000002099');
            INSERT INTO open_data_source_file (id, kind, portal, dataset, resource_name, url, year, turn, uf, downloaded_at,
                 zip_name, zip_size, zip_sha256, zip_sha512, official_checksum_algorithm, official_checksum, official_checksum_url,
                 csv_name, csv_size, csv_sha256, layout_profile, encoding, delimiter, checksum_status)
            VALUES ('00000000-0000-0000-0000-0000000000f1', 'tse-open-data-bu', 'https://dadosabertos.tse.jus.br', 'fixture',
                 'Fixture', 'https://cdn.tse.jus.br/fixture.zip', 2099, 1, 'XX', now(), 'fixture.zip', 1, repeat('a', 64),
                 repeat('b', 128), 'sha512', repeat('b', 128), 'https://cdn.tse.jus.br/fixture.sha512', 'fixture.csv', 1,
                 repeat('c', 64), 'tse-bweb-2026-v1', 'latin-1', ';', 'verified');
            """, Ct);
        foreach (var (municipality, zone) in imported)
        {
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO electoral.ingestion_run (source, scope, status, finished_at, source_file_id)
                VALUES ('tse-open-data-bu', jsonb_build_object('municipality', {0}::text, 'zone', {1}::text), 'succeeded', now(),
                        '00000000-0000-0000-0000-0000000000f1')
                """, [municipality, zone.ToString(System.Globalization.CultureInfo.InvariantCulture)], Ct);
        }
        // Um lote FALHO nunca conta como cobertura.
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO electoral.ingestion_run (source, scope, status, finished_at, source_file_id, error)
            VALUES ('tse-open-data-bu', jsonb_build_object('municipality', '99992', 'zone', '3'), 'failed', now(),
                    '00000000-0000-0000-0000-0000000000f1', 'interrompido')
            """, Ct);
    }

    private static async Task<CoverageDto> CoverageAsync(params (string, int)[] imported)
    {
        await using var db = Db();
        await using var tx = await db.Database.BeginTransactionAsync(Ct);
        await SeedAsync(db, imported);
        var scopes = await new ElectoralReadRepository(db).ResultsCoverageAsync(2099, 1, Ct);
        await tx.RollbackAsync(Ct);
        Assert.Equal(4, scopes.Count);
        return CandidacyService.Coverage("XX", scopes);
    }

    [ElectoralSchemaFact]
    public async Task Sql_coverage_is_partial_when_a_multi_zone_municipality_has_one_of_three_zones()
    {
        // Os dois municípios têm algum lote: a contagem antiga por município diria "completo".
        var c = await CoverageAsync(("99991", 1), ("99992", 1));
        Assert.False(c.Complete);
        Assert.DoesNotContain("Todas as seções", c.Note, StringComparison.Ordinal);
        var uf = Assert.Single(c.Ufs);
        Assert.Equal((2, 4, 1, 2, 2), (uf.ZonesWithResults, uf.ZonesExpected, uf.MunicipalitiesComplete, uf.MunicipalitiesWithAnyResult, uf.MunicipalitiesExpected));
    }

    [ElectoralSchemaFact]
    public async Task Sql_coverage_is_complete_only_when_every_cadaster_zone_scope_succeeded()
    {
        var c = await CoverageAsync(("99991", 1), ("99992", 1), ("99992", 2), ("99992", 3));
        Assert.True(c.Complete);
        Assert.Equal("Todas as seções da disputa estão importadas.", c.Note);
    }
}
