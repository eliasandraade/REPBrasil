using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Electoral;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Repositories;

namespace RepBrasil.Tests.Electoral;

/// <summary>
/// SQL do Raio X contra o schema real (migrations aplicadas), com dados SINTÉTICOS numa transação
/// sempre revertida: UF XX, eleições 2098 e 2099, Deputado Estadual, candidaturas A e B.
/// Seção 100: 2098 A=10 B=20 → 2099 A=20 B=15. Seção 101: agregada 102 só em 2098. Seção 104: A sem voto
/// em 2098 (zero real). Os agregados derivados são recalculados dentro da transação.
/// </summary>
public class ElectoralXraySchemaTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly Guid PolA = Guid.Parse("00000000-0000-0000-0000-0000000000a1");
    private static readonly Guid A98 = Guid.Parse("00000000-0000-0000-0000-00000000a098");
    private static readonly Guid B98 = Guid.Parse("00000000-0000-0000-0000-00000000b098");
    private static readonly Guid A99 = Guid.Parse("00000000-0000-0000-0000-00000000a099");
    private static readonly Guid B99 = Guid.Parse("00000000-0000-0000-0000-00000000b099");

    internal static ApplicationDbContext Db() => new(new DbContextOptionsBuilder<ApplicationDbContext>()
        .UseNpgsql(Environment.GetEnvironmentVariable(ElectoralSchemaFactAttribute.Variable))
        .Options);

    // Sem chaves literais no SQL: ExecuteSqlRaw formata o texto (string.Format).
    internal const string Seed = """
        SET LOCAL search_path TO electoral, public;
        INSERT INTO state (code, name) VALUES ('XX', 'UF Fictícia');
        INSERT INTO election (id, year, round, election_date, tse_cycle) VALUES
          ('00000000-0000-0000-0000-000000002098', 2098, 1, '2098-10-04', 'ele2098'),
          ('00000000-0000-0000-0000-000000002099', 2099, 1, '2099-10-04', 'ele2099');
        INSERT INTO municipality (id, state_code, tse_code, name, slug, ibge_code)
             VALUES ('00000000-0000-0000-0000-00000000000a', 'XX', '99991', 'Município A', 'municipio-a', 9900001);
        INSERT INTO electoral_zone (id, state_code, zone_number) VALUES ('00000000-0000-0000-0000-000000000001', 'XX', 1);
        INSERT INTO zone_municipality (zone_id, municipality_id, election_id) VALUES
          ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000002098'),
          ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000002099');
        INSERT INTO open_data_source_file (id, kind, portal, dataset, resource_name, url, year, turn, uf, downloaded_at,
             zip_name, zip_size, zip_sha256, zip_sha512, official_checksum_algorithm, official_checksum, official_checksum_url,
             csv_name, csv_size, csv_sha256, layout_profile, encoding, delimiter, checksum_status)
        VALUES
          ('00000000-0000-0000-0000-0000000000f1', 'tse-open-data-bu', 'https://dadosabertos.tse.jus.br', 'fixture', 'BU 2098',
           'https://cdn.tse.jus.br/f1.zip', 2098, 1, 'XX', now(), 'f1.zip', 1, repeat('1', 64), repeat('b', 128), 'sha512',
           repeat('b', 128), 'https://cdn.tse.jus.br/f1.sha512', 'f1.csv', 1, repeat('c', 64), 'tse-bweb-2026-v1', 'latin-1', ';', 'verified'),
          ('00000000-0000-0000-0000-0000000000f2', 'tse-open-data-bu', 'https://dadosabertos.tse.jus.br', 'fixture', 'BU 2099',
           'https://cdn.tse.jus.br/f2.zip', 2099, 1, 'XX', now(), 'f2.zip', 1, repeat('2', 64), repeat('b', 128), 'sha512',
           repeat('b', 128), 'https://cdn.tse.jus.br/f2.sha512', 'f2.csv', 1, repeat('c', 64), 'tse-bweb-2026-v1', 'latin-1', ';', 'verified'),
          ('00000000-0000-0000-0000-0000000000fc', 'tse-open-data-candidates', 'https://dadosabertos.tse.jus.br', 'fixture', 'Candidatos',
           'https://cdn.tse.jus.br/fc.zip', NULL, NULL, NULL, now(), 'fc.zip', 1, repeat('3', 64), repeat('b', 128), NULL, NULL, NULL,
           NULL, NULL, NULL, NULL, NULL, NULL, 'not_published');
        INSERT INTO ingestion_run (id, source, scope, status, finished_at, source_file_id) VALUES
          ('00000000-0000-0000-0000-0000000000e1', 'tse-open-data-bu', jsonb_build_object('municipality', '99991', 'zone', '1'), 'succeeded', now(), '00000000-0000-0000-0000-0000000000f1'),
          ('00000000-0000-0000-0000-0000000000e2', 'tse-open-data-bu', jsonb_build_object('municipality', '99991', 'zone', '1'), 'succeeded', now(), '00000000-0000-0000-0000-0000000000f2'),
          ('00000000-0000-0000-0000-0000000000ec', 'tse-open-data-candidates', jsonb_build_object(), 'succeeded', now(), '00000000-0000-0000-0000-0000000000fc');
        INSERT INTO contest (id, election_id, tse_election_code, office_code, office_name, scope, electoral_unit, uf) VALUES
          ('00000000-0000-0000-0000-0000000000c8', '00000000-0000-0000-0000-000000002098', 980, 7, 'Deputado Estadual', 'state', 'XX', 'XX'),
          ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-000000002099', 990, 7, 'Deputado Estadual', 'state', 'XX', 'XX');
        INSERT INTO public."Persons" ("Id", "FullName", "CreatedAt", "UpdatedAt") VALUES
          ('00000000-0000-0000-0000-0000000000aa', 'PESSOA A', now(), now()),
          ('00000000-0000-0000-0000-0000000000bb', 'PESSOA B', now(), now());
        INSERT INTO public."Politicians" ("Id", "Name", "BallotName", "TseId", "PersonId", "CreatedAt", "UpdatedAt") VALUES
          ('00000000-0000-0000-0000-0000000000a1', 'Candidata A', 'A', '1', '00000000-0000-0000-0000-0000000000aa', now(), now()),
          ('00000000-0000-0000-0000-0000000000b1', 'Candidato B', 'B', '2', '00000000-0000-0000-0000-0000000000bb', now(), now());
        INSERT INTO candidacy (id, contest_id, tse_candidate_id, candidate_number, ballot_name, full_name, party_acronym, person_id,
             politician_id, identity_status, identity_method, source_file_id, ingestion_run_id, source_member, source_line,
             source_row_hash, round_outcome, elected)
        SELECT c.id::uuid, c.contest::uuid, c.sq, c.num, c.ballot, c.ballot, 'PF', c.person::uuid, c.pol::uuid, 'resolved',
               'cpf_hmac_sha256', '00000000-0000-0000-0000-0000000000fc', '00000000-0000-0000-0000-0000000000ec', 'fixture.csv',
               c.sq + 1, repeat(c.sq::text, 64), c.outcome, c.elected
          FROM (VALUES
            ('00000000-0000-0000-0000-00000000a098', '00000000-0000-0000-0000-0000000000c8', 1, 12345, 'CANDIDATA A', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000a1', 'SUPLENTE', false),
            ('00000000-0000-0000-0000-00000000b098', '00000000-0000-0000-0000-0000000000c8', 2, 22222, 'CANDIDATO B', '00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000b1', 'ELEITO POR QP', true),
            ('00000000-0000-0000-0000-00000000a099', '00000000-0000-0000-0000-0000000000c9', 3, 12345, 'CANDIDATA A', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000a1', 'ELEITO POR QP', true),
            ('00000000-0000-0000-0000-00000000b099', '00000000-0000-0000-0000-0000000000c9', 4, 22222, 'CANDIDATO B', '00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000b1', 'SUPLENTE', false)
          ) AS c(id, contest, sq, num, ballot, person, pol, outcome, elected);
        INSERT INTO votable (id, uf, election_code, office_code, vote_kind, type_code, type_description, number, name) VALUES
          (900001, 'XX', 980, 7, 'candidate', 1, 'Nominal', 12345, 'CANDIDATA A'),
          (900002, 'XX', 980, 7, 'candidate', 1, 'Nominal', 22222, 'CANDIDATO B'),
          (900003, 'XX', 980, 7, 'party_legend', 4, 'Legenda', 12, 'PARTIDO FICTÍCIO'),
          (900011, 'XX', 990, 7, 'candidate', 1, 'Nominal', 12345, 'CANDIDATA A'),
          (900012, 'XX', 990, 7, 'candidate', 1, 'Nominal', 22222, 'CANDIDATO B'),
          (900013, 'XX', 990, 7, 'party_legend', 4, 'Legenda', 12, 'PARTIDO FICTÍCIO');
        INSERT INTO section_office_result (id, ingestion_run_id, year, turn, election_code, uf, municipality_tse_code, municipality_name,
             zone, section, office_code, office_name, aggregated_sections, polling_place_code, eligible, turnout, abstentions, votes_total)
        SELECT r.id, r.run::uuid, r.year, 1, r.code, 'XX', '99991', 'MUNICÍPIO A', 1, r.section, 7, 'Deputado Estadual', r.agg, 1001,
               200, 150, 50, 0
          FROM (VALUES
            (800100, '00000000-0000-0000-0000-0000000000e1', 2098, 980, 100, ARRAY[]::integer[]),
            (800101, '00000000-0000-0000-0000-0000000000e1', 2098, 980, 101, ARRAY[102]),
            (800104, '00000000-0000-0000-0000-0000000000e1', 2098, 980, 104, ARRAY[]::integer[]),
            (810100, '00000000-0000-0000-0000-0000000000e2', 2099, 990, 100, ARRAY[]::integer[]),
            (810101, '00000000-0000-0000-0000-0000000000e2', 2099, 990, 101, ARRAY[]::integer[]),
            (810104, '00000000-0000-0000-0000-0000000000e2', 2099, 990, 104, ARRAY[]::integer[])
          ) AS r(id, run, year, code, section, agg);
        INSERT INTO section_office_vote (result_id, votable_id, votes, source_row_hash, source_line)
        SELECT v.result, v.votable, v.votes, md5(v.result::text || '-' || v.votable::text) || md5(v.votable::text), v.result
          FROM (VALUES
            (800100, 900001, 10), (800100, 900002, 20), (800100, 900003, 5),
            (800101, 900001, 5), (800101, 900002, 5), (800101, 900003, 5),
            (800104, 900002, 4), (800104, 900003, 5),
            (810100, 900011, 20), (810100, 900012, 15), (810100, 900013, 5),
            (810101, 900011, 7), (810101, 900012, 1), (810101, 900013, 5),
            (810104, 900011, 6), (810104, 900012, 2), (810104, 900013, 5)
          ) AS v(result, votable, votes);
        INSERT INTO votable_candidacy (votable_id, uf, candidacy_id, method, ingestion_run_id) VALUES
          (900001, 'XX', '00000000-0000-0000-0000-00000000a098', 'contest_number', '00000000-0000-0000-0000-0000000000ec'),
          (900002, 'XX', '00000000-0000-0000-0000-00000000b098', 'contest_number', '00000000-0000-0000-0000-0000000000ec'),
          (900011, 'XX', '00000000-0000-0000-0000-00000000a099', 'contest_number', '00000000-0000-0000-0000-0000000000ec'),
          (900012, 'XX', '00000000-0000-0000-0000-00000000b099', 'contest_number', '00000000-0000-0000-0000-0000000000ec');
        INSERT INTO candidacy_asset (candidacy_id, asset_type_code, asset_type, description, value, source_file_id, ingestion_run_id,
             source_member, source_line, source_row_hash) VALUES
          ('00000000-0000-0000-0000-00000000a098', 11, 'Casa', 'CASA', 100000, '00000000-0000-0000-0000-0000000000fc', '00000000-0000-0000-0000-0000000000ec', 'b.csv', 2, repeat('d', 64)),
          ('00000000-0000-0000-0000-00000000a099', 11, 'Casa', 'Casa', 150000, '00000000-0000-0000-0000-0000000000fc', '00000000-0000-0000-0000-0000000000ec', 'b.csv', 3, repeat('e', 64));
        REFRESH MATERIALIZED VIEW votable_zone_votes_current;
        REFRESH MATERIALIZED VIEW zone_office_totals_current;
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

    [ElectoralSchemaFact]
    public async Task Repository_reads_zone_aggregates_ranks_and_sections()
    {
        await WithSeedAsync(async db =>
        {
            var repo = new ElectoralXrayRepository(db);
            var rows = await repo.CandidaciesAsync([A98, B98, A99, B99], Ct);
            Assert.Equal(4, rows.Count);
            Assert.All(rows, r => Assert.True(r.HasLink));
            Assert.Equal("UF Fictícia", rows.First(r => r.Id == A98).UnitName);

            var votes = (await repo.ZoneVotesAsync([A98, B98, A99, B99], "XX", null, Ct)).ToDictionary(v => v.CandidacyId, v => v.Votes);
            Assert.Equal((15L, 29L, 33L, 18L), (votes[A98], votes[B98], votes[A99], votes[B99]));

            var totals = await repo.ZoneTotalsAsync([new ElectionOffice(2098, 1, 7)], "XX", null, Ct);
            var zone = Assert.Single(totals);
            Assert.Equal((3, 59L), (zone.Urns, zone.ValidVotes));
            Assert.Single(await repo.ExpectedZonesAsync([(2098, 1)], "XX", null, Ct));

            var ranks = (await repo.RanksAsync([A98, A99], Ct)).ToDictionary(r => r.CandidacyId);
            Assert.Equal((2, 2), (ranks[A98].Rank!.Value, ranks[A98].CandidatesWithVotes));
            Assert.Equal(1, ranks[A99].Rank);

            var sections = await repo.SectionResultsAsync([new ElectionOffice(2098, 1, 7)], "XX", "99991", null, Ct);
            Assert.Equal([101, 102], sections.Single(s => s.Section == 101).SectionMembers);
            Assert.Equal(9L, sections.Single(s => s.Section == 104).ValidVotes); // B 4 + legenda 5
            Assert.DoesNotContain(await repo.SectionVotesAsync([A98], "XX", "99991", null, Ct), v => v.ResultId == 800104);
            Assert.Equal(2, (await repo.ElectionCandidaciesAsync(2099, 1, "XX", null, Ct)).Count);
            Assert.True(XrayService.Freshness(await repo.FreshnessAsync(Ct)).Stale); // lotes novos sem refresh registrado
            return 0;
        });
    }

    [ElectoralSchemaFact]
    public async Task Contest_stats_rank_every_voted_candidate_number_per_territory()
    {
        await WithSeedAsync(async db =>
        {
            var repo = new ElectoralXrayRepository(db);
            ContestStatsQuery Q(Guid c, int year, int code, string level) =>
                new(c, year, 1, code, 7, "XX", level is "section" or "place" ? "99991" : null, null, level);

            // município: A 15 × B 29 (legenda fora da disputa entre números de candidatura)
            var mun = Assert.Single(await repo.ContestStatsAsync(Q(A98, 2098, 980, "municipality"), Ct));
            Assert.Equal(("99991", 0, 29L, 29L, 2, 1, 15L), (mun.MunicipalityTseCode, mun.Zone, mun.LeaderVotes, mun.BestOtherVotes!.Value, mun.Contestants, mun.Ahead, mun.TargetVotes));
            var zone = Assert.Single(await repo.ContestStatsAsync(Q(A98, 2098, 980, "zone"), Ct));
            Assert.Equal((1, 1), (zone.Zone, zone.Ahead));

            // urna: 100 (A 10 × B 20), 101 (empate 5 × 5 — ninguém à frente), 104 (só B votado; A sem voto = 0 afirmado)
            var sections = (await repo.ContestStatsAsync(Q(A98, 2098, 980, "section"), Ct)).ToDictionary(r => r.Section);
            Assert.Equal((1, 10L, 20L), (sections[100].Ahead, sections[100].TargetVotes, sections[100].LeaderVotes));
            Assert.Equal((0, 5L, 5L), (sections[101].Ahead, sections[101].TargetVotes, sections[101].BestOtherVotes!.Value));
            Assert.Equal((1, 0L, 1), (sections[104].Ahead, sections[104].TargetVotes, sections[104].Contestants));

            // local de votação 1001 = todas as urnas
            var place = Assert.Single(await repo.ContestStatsAsync(Q(A98, 2098, 980, "place"), Ct));
            Assert.Equal(("1001", 15L, 29L), (place.PlaceCode, place.TargetVotes, place.LeaderVotes));

            var lead = (await repo.ContestStatsAsync(Q(A99, 2099, 990, "section"), Ct)).ToDictionary(r => r.Section);
            Assert.Equal((0, 7L, 1L), (lead[101].Ahead, lead[101].TargetVotes, lead[101].BestOtherVotes!.Value));
            return 0;
        });
    }

    [ElectoralSchemaFact]
    public async Task Comparison_and_xray_run_on_the_real_sql()
    {
        await WithSeedAsync(async db =>
        {
            var repo = new ElectoralXrayRepository(db);
            var r = await new ComparisonService(repo).CompareAsync(new ComparisonService.Request([A98, B98, A99, B99], "XX", "section", "99991", null), Ct);
            var s100 = r.Territories.Single(t => t.Section == 100);
            Assert.Equal(TerritoryComparability.Comparable, s100.Comparability);
            var a = r.Candidacies.Single(c => c.CandidacyId == A98).Subject;
            Assert.Equal((10L, 100.0), (s100.Evolution.Single(e => e.Subject == a).DeltaVotes!.Value, s100.Evolution.Single(e => e.Subject == a).DeltaPercent!.Value));
            Assert.Equal(-5L, s100.Evolution.Single(e => e.Subject != a).DeltaVotes);
            Assert.Equal(TerritoryComparability.SectionCompositionChanged, r.Territories.Single(t => t.Section == 101).Comparability);
            Assert.Equal(CellState.Zero, r.Territories.Single(t => t.Section == 104).Cells.Single(c => c.CandidacyId == A98).State);
            Assert.Equal(2, Assert.Single(r.Overtakes).Territories); // seções 100 e 104

            var x = await new XrayService(repo).BuildAsync(PolA, Ct);
            Assert.Equal(2, x.Candidacies.Count);
            var step = Assert.Single(x.Evolution);
            Assert.Equal((18L, 120.0), (step.DeltaVotes!.Value, step.DeltaPercent!.Value));
            Assert.Equal(50000m, Assert.Single(x.AssetsEvolution).Delta);

            var list = await new TerritoryService(repo).CandidatesAsync(
                new CandidatesQuery(2099, 1, "XX", "99991", null, null, null, null, null, null, null, "votes", "desc", 1, 10), Ct);
            Assert.Equal([A99, B99], list.Items.Select(i => i.CandidacyId));
            Assert.Equal(1, list.Items[0].Rank);
            return 0;
        });
    }
}
