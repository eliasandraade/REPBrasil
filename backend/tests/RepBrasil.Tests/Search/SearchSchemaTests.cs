using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using RepBrasil.Application.Search;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Repositories;
using RepBrasil.Tests.Electoral;

namespace RepBrasil.Tests.Search;

/// <summary>
/// SQL da busca contra o schema real (migration 012: <c>public.search_fold</c> + índice de trigramas), com dados
/// SINTÉTICOS numa transação sempre revertida: UF XX, eleição 2099, duas candidaturas a Deputado Estadual.
/// </summary>
public class SearchSchemaTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly Guid Zefa = Guid.Parse("00000000-0000-0000-0000-0000000005a1");
    private static readonly Guid Sept = Guid.Parse("00000000-0000-0000-0000-0000000005b1");

    private static ApplicationDbContext Db() => new(new DbContextOptionsBuilder<ApplicationDbContext>()
        .UseNpgsql(Environment.GetEnvironmentVariable(ElectoralSchemaFactAttribute.Variable))
        .Options);

    // Sem chaves literais no SQL: ExecuteSqlRaw formata o texto (string.Format).
    private const string Seed = """
        SET LOCAL search_path TO electoral, public;
        INSERT INTO state (code, name) VALUES ('XX', 'UF Fictícia');
        INSERT INTO election (id, year, round, election_date, tse_cycle)
             VALUES ('00000000-0000-0000-0000-000000002099', 2099, 1, '2099-10-04', 'ele2099');
        INSERT INTO municipality (id, state_code, tse_code, name, slug)
             VALUES ('00000000-0000-0000-0000-00000000000a', 'XX', '99991', 'São Município Fictício', 'sao-municipio-ficticio');
        INSERT INTO open_data_source_file (id, kind, portal, dataset, resource_name, url, year, turn, uf, downloaded_at,
             zip_name, zip_size, zip_sha256, zip_sha512, official_checksum_algorithm, official_checksum, official_checksum_url,
             csv_name, csv_size, csv_sha256, layout_profile, encoding, delimiter, checksum_status)
        VALUES ('00000000-0000-0000-0000-0000000005fc', 'tse-open-data-candidates', 'https://dadosabertos.tse.jus.br', 'fixture',
             'Candidatos', 'https://cdn.tse.jus.br/fc.zip', NULL, NULL, NULL, now(), 'fc.zip', 1, repeat('3', 64), repeat('b', 128),
             NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'not_published');
        INSERT INTO ingestion_run (id, source, scope, status, finished_at, source_file_id) VALUES
          ('00000000-0000-0000-0000-0000000005ec', 'tse-open-data-candidates', jsonb_build_object(), 'succeeded', now(),
           '00000000-0000-0000-0000-0000000005fc');
        INSERT INTO contest (id, election_id, tse_election_code, office_code, office_name, scope, electoral_unit, uf) VALUES
          ('00000000-0000-0000-0000-0000000005c9', '00000000-0000-0000-0000-000000002099', 990, 7, 'DEPUTADO ESTADUAL', 'state', 'XX', 'XX');
        INSERT INTO public."Persons" ("Id", "FullName", "CreatedAt", "UpdatedAt") VALUES
          ('00000000-0000-0000-0000-0000000005aa', 'PESSOA A', now(), now()),
          ('00000000-0000-0000-0000-0000000005bb', 'PESSOA B', now(), now());
        INSERT INTO public."Politicians" ("Id", "Name", "BallotName", "TseId", "PersonId", "PartyAcronym", "CreatedAt", "UpdatedAt") VALUES
          ('00000000-0000-0000-0000-0000000005a1', 'Josefa D''Ávila Gonçalves', 'Zéfa do PT', '1', '00000000-0000-0000-0000-0000000005aa', 'PT', now(), now()),
          ('00000000-0000-0000-0000-0000000005b1', 'Joaquim Setembrino', 'Dix-Sept', '2', '00000000-0000-0000-0000-0000000005bb', 'PC do B', now(), now());
        INSERT INTO candidacy (id, contest_id, tse_candidate_id, candidate_number, ballot_name, full_name, party_acronym, party_name,
             party_number, person_id, politician_id, identity_status, identity_method, source_file_id, ingestion_run_id,
             source_member, source_line, source_row_hash, round_outcome, elected)
        SELECT c.id::uuid, '00000000-0000-0000-0000-0000000005c9', c.sq, c.num, c.ballot, c.ballot, c.party, c.party_name, c.party_number,
               c.person::uuid, c.pol::uuid, 'resolved', 'cpf_hmac_sha256', '00000000-0000-0000-0000-0000000005fc',
               '00000000-0000-0000-0000-0000000005ec', 'fixture.csv', c.sq + 1, repeat(c.sq::text, 64), c.outcome, c.elected
          FROM (VALUES
            ('00000000-0000-0000-0000-00000005a099', 1, 13123, 'ZÉFA DO PT', 'PT', 'PARTIDO DOS TRABALHADORES', 13,
             '00000000-0000-0000-0000-0000000005aa', '00000000-0000-0000-0000-0000000005a1', 'ELEITO POR QP', true),
            ('00000000-0000-0000-0000-00000005b099', 2, 65123, 'DIX-SEPT', 'PC do B', 'PARTIDO COMUNISTA DO BRASIL', 65,
             '00000000-0000-0000-0000-0000000005bb', '00000000-0000-0000-0000-0000000005b1', 'SUPLENTE', false)
          ) AS c(id, sq, num, ballot, party, party_name, party_number, person, pol, outcome, elected);
        """;

    private static async Task<T> WithSeedAsync<T>(Func<ApplicationDbContext, Task<T>> body)
    {
        await using var db = Db();
        await using var tx = await db.Database.BeginTransactionAsync(Ct);
        await db.Database.ExecuteSqlRawAsync(Seed, Ct);
        try
        {
            return await body(db);
        }
        finally
        {
            await tx.RollbackAsync(Ct);
        }
    }

    private static SearchRepository Repo(ApplicationDbContext db) => new(db, new MemoryCache(new MemoryCacheOptions()));

    [ElectoralSchemaFact]
    public async Task Sql_fold_matches_the_csharp_fold()
    {
        await using var db = Db();
        foreach (var value in new[] { "JUAZEIRO DO NORTE", "São Gonçalo d'Água", "  Ésio do PT ", "Não-Me-Toque", "50% _x_", "ÂÊÎÔÛ ÃÕ Ç Ñ" })
        {
            var sql = await db.Database.SqlQueryRaw<string>("SELECT public.search_fold({0}) AS \"Value\"", value).SingleAsync(Ct);
            Assert.Equal(SearchService.Fold(value), sql);
        }
    }

    [ElectoralSchemaFact]
    public async Task Politicians_are_found_without_accents_by_word_start_with_their_latest_candidacy()
    {
        var rows = await WithSeedAsync(db => Repo(db).PoliticiansAsync(["josefa", "avila"], "josefa avila", new SearchFilter(null, null, null), 6, Ct));
        var zefa = Assert.Single(rows);
        Assert.Equal((Zefa, 3), (zefa.Id, zefa.Rank));
        Assert.Equal(((short?)2099, (short?)1, (int?)7, "UF Fictícia", "XX", "PT", (bool?)true),
            (zefa.Year, zefa.Round, zefa.OfficeCode, zefa.UnitName, zefa.Uf, zefa.PartyAcronym, zefa.Elected));
    }

    [ElectoralSchemaFact]
    public async Task A_short_term_must_start_a_word_and_an_exact_ballot_name_ranks_first()
    {
        var pt = await WithSeedAsync(db => Repo(db).PoliticiansAsync(["pt"], "pt", new SearchFilter(null, null, null), 6, Ct));
        Assert.Equal([Zefa], pt.Select(p => p.Id)); // "pt" não casa com "Dix-Sept"
        Assert.Equal(2, pt[0].Rank);

        var exact = await WithSeedAsync(db => Repo(db).PoliticiansAsync(["zefa", "pt"], "zefa do pt", new SearchFilter(null, null, null), 6, Ct));
        Assert.Equal(0, Assert.Single(exact).Rank);
    }

    [ElectoralSchemaFact]
    public async Task A_common_name_keeps_the_elected_person_even_beyond_200_alphabetical_matches()
    {
        // 205 homônimos não eleitos, todos antes em ordem alfabética; a eleita vem por último no alfabeto.
        // Regressão: o corte de 200 era só alfabético e a eleita sumia antes do desempate por "eleito".
        var rows = await WithSeedAsync(async db =>
        {
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO public."Politicians" ("Id", "Name", "BallotName", "CreatedAt", "UpdatedAt")
                SELECT gen_random_uuid(), 'Aaa Silva ' || lpad(i::text, 3, '0'), 'Aaa Silva ' || lpad(i::text, 3, '0'), now(), now()
                  FROM generate_series(1, 205) i;
                UPDATE public."Politicians" SET "BallotName" = 'Zélia Silva', "Name" = 'Zélia Silva'
                 WHERE "Id" = '00000000-0000-0000-0000-0000000005a1';
                """, Ct);
            return await Repo(db).PoliticiansAsync(["silva"], "silva", new SearchFilter(null, null, null), 5, Ct);
        });
        Assert.Equal(Zefa, rows[0].Id);
        Assert.Equal(5, rows.Count);
    }

    [ElectoralSchemaFact]
    public async Task An_election_filter_keeps_only_who_ran_in_it()
    {
        var none = await WithSeedAsync(db => Repo(db).PoliticiansAsync(["zefa"], "zefa", new SearchFilter(2098, null, null), 6, Ct));
        Assert.Empty(none);
        var office = await WithSeedAsync(db => Repo(db).PoliticiansAsync(["zefa"], "zefa", new SearchFilter(2099, 1, 7), 6, Ct));
        Assert.Equal(Zefa, Assert.Single(office).Id);
        var otherOffice = await WithSeedAsync(db => Repo(db).PoliticiansAsync(["zefa"], "zefa", new SearchFilter(2099, null, 6), 6, Ct));
        Assert.Empty(otherOffice);
    }

    [ElectoralSchemaFact]
    public async Task Profile_carries_the_latest_official_candidacy_by_id_and_by_slug()
    {
        var (byId, bySlug, legacy) = await WithSeedAsync(async db =>
        {
            var query = new RepBrasil.Application.Politicians.Queries.GetPoliticianByIdQuery(new PoliticianRepository(db));
            var zefa = await query.ExecuteAsync(Zefa, Ct);
            return (zefa, await query.BySlugAsync(zefa!.Slug!, Ct), (await query.ExecuteAsync(Sept, Ct))!.LatestCandidacy);
        });
        Assert.Equal(new RepBrasil.Application.Politicians.DTOs.LatestCandidacyDto(2099, 1, 7, "Deputado Estadual", "UF Fictícia", "XX", "PT", "ELEITO POR QP", true),
            byId!.LatestCandidacy);
        Assert.Equal(byId, bySlug);
        Assert.Equal("PC do B", legacy!.Party);
    }

    [ElectoralSchemaFact]
    public async Task Catalog_lists_places_and_parties_and_merges_acronym_spellings()
    {
        var catalog = await WithSeedAsync(db => Repo(db).CatalogAsync(Ct));
        var place = Assert.Single(catalog.Territories, t => t.Row.Uf == "XX" && !t.IsState);
        Assert.Equal(("São Município Fictício", "sao municipio ficticio", "uf ficticia"), (place.Row.Name, place.Folded, place.FoldedState));
        Assert.Empty(place.Elections); // sem Boletim de Urna importado: nenhum pleito
        Assert.Contains(catalog.Parties, p => p.Row.Acronym == "PT" && p.Row.Candidacies >= 1);
    }

    [ElectoralSchemaFact]
    public async Task Politician_list_search_ignores_accents_and_party_spelling()
    {
        foreach (var q in new[] { "josé ávila", "JOSEFA GONÇALVES", "zefa" }) // sem acento, palavras fora de ordem/não vizinhas
        {
            var found = await WithSeedAsync(db => new PoliticianRepository(db).SearchAsync(q, null, null, null, 1, 20, Ct));
            Assert.Equal([Zefa], found.Items.Select(p => p.Id));
        }
        var midWord = await WithSeedAsync(db => new PoliticianRepository(db).SearchAsync("sefa", null, null, null, 1, 20, Ct));
        Assert.Empty(midWord.Items); // o termo começa uma palavra; não casa no meio

        var pcdob = await WithSeedAsync(db => new PoliticianRepository(db).SearchAsync(null, null, "pcdob", null, 1, 20, Ct));
        Assert.Contains(pcdob.Items, p => p.Id == Sept);
        var wildcard = await WithSeedAsync(db => new PoliticianRepository(db).SearchAsync(null, null, "%", null, 1, 20, Ct));
        Assert.Empty(wildcard.Items); // filtro de partido não aceita curinga
    }
}
