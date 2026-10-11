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
    public async Task Profile_detail_lists_strongest_and_weakest_municipalities_only_where_the_party_ran()
    {
        var (service, repo, _) = Service();
        repo.Offices.Add(Office(2022, 65, "PCdoB", 300, 50, 3_000, office: 13));
        repo.Territories.AddRange([
            new PartyTerritoryRow { MunicipalityTseCode = "00001", MunicipalityName = "A", ValidVotes = 1_000, NominalVotes = 200, LegendVotes = 50, Candidacies = 5, Elected = 1 },
            new PartyTerritoryRow { MunicipalityTseCode = "00002", MunicipalityName = "B", ValidVotes = 1_000, NominalVotes = 0, LegendVotes = 0, Candidacies = 2, Elected = 0 },
            new PartyTerritoryRow { MunicipalityTseCode = "00003", MunicipalityName = "C", ValidVotes = 1_000, NominalVotes = 0, LegendVotes = 0, Candidacies = 0, Elected = 0 },
        ]);

        var detail = (await service.ProfileAsync("pcdob", "CE", 2022, 1, 13, Ct)).Detail!;

        Assert.Equal(2, detail.TerritoriesConsidered); // C não teve candidatura do partido: fora (não é zero)
        Assert.Equal(1, detail.TerritoriesWithVotes);
        Assert.Equal(["A", "B"], detail.Strongest.Select(t => t.Name));
        Assert.Equal(25.0, detail.Strongest[0].Share);
        Assert.Empty(detail.Weakest); // os dois já estão entre os mais fortes
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
    public async Task Map_marks_municipalities_without_the_party_on_the_ballot_and_keeps_real_zeros()
    {
        var (service, repo, _) = Service();
        repo.Territories.AddRange([
            new PartyTerritoryRow { MunicipalityTseCode = "00001", MunicipalityName = "A", IbgeCode = 1, ValidVotes = 1_000, NominalVotes = 100, LegendVotes = 0, Candidacies = 1, Elected = 1 },
            new PartyTerritoryRow { MunicipalityTseCode = "00002", MunicipalityName = "B", IbgeCode = 2, ValidVotes = 1_000, NominalVotes = 0, LegendVotes = 0, Candidacies = 1, Elected = 0 },
            new PartyTerritoryRow { MunicipalityTseCode = "00003", MunicipalityName = "C", IbgeCode = 3, ValidVotes = 1_000, NominalVotes = 0, LegendVotes = 0, Candidacies = 0, Elected = 0 },
        ]);

        var map = await service.MapAsync(new MapQuery(2024, 1, "CE", "party", 11, null, null, null, null, null), 65, Ct);

        Assert.Equal("party", map.Layer);
        Assert.Equal<(double?, string)>(
            [(10.0, "value"), (0.0, "zero"), (null, "not_on_ballot")], map.Features.Select(f => (f.Value, f.State)));
        Assert.Null(map.Features[2].Details["votes"]);
        // dentro de um município o mapa continua por município (não há polígono de zona)
        var inside = await service.MapAsync(new MapQuery(2024, 1, "CE", "party", 11, null, null, null, null, "00001"), 65, Ct);
        Assert.Equal(("municipality", 3), (inside.Level, inside.Features.Count));
        await Assert.ThrowsAsync<ElectoralBadRequestException>(() =>
            service.MapAsync(new MapQuery(2024, 1, "CE", "party", 12, null, null, null, null, null), 65, Ct)); // vice
        await Assert.ThrowsAsync<ElectoralBadRequestException>(() =>
            service.MapAsync(new MapQuery(2024, 1, "CE", "party", 11, null, null, null, null, null), null, Ct));
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
            Assert.Equal(["pf", "po"], list.Parties.Select(p => p.Slug));
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
        }
        finally
        {
            await tx.RollbackAsync(Ct);
        }
    }
}
