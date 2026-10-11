using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Electoral;
using RepBrasil.Application.Parties;
using RepBrasil.Application.Rankings;
using RepBrasil.Infrastructure.Repositories;
using RepBrasil.Tests.Electoral;

namespace RepBrasil.Tests.Parties;

/// <summary>Partidos: identidade pela sigla, ausência ≠ zero, variação só comparável, camada do mapa, SQL real. Dados fictícios.</summary>
public class PartyTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private sealed class FakeParties : IPartyRepository
    {
        public List<PartyOfficeRow> Offices { get; } = [];
        public List<PartyTerritoryRow> Territories { get; } = [];
        public List<PartyCandidateRow> Candidates { get; } = [];

        public Task<IReadOnlyList<PartyOfficeRow>> OfficeStatsAsync(string uf, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<PartyOfficeRow>>(Offices);

        public Task<IReadOnlyList<PartyTerritoryRow>> TerritoriesAsync(
            string uf, int year, int round, int office, IReadOnlyList<int> partyNumbers, string? municipalityTseCode, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<PartyTerritoryRow>>(Territories);

        public Task<IReadOnlyList<PartyCandidateRow>> CandidatesAsync(
            string uf, int year, int round, int office, IReadOnlyList<int> partyNumbers, string? municipalityTseCode, int limit,
            CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<PartyCandidateRow>>(Candidates.Take(limit).ToList());
    }

    private sealed class FakeCoverage : IRankingRepository
    {
        public List<RankingCoverageRow> Coverage { get; } = [];

        public Task<IReadOnlyList<RankingCandidacyRow>> CandidaciesAsync(RankingFilter filter, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<RankingCandidacyRow>>([]);

        public Task<IReadOnlyList<RankingCoverageRow>> CoverageAsync(int office, string uf, string? municipalityTseCode, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<RankingCoverageRow>>(Coverage);

        public Task<IReadOnlyList<RankingPartyRow>> PartiesAsync(RankingFilter filter, bool includeLegend, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<RankingPartyRow>>([]);

        public Task<IReadOnlyList<RankingRecurrenceRow>> RecurrenceAsync(string uf, int? office, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<RankingRecurrenceRow>>([]);
    }

    private static PartyOfficeRow Office(int year, int number, string acronym, long? nominal, long? legend, long? valid,
        int office = 7, int candidacies = 10, int elected = 1) => new()
        {
            Year = (short)year,
            Round = 1,
            OfficeCode = office,
            OfficeName = office == 7 ? "Deputado Estadual" : office == 13 ? "Vereador" : "Prefeito",
            PartyNumber = number,
            PartyAcronym = acronym,
            PartyName = $"PARTIDO {acronym}",
            Candidacies = candidacies,
            Elected = elected,
            NominalVotes = nominal,
            LegendVotes = legend,
            ValidVotes = valid,
            MunicipalitiesWithVotes = nominal is > 0 ? 3 : 0,
            MunicipalitiesCovered = valid is null ? 0 : 3,
        };

    private static PartyTerritoryRow Territory(string code, long nominal, int? candidacies, bool onBallot = true, int zones = 1, int covered = 1) => new()
    {
        MunicipalityTseCode = code,
        MunicipalityName = code,
        IbgeCode = int.Parse(code),
        ValidVotes = 1_000,
        NominalVotes = nominal,
        LegendVotes = 0,
        Candidacies = candidacies,
        Elected = nominal > 0 ? 1 : 0,
        OnBallot = onBallot,
        ZonesExpected = zones,
        ZonesCovered = covered,
    };

    private static (PartyService Service, FakeParties Repo, FakeCoverage Coverage) Service(bool complete = true)
    {
        var repo = new FakeParties();
        var coverage = new FakeCoverage();
        foreach (var year in new short[] { 2018, 2022 })
            coverage.Coverage.Add(new RankingCoverageRow
            {
                Year = year,
                Round = 1,
                MunicipalityTseCode = "13897",
                ZonesExpected = 2,
                ZonesCovered = complete || year == 2022 ? 2 : 1,
            });
        return (new PartyService(repo, coverage, new FakeXrayRepository()), repo, coverage);
    }

    [Theory]
    [InlineData("PC do B", "pcdob")]
    [InlineData("PCdoB", "pcdob")]
    [InlineData("UNIÃO", "uniao")]
    [InlineData("Solidariedade", "solidariedade")]
    public void Slug_is_the_official_acronym_without_accents_spaces_or_case(string acronym, string slug) =>
        Assert.Equal(slug, PartyService.Slug(acronym));

    [Fact]
    public async Task List_groups_spellings_of_the_same_acronym_and_never_turns_missing_bu_into_zero()
    {
        var (service, repo, _) = Service();
        repo.Offices.AddRange([
            Office(2022, 65, "PC do B", 900, 100, 10_000),
            Office(2018, 65, "PCdoB", 700, 100, 9_000),
            Office(2022, 13, "PT", 3_000, 500, 10_000),
            Office(2022, 99, "PN", null, null, null, office: 13), // vereador sem BU importado: votos ausentes, não zero
        ]);

        var list = await service.ListAsync("ce", Ct);

        Assert.Equal("CE", list.Uf);
        Assert.Equal(["pt", "pcdob", "pn"], list.Parties.Select(p => p.Slug));
        var pcdob = list.Parties[1];
        Assert.Equal([2022, 2018], pcdob.Results.Select(r => r.Year));
        Assert.Equal(1_000, pcdob.Results[0].Votes); // nominais + legenda (proporcional)
        Assert.Equal(10.0, pcdob.Results[0].Share);
        var pn = Assert.Single(list.Parties[2].Results);
        Assert.Null(pn.Votes);
        Assert.Null(pn.Share);
        Assert.False(list.Elections.Single(e => e.Year == 2022).Offices.Single(o => o.Code == 13).Covered);
    }

    [Fact]
    public async Task Change_compares_the_same_office_and_round_only_with_complete_coverage_in_both()
    {
        var (service, repo, _) = Service();
        repo.Offices.AddRange([Office(2022, 65, "PCdoB", 900, 100, 10_000), Office(2018, 66, "PCdoB", 700, 100, 8_000)]);

        var profile = await service.ProfileAsync("pcdob", "CE", null, null, null, Ct);
        var change = profile.Results[0].Change!;
        Assert.Equal(("comparable", 200L, 25.0, 0.0), (change.Comparability, change.DeltaVotes!.Value, change.DeltaPercent!.Value, change.DeltaSharePoints!.Value));
        Assert.Contains("número 66 em 2018 e 65 em 2022", change.Note);
        Assert.Contains(profile.Notes, n => n.Contains("mais de um número"));

        var (partial, partialRepo, _) = Service(complete: false);
        partialRepo.Offices.AddRange(repo.Offices);
        var incomplete = (await partial.ProfileAsync("pcdob", "CE", null, null, null, Ct)).Results[0].Change!;
        Assert.Equal("coverage_incomplete", incomplete.Comparability);
        Assert.Null(incomplete.DeltaVotes);
        Assert.Equal(800, incomplete.FromVotes); // o valor anterior é mostrado; a variação, não
    }

    [Fact]
    public async Task Party_off_the_ballot_has_absent_votes_and_no_change_never_zero()
    {
        var (service, repo, _) = Service();
        // 2018: BU completo, mas a única candidatura da sigla não foi inserida na urna (votos ausentes, não zero)
        repo.Offices.AddRange([Office(2022, 65, "PCdoB", 900, 100, 10_000), Office(2018, 65, "PCdoB", null, null, 8_000, elected: 0)]);

        var results = (await service.ProfileAsync("pcdob", "CE", null, null, null, Ct)).Results;

        Assert.Equal(((long?)null, (double?)null), (results[1].Votes, results[1].Share));
        var change = results[0].Change!;
        Assert.Equal(("absent", (long?)null), (change.Comparability, change.DeltaVotes));
        Assert.Contains("não estava na urna neste cargo em 2018", change.Note);
    }

    [Fact]
    public async Task Profile_detail_lists_strongest_and_weakest_municipalities_only_where_the_party_was_on_the_ballot()
    {
        var (service, repo, _) = Service();
        repo.Offices.Add(Office(2022, 65, "PCdoB", 300, 50, 3_000, office: 13));
        repo.Territories.AddRange([
            Territory("00001", 250, 5),
            Territory("00002", 0, 2),
            Territory("00003", 0, 0, onBallot: false),
            Territory("00004", 0, 1, onBallot: false), // candidatura com "NÃO" em inserida na urna (complementar do TSE)
            Territory("00005", 90, 3, zones: 2, covered: 1), // BU de só uma das duas zonas
        ]);

        var detail = (await service.ProfileAsync("pcdob", "CE", 2022, 1, 13, Ct)).Detail!;

        Assert.Equal(2, detail.TerritoriesConsidered); // fora da urna e cobertura parcial nunca entram (nem como zero)
        Assert.Equal(1, detail.TerritoriesWithVotes);
        Assert.Equal(["00001", "00002"], detail.Strongest.Select(t => t.Name));
        Assert.Equal(25.0, detail.Strongest[0].Share);
        Assert.Empty(detail.Weakest); // os dois já estão entre os mais fortes
        Assert.Contains("1 município(s) com Boletim de Urna de só parte das zonas", detail.Note);
    }

    [Fact]
    public async Task Unknown_party_is_404_and_an_election_without_it_is_400()
    {
        var (service, repo, _) = Service();
        repo.Offices.Add(Office(2022, 13, "PT", 3_000, 500, 10_000));
        await Assert.ThrowsAsync<ElectoralNotFoundException>(() => service.ProfileAsync("xyz", "CE", null, null, null, Ct));
        await Assert.ThrowsAsync<ElectoralBadRequestException>(() => service.ProfileAsync("pt", "CE", 2024, 1, 13, Ct));
        await Assert.ThrowsAsync<ElectoralBadRequestException>(() => service.ListAsync("Ceará", Ct));
    }

    [Fact]
    public async Task Map_marks_municipalities_without_the_party_on_the_ballot_or_with_partial_bu_and_keeps_real_zeros()
    {
        var (service, repo, _) = Service();
        repo.Territories.AddRange([
            Territory("00001", 100, 1),
            Territory("00002", 0, 1),
            Territory("00003", 0, 0, onBallot: false),
            Territory("00004", 0, 1, onBallot: false), // registrada, mas não inserida na urna
            Territory("00005", 40, 1, zones: 2, covered: 1),
        ]);

        var map = await service.MapAsync(new MapQuery(2024, 1, "CE", "party", 11, null, null, null, null, null), 65, Ct);

        Assert.Equal("party", map.Layer);
        Assert.Equal<(double?, string)>(
            [(10.0, "value"), (0.0, "zero"), (null, "not_on_ballot"), (null, "not_on_ballot"), (null, "partial_coverage")],
            map.Features.Select(f => (f.Value, f.State)));
        Assert.Null(map.Features[2].Details["votes"]);
        Assert.Null(map.Features[4].Details["votes"]); // votos de parte das zonas não aparecem como total
        Assert.Equal((1, 2), ((int)map.Features[4].Details["zonesCovered"]!, (int)map.Features[4].Details["zonesExpected"]!));
        // dentro de um município o mapa continua por município (não há polígono de zona)
        var inside = await service.MapAsync(new MapQuery(2024, 1, "CE", "party", 11, null, null, null, null, "00001"), 65, Ct);
        Assert.Equal(("municipality", 5), (inside.Level, inside.Features.Count));
        await Assert.ThrowsAsync<ElectoralBadRequestException>(() =>
            service.MapAsync(new MapQuery(2024, 1, "CE", "party", 12, null, null, null, null, null), 65, Ct)); // vice
        await Assert.ThrowsAsync<ElectoralBadRequestException>(() =>
            service.MapAsync(new MapQuery(2024, 1, "CE", "party", 11, null, null, null, null, null), null, Ct));
    }

    [Fact]
    public async Task Map_rejects_a_party_number_that_was_not_on_the_ballot_for_the_office()
    {
        var (service, repo, _) = Service();
        // cargo estadual com número que não teve candidatura nem voto: nunca vira zero em todo município
        repo.Territories.AddRange([Territory("00001", 0, null, onBallot: false), Territory("00002", 0, null, onBallot: false)]);

        var error = await Assert.ThrowsAsync<ElectoralBadRequestException>(() =>
            service.MapAsync(new MapQuery(2022, 1, "CE", "party", 7, null, null, null, null, null), 99, Ct));
        Assert.Contains("99", error.Message);
    }

    // ── SQL (schema real, dados fictícios revertidos) ───────────────────────

    private const string PartySeed = """
        SET LOCAL search_path TO electoral, public;
        UPDATE votable SET party_number = 12, party_acronym = 'PF', party_name = 'PARTIDO FICTÍCIO' WHERE id BETWEEN 900001 AND 900013;
        UPDATE candidacy SET party_number = 12, party_name = 'PARTIDO FICTÍCIO'
         WHERE id IN ('00000000-0000-0000-0000-00000000a098', '00000000-0000-0000-0000-00000000b098',
                      '00000000-0000-0000-0000-00000000a099', '00000000-0000-0000-0000-00000000b099');
        INSERT INTO votable (id, uf, election_code, office_code, vote_kind, type_code, type_description, number, name, party_number, party_acronym)
             VALUES (900014, 'XX', 990, 7, 'candidate', 1, 'Nominal', 13013, 'CANDIDATO SEM REGISTRO', 13, 'PO');
        INSERT INTO section_office_vote (result_id, votable_id, votes, source_row_hash, source_line)
             VALUES (810100, 900014, 10, md5('810100-900014') || md5('900014'), 810100);
        REFRESH MATERIALIZED VIEW votable_zone_votes_current;
        REFRESH MATERIALIZED VIEW zone_office_totals_current;
        INSERT INTO candidacy (id, contest_id, tse_candidate_id, candidate_number, ballot_name, full_name, party_number, party_acronym,
             identity_status, source_file_id, ingestion_run_id, source_member, source_line, source_row_hash)
        SELECT c.id::uuid, '00000000-0000-0000-0000-0000000000c9', c.sq, c.num, c.ballot, c.ballot, c.party, c.acronym,
               'unresolved_document_unavailable', '00000000-0000-0000-0000-0000000000fc', '00000000-0000-0000-0000-0000000000ec',
               'fixture.csv', c.sq + 1, repeat(c.sq::text, 32)
          FROM (VALUES
            ('00000000-0000-0000-0000-00000000c077', 77, 77777, 'FORA DA URNA', 77, 'PX'),
            ('00000000-0000-0000-0000-00000000c078', 78, 78888, 'NA URNA SEM VOTO', 78, 'PY')
          ) AS c(id, sq, num, ballot, party, acronym);
        INSERT INTO candidacy_source_record (candidacy_id, record_kind, payload, source_file_id, ingestion_run_id, source_member,
             source_line, source_row_hash)
        SELECT c.id::uuid, 'complement', jsonb_build_object('inserted_in_urn', c.flag), '00000000-0000-0000-0000-0000000000fc',
               '00000000-0000-0000-0000-0000000000ec', 'complementar.csv', c.line, repeat(c.line::text, 32)
          FROM (VALUES ('00000000-0000-0000-0000-00000000c077', 'Não', 77), ('00000000-0000-0000-0000-00000000c078', 'SIM', 78))
            AS c(id, flag, line);
        """;

    [ElectoralSchemaFact]
    public async Task Party_sql_reads_votes_legend_candidacies_and_change_from_the_derived_aggregates()
    {
        await using var db = ElectoralXraySchemaTests.Db();
        await using var tx = await db.Database.BeginTransactionAsync(Ct);
        await db.Database.ExecuteSqlRawAsync(ElectoralXraySchemaTests.Seed, Ct);
        await db.Database.ExecuteSqlRawAsync(PartySeed, Ct);
        try
        {
            var service = new PartyService(new PartyRepository(db), new RankingRepository(db), new ElectoralXrayRepository(db));

            var list = await service.ListAsync("XX", Ct);
            // PY: candidatura inserida na urna e nenhum voto = zero real; PX: só candidatura fora da urna = votos ausentes
            Assert.Equal(["pf", "po", "py", "px"], list.Parties.Select(p => p.Slug));
            Assert.Equal((0L, 0.0), (list.Parties[2].Results.Single().Votes!.Value, list.Parties[2].Results.Single().Share!.Value));
            Assert.Equal(((long?)null, (double?)null), (list.Parties[3].Results.Single().Votes, list.Parties[3].Results.Single().Share));
            var pf2099 = list.Parties[0].Results.Single(r => r.Year == 2099);
            // 2099: nominais 33 + 18, legenda 15 → 66 de 76 válidos (o PO teve 10 nominais sem candidatura importada)
            Assert.Equal((66L, 51L, 15L, 76L, 2, 1), (pf2099.Votes!.Value, pf2099.NominalVotes!.Value, pf2099.LegendVotes!.Value, pf2099.ValidVotes!.Value, pf2099.Candidacies, pf2099.Elected));
            Assert.Equal(86.84, pf2099.Share);
            Assert.Equal(("comparable", 7L), (pf2099.Change!.Comparability, pf2099.Change.DeltaVotes!.Value)); // 59 em 2098
            var po = Assert.Single(list.Parties[1].Results);
            Assert.Equal((10L, 0), (po.Votes!.Value, po.Candidacies));

            var profile = await service.ProfileAsync("pf", "XX", 2099, 1, 7, Ct);
            var detail = profile.Detail!;
            var territory = Assert.Single(detail.Strongest);
            Assert.Equal(("99991", 66L, 76L), (territory.MunicipalityTseCode, territory.Votes, territory.ValidVotes));
            Assert.Equal([("Candidata A", 33L), ("Candidato B", 18L)], detail.Candidates.Select(c => (c.Name, c.Votes!.Value)));
            Assert.True(detail.Coverage!.Complete);

            var map = await service.MapAsync(new MapQuery(2099, 1, "XX", "party", 7, null, null, null, null, null), 12, Ct);
            Assert.Equal((86.84, "value"), (Assert.Single(map.Features).Value!.Value, map.Features[0].State));

            // inserida na urna e sem voto: zero real; só candidatura marcada "Não" e sem voto: não estava na urna
            var zero = await service.MapAsync(new MapQuery(2099, 1, "XX", "party", 7, null, null, null, null, null), 78, Ct);
            Assert.Equal((0.0, "zero"), (Assert.Single(zero.Features).Value!.Value, zero.Features[0].State));
            await Assert.ThrowsAsync<ElectoralBadRequestException>(() =>
                service.MapAsync(new MapQuery(2099, 1, "XX", "party", 7, null, null, null, null, null), 77, Ct));
            await Assert.ThrowsAsync<ElectoralBadRequestException>(() =>
                service.MapAsync(new MapQuery(2099, 1, "XX", "party", 7, null, null, null, null, null), 55, Ct));

            // uma segunda zona no cadastro sem BU: o município passa a ter cobertura parcial e perde a participação
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO electoral.electoral_zone (id, state_code, zone_number) VALUES ('00000000-0000-0000-0000-000000000002', 'XX', 2);
                INSERT INTO electoral.zone_municipality (zone_id, municipality_id, election_id)
                     VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000002099');
                """, Ct);
            var partial = await service.MapAsync(new MapQuery(2099, 1, "XX", "party", 7, null, null, null, null, null), 12, Ct);
            Assert.Equal(((double?)null, "partial_coverage"), (Assert.Single(partial.Features).Value, partial.Features[0].State));
            Assert.Empty((await service.ProfileAsync("pf", "XX", 2099, 1, 7, Ct)).Detail!.Strongest);
        }
        finally
        {
            await tx.RollbackAsync(Ct);
        }
    }
}
