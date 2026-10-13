using Microsoft.EntityFrameworkCore;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Repositories;

namespace RepBrasil.Tests.Electoral;

/// <summary>
/// Parlamento sobre o banco de teste (dados sintéticos, transação sempre revertida): só a edição vigente
/// de cada dataset conta — mesmo vazia —, o recorte de UF vem do escopo oficial da edição, o histórico
/// fica preservado e valor ausente nunca vira zero nem some de uma soma sem aviso. UFs e municípios são
/// fictícios ('XX' faz o papel da UF consultada, 'YY' de outra UF).
/// </summary>
public class ParliamentRepositoryTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static ApplicationDbContext Db() => new(new DbContextOptionsBuilder<ApplicationDbContext>()
        .UseNpgsql(Environment.GetEnvironmentVariable(ElectoralSchemaFactAttribute.Variable))
        .Options);

    private static Task TerritoryAsync(ApplicationDbContext db) => db.Database.ExecuteSqlRawAsync("""
        SET LOCAL search_path TO electoral, public;
        INSERT INTO state (code, name) VALUES ('XX', 'UF Fictícia'), ('YY', 'Outra UF Fictícia');
        INSERT INTO municipality (id, state_code, tse_code, ibge_code, name, slug) VALUES
             ('00000000-0000-0000-0000-0000000000a1', 'XX', '99991', 9999901, 'Município A', 'municipio-a'),
             ('00000000-0000-0000-0000-0000000000a2', 'XX', '99992', 9999902, 'Município B', 'municipio-b'),
             ('00000000-0000-0000-0000-0000000000a3', 'XX', '99993', 9999903, 'Município C', 'municipio-c'),
             ('00000000-0000-0000-0000-0000000000b1', 'YY', '99981', 9888801, 'Município da outra UF', 'municipio-outra-uf');
        """, Ct);

    private static async Task SeedAsync(ApplicationDbContext db)
    {
        await TerritoryAsync(db);
        await db.Database.ExecuteSqlRawAsync("""
            SET LOCAL search_path TO electoral, public;
            INSERT INTO parliament_source (provider, dataset, source_url, retrieved_at, sha256, parser_version, metadata) VALUES
                 ('transparencia', 'emendas-fixture-xx', 'https://portaldatransparencia.gov.br/fixture/1', '2026-01-01T00:00:00Z', repeat('a', 63) || '1', 'parliament-v1', jsonb_build_object('uf', 'XX')),
                 ('transparencia', 'emendas-fixture-xx', 'https://portaldatransparencia.gov.br/fixture/2', '2026-02-01T00:00:00Z', repeat('a', 63) || '2', 'parliament-v1', jsonb_build_object('uf', 'XX')),
                 ('transparencia', 'emendas-fixture-xx-2', 'https://portaldatransparencia.gov.br/fixture/3', '2026-01-15T00:00:00Z', repeat('a', 63) || '3', 'parliament-v1', jsonb_build_object('uf', 'XX'));
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
    }

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
    public async Task An_empty_current_edition_is_official_absence_and_never_revives_the_previous_one()
    {
        await using var db = Db();
        await using var tx = await db.Database.BeginTransactionAsync(Ct);
        await TerritoryAsync(db);
        await db.Database.ExecuteSqlRawAsync("""
            SET LOCAL search_path TO electoral, public;
            INSERT INTO parliament_source (provider, dataset, source_url, retrieved_at, sha256, parser_version, metadata) VALUES
                 ('transparencia', 'emendas-fixture-d', 'https://portaldatransparencia.gov.br/fixture/d1', '2026-03-01T00:00:00Z', repeat('c', 63) || '1', 'parliament-v1', jsonb_build_object('uf', 'XX')),
                 ('transparencia', 'emendas-fixture-d', 'https://portaldatransparencia.gov.br/fixture/d2', '2026-04-01T00:00:00Z', repeat('c', 63) || '2', 'parliament-v1', jsonb_build_object('uf', 'XX'));
            INSERT INTO parliament_amendment (external_id, author_name, year, municipality_ibge_code, committed_amount, source_id)
            SELECT 'EM-1', 'Autor 1', 2025, '9999901', 100.00, id FROM parliament_source WHERE sha256 = repeat('c', 63) || '1';
            """, Ct);
        var repository = new ParliamentRepository(db);

        Assert.Empty(await repository.AmendmentsAsync(null, null, "XX", 50, Ct));
        Assert.Empty(await repository.AmendmentMapAsync(null, "XX", Ct));
        Assert.Empty(await repository.AmendmentYearsAsync("XX", Ct));
        Assert.Equal(1, await db.Database.SqlQueryRaw<int>(
            "SELECT count(*)::int AS \"Value\" FROM electoral.parliament_amendment WHERE external_id = 'EM-1'").SingleAsync(Ct));
    }

    [ElectoralSchemaFact]
    public async Task State_scoped_amendments_without_municipality_are_listed_but_never_mapped()
    {
        await using var db = Db();
        await using var tx = await db.Database.BeginTransactionAsync(Ct);
        await TerritoryAsync(db);
        await db.Database.ExecuteSqlRawAsync("""
            SET LOCAL search_path TO electoral, public;
            INSERT INTO parliament_source (provider, dataset, source_url, retrieved_at, sha256, parser_version, metadata) VALUES
                 ('transparencia', 'emendas-fixture-uf-xx', 'https://portaldatransparencia.gov.br/fixture/xx', '2026-05-01T00:00:00Z', repeat('d', 63) || '1', 'parliament-v1', jsonb_build_object('uf', 'XX')),
                 ('transparencia', 'emendas-fixture-uf-yy', 'https://portaldatransparencia.gov.br/fixture/yy', '2026-05-01T00:00:00Z', repeat('d', 63) || '2', 'parliament-v1', jsonb_build_object('uf', 'YY'));
            INSERT INTO parliament_amendment (external_id, author_name, year, locality, municipality_ibge_code, committed_amount, source_id)
            SELECT v.external_id, 'Autor', 2025, v.locality, v.municipality, v.committed, s.id
              FROM (VALUES
                    ('EM-MUNICIPIO', 'MUNICÍPIO A', '9999901', 10.00::numeric, repeat('d', 63) || '1'),
                    ('EM-SO-UF', 'UF FICTÍCIA (UF)', NULL, 20.00, repeat('d', 63) || '1'),
                    ('EM-OUTRA-UF', 'MUNICÍPIO DA OUTRA UF', '9888801', 30.00, repeat('d', 63) || '2')
                   ) AS v(external_id, locality, municipality, committed, sha256)
              JOIN parliament_source s ON s.sha256 = v.sha256;
            """, Ct);
        var repository = new ParliamentRepository(db);

        var listed = await repository.AmendmentsAsync(null, null, "XX", 50, Ct);
        Assert.Equal(["EM-MUNICIPIO", "EM-SO-UF"], listed.Select(a => a.ExternalId).Order().ToArray());
        Assert.Null(listed.Single(a => a.ExternalId == "EM-SO-UF").MunicipalityIbgeCode);

        var mapped = Assert.Single(await repository.AmendmentMapAsync(null, "XX", Ct));
        Assert.Equal(("9999901", 1, 10.00m), (mapped.MunicipalityIbgeCode, mapped.AmendmentCount, mapped.CommittedAmount));

        Assert.Equal(["EM-OUTRA-UF"], (await repository.AmendmentsAsync(null, null, "YY", 50, Ct)).Select(a => a.ExternalId).ToArray());
    }

    [ElectoralSchemaFact]
    public async Task Available_years_cover_the_current_edition_beyond_the_listing_limit()
    {
        await using var db = Db();
        await using var tx = await db.Database.BeginTransactionAsync(Ct);
        await TerritoryAsync(db);
        await db.Database.ExecuteSqlRawAsync("""
            SET LOCAL search_path TO electoral, public;
            INSERT INTO parliament_source (provider, dataset, source_url, retrieved_at, sha256, parser_version, metadata) VALUES
                 ('transparencia', 'emendas-fixture-anos', 'https://portaldatransparencia.gov.br/fixture/anos', '2026-06-01T00:00:00Z', repeat('e', 64), 'parliament-v1', jsonb_build_object('uf', 'XX'));
            INSERT INTO parliament_amendment (external_id, author_name, year, committed_amount, source_id)
            SELECT 'EM-2025-' || g, 'Autor', 2025, 1.00, s.id
              FROM generate_series(1, 201) AS g, parliament_source s WHERE s.sha256 = repeat('e', 64);
            INSERT INTO parliament_amendment (external_id, author_name, year, committed_amount, source_id)
            SELECT 'EM-2024', 'Autor', 2024, 1.00, id FROM parliament_source WHERE sha256 = repeat('e', 64);
            """, Ct);
        var repository = new ParliamentRepository(db);

        var listing = await repository.AmendmentsAsync(null, null, "XX", 200, Ct);
        Assert.Equal(200, listing.Count);
        Assert.All(listing, row => Assert.Equal(2025, row.Year));
        Assert.Equal([2025, 2024], await repository.AmendmentYearsAsync("XX", Ct));
    }

    [ElectoralSchemaFact]
    public async Task Activity_total_counts_the_whole_recorte_beyond_the_listing_limit()
    {
        await using var db = Db();
        await using var tx = await db.Database.BeginTransactionAsync(Ct);
        await db.Database.ExecuteSqlRawAsync("""
            SET LOCAL search_path TO electoral, public;
            INSERT INTO parliament_source (provider, dataset, source_url, retrieved_at, sha256, parser_version) VALUES
                 ('camara', 'proposicoes:fixture', 'https://dadosabertos.camara.leg.br/api/v2/proposicoes', '2026-06-01T00:00:00Z', repeat('f', 64), 'parliament-v1');
            INSERT INTO parliament_member (institution, external_id, name, state_code, source_id)
            SELECT 'camara', '990001', 'Parlamentar fictício', 'XX', id FROM parliament_source WHERE sha256 = repeat('f', 64);
            INSERT INTO parliament_activity (member_id, institution, activity_type, external_id, occurred_at, source_id)
            SELECT m.id, 'camara', 'proposition', 'P-' || g, timestamptz '2025-01-01T00:00:00Z' + g * interval '1 day', s.id
              FROM generate_series(1, 120) AS g, parliament_member m, parliament_source s
             WHERE m.external_id = '990001' AND s.sha256 = repeat('f', 64);
            """, Ct);
        var repository = new ParliamentRepository(db);

        Assert.Equal(100, (await repository.ActivitiesAsync(null, null, "XX", 100, Ct)).Count);
        Assert.Equal(120, await repository.ActivityTotalAsync(null, null, "XX", Ct));
        Assert.Equal(0, await repository.ActivityTotalAsync(null, null, "YY", Ct));
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
