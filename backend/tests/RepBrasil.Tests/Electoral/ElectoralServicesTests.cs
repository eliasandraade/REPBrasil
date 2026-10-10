using RepBrasil.Application.Electoral;

namespace RepBrasil.Tests.Electoral;

public class ElectoralServicesTests
{
    private static readonly Guid Gs = Guid.NewGuid();
    private static readonly Guid Caucaia = Guid.NewGuid();
    private static readonly Guid NoCadaster = Guid.NewGuid();
    private static readonly Guid Batch = Guid.NewGuid();
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static FakeElectoralRepository Repo()
    {
        var repo = new FakeElectoralRepository();
        repo.Municipalities.Add(new MunicipalityRow { Id = Gs, Uf = "CE", TseCode = "13935", IbgeCode = 2304608, Name = "General Sampaio", Slug = "general-sampaio", Zones = 1, Sections = 3 });
        repo.Municipalities.Add(new MunicipalityRow { Id = Caucaia, Uf = "CE", TseCode = "13730", IbgeCode = 2303709, Name = "Caucaia", Slug = "caucaia", Zones = 3, Sections = 4, ResultsZones = 1 });
        repo.Municipalities.Add(new MunicipalityRow { Id = NoCadaster, Uf = "CE", TseCode = "99999", IbgeCode = 2399999, Name = "Sem Cadastro", Slug = "sem-cadastro" });
        repo.Zones[Gs] = [new ZoneRow { Number = 50, Sections = 3, PrincipalSections = 2, AggregatedSections = 1, PollingPlaces = 2, EligibleFederal = 500, EligibleState = null }];
        repo.Zones[Caucaia] =
        [
            new ZoneRow { Number = 37, Sections = 1, PrincipalSections = 1, EligibleFederal = 10, EligibleState = 10 },
            new ZoneRow { Number = 120, Sections = 3, PrincipalSections = 2, AggregatedSections = 1, EligibleFederal = 572, EligibleState = 572, ResultsAvailable = true },
            new ZoneRow { Number = 123, Sections = 1, PrincipalSections = 1, EligibleFederal = 5, EligibleState = 5 },
        ];
        repo.Sections[(Caucaia, 120)] =
        [
            new SectionRow { Number = 58, PrincipalNumber = 58, PlaceCode = "A", EligibleFederal = 319, EligibleState = 319 },
            new SectionRow { Number = 79, PrincipalNumber = 58, IsAggregated = true, PlaceCode = "B" },
            new SectionRow { Number = 419, PrincipalNumber = 419, PlaceCode = "A", EligibleFederal = 253, EligibleState = 253 },
        ];
        repo.Places[(Caucaia, 120)] =
        [
            new PlaceRow { Code = "A", Name = "Escola A", Latitude = -3.7, Longitude = -38.6, CoordinatesSource = "tse" },
            new PlaceRow { Code = "B", Name = "Escola B" },
        ];
        repo.Batches[("13730", 120)] = new BatchRow { BatchId = Batch, ZipSha256 = "db72", CsvSha256 = "e626", OfficialChecksumAlgorithm = "sha512" };
        repo.Urns[(Batch, 58)] =
        [
            new UrnOfficeRow { ResultId = 5801, OfficeCode = 1, OfficeName = "Presidente", ElectionCode = 6257, Section = 58, AggregatedSections = [79], Eligible = 319, Turnout = 281, Abstentions = 38, VotesTotal = 281 },
            new UrnOfficeRow { ResultId = 5803, OfficeCode = 3, OfficeName = "Governador", ElectionCode = 6259, Section = 58, AggregatedSections = [79], Eligible = 319, Turnout = 281, Abstentions = 38, VotesTotal = 281 },
        ];
        repo.Votes[5801] =
        [
            new VoteRow { VoteKind = "candidate", Number = 13, Votes = 173, TypeCode = 1, TypeDescription = "Nominal", PartyNumber = 13 },
            new VoteRow { VoteKind = "candidate", Number = 22, Votes = 93, TypeCode = 1, TypeDescription = "Nominal", PartyNumber = 22 },
            new VoteRow { VoteKind = "blank", Number = 95, Votes = 7, TypeCode = 2, TypeDescription = "Branco" },
            new VoteRow { VoteKind = "null", Number = 96, Votes = 8, TypeCode = 3, TypeDescription = "Nulo" },
        ];
        repo.PrincipalsOfAggregated[(Batch, 79)] = [58];
        return repo;
    }

    private static (ElectoralCatalogService Catalog, SectionResultsService Results, FakeElectoralRepository Repo) Services(FakeElectoralRepository? repo = null)
    {
        repo ??= Repo();
        var catalog = new ElectoralCatalogService(repo);
        return (catalog, new SectionResultsService(repo, catalog), repo);
    }

    private static ResultFiltersDto NoFilters => new(null, null, null, null);

    [Fact]
    public async Task Municipality_resolves_by_slug_tse_or_ibge_code()
    {
        var (catalog, _, _) = Services();
        foreach (var key in new[] { "caucaia", "13730", "2303709", "CAUCAIA" })
        {
            var detail = await catalog.MunicipalityDetailAsync(2026, 1, "ce", key, Ct);
            Assert.Equal("caucaia", detail.Municipality.Slug);
        }

        await Assert.ThrowsAsync<ElectoralNotFoundException>(() => catalog.MunicipalityDetailAsync(2026, 1, "ce", "nao-existe", Ct));
        await Assert.ThrowsAsync<ElectoralNotFoundException>(() => catalog.MunicipalityDetailAsync(2026, 1, "xx", "caucaia", Ct));
        await Assert.ThrowsAsync<ElectoralNotFoundException>(() => catalog.MunicipalityDetailAsync(2030, 1, "ce", "caucaia", Ct));
    }

    [Fact]
    public async Task Territory_without_cadaster_is_explicit_not_404()
    {
        var (catalog, results, _) = Services();
        var detail = await catalog.MunicipalityDetailAsync(2026, 1, "ce", "sem-cadastro", Ct);
        Assert.Equal("cadaster_missing", detail.Status);
        Assert.Empty(detail.Zones);
        var r = await results.ExecuteAsync(2026, 1, "ce", "sem-cadastro", 1, 1, NoFilters, Ct);
        Assert.Equal("cadaster_missing", r.Status);
        Assert.Null(r.Metrics);
    }

    [Fact]
    public async Task Summary_keeps_unknown_eligible_as_null()
    {
        var (catalog, _, _) = Services();
        var gs = await catalog.MunicipalityDetailAsync(2026, 1, "ce", "general-sampaio", Ct);
        Assert.Equal(500, gs.Summary!.Eligible.Federal);
        Assert.Null(gs.Summary.Eligible.State);
        Assert.Null(ElectoralCatalogService.SumOrNull([1, null, 2]));
        Assert.Equal(3, ElectoralCatalogService.SumOrNull([1, 2]));
    }

    [Fact]
    public async Task Zone_lists_each_principal_followed_by_its_aggregated_and_only_official_coordinates()
    {
        var (catalog, _, _) = Services();
        var zone = await catalog.ZoneDetailAsync(2026, 1, "ce", "caucaia", 120, Ct);
        var a = zone.Places.Single(p => p.Code == "A");
        Assert.Equal([58, 419], a.Sections.Select(s => s.Number));
        Assert.Equal([79], a.Sections.Single(s => s.Number == 58).AggregatedSections);
        var b = zone.Places.Single(p => p.Code == "B");
        Assert.Null(b.Coordinates);
        var aggregated = b.Sections.Single();
        Assert.True(aggregated.IsAggregated);
        Assert.Null(aggregated.Eligible); // contado na principal, nunca zero
        await Assert.ThrowsAsync<ElectoralNotFoundException>(() => catalog.ZoneDetailAsync(2026, 1, "ce", "caucaia", 999, Ct));
    }

    [Fact]
    public async Task Aggregated_section_answers_with_the_principal_urn()
    {
        var (_, results, _) = Services();
        var r = await results.ExecuteAsync(2026, 1, "ce", "caucaia", 120, 79, NoFilters, Ct);
        Assert.Equal("available", r.Status);
        Assert.True(r.Aggregated);
        Assert.Equal(58, r.PrincipalSection);
        Assert.Equal([79], r.AggregatedSections!);
        Assert.Equal(new MetricsDto(319, 281, 38, 266, 7, 8), r.Metrics);
        Assert.Equal(65.04, r.Votes!.First().Percentage);
    }

    [Fact]
    public async Task Aggregation_divergence_between_source_and_cadaster_is_an_integrity_error()
    {
        var repo = Repo();
        repo.PrincipalsOfAggregated[(Batch, 79)] = [419];
        var (_, results, _) = Services(repo);
        await Assert.ThrowsAsync<ElectoralIntegrityException>(() => results.ExecuteAsync(2026, 1, "ce", "caucaia", 120, 79, NoFilters, Ct));
    }

    [Fact]
    public async Task Zone_without_results_is_not_ingested_never_zero()
    {
        var repo = Repo();
        repo.Sections[(Caucaia, 37)] = [new SectionRow { Number = 1, PrincipalNumber = 1, PlaceCode = "A" }];
        var (_, results, _) = Services(repo);
        var r = await results.ExecuteAsync(2026, 1, "ce", "caucaia", 37, 1, NoFilters, Ct);
        Assert.Equal("not_ingested", r.Status);
        Assert.Null(r.Metrics);
        Assert.Null(r.Votes);
    }

    [Fact]
    public async Task Office_filter_and_bad_requests()
    {
        var (_, results, repo) = Services();
        repo.Votes[5803] = [new VoteRow { VoteKind = "candidate", Number = 55, Votes = 281, TypeCode = 1, TypeDescription = "Nominal" }];
        var gov = await results.ExecuteAsync(2026, 1, "ce", "caucaia", 120, 58, new ResultFiltersDto(3, null, null, null), Ct);
        Assert.Equal(3, gov.SelectedOffice!.Code);
        Assert.Contains("5803/CE", repo.VoteQueries);
        await Assert.ThrowsAsync<ElectoralBadRequestException>(() => results.ExecuteAsync(2026, 1, "ce", "caucaia", 120, 58, new ResultFiltersDto(7, null, null, null), Ct));
        await Assert.ThrowsAsync<ElectoralBadRequestException>(() => results.ExecuteAsync(2026, 1, "ce", "caucaia", 120, 58, new ResultFiltersDto(null, 99, null, null), Ct));
        Assert.Throws<ElectoralBadRequestException>(() => SectionResultsService.ParseFilters("abc", null, null, null));
        Assert.Throws<ElectoralBadRequestException>(() => SectionResultsService.ParseFilters(null, null, null, "todos"));
        Assert.Equal(new ResultFiltersDto(1, null, null, "nominal"), SectionResultsService.ParseFilters("1", "", null, "nominal"));
    }

    private static CoverageScopeRow Scope(string uf, string municipality, int zone, bool imported) =>
        new() { Uf = uf, MunicipalityTseCode = municipality, Zone = zone, Imported = imported };

    private const string CompleteNote = "Todas as seções da disputa estão importadas.";

    private static void AssertPartial(CoverageDto coverage)
    {
        Assert.False(coverage.Complete);
        Assert.NotEqual(CompleteNote, coverage.Note);
        Assert.DoesNotContain("Todas as seções", coverage.Note, StringComparison.Ordinal);
    }

    [Fact]
    public void Coverage_single_zone_municipality_fully_imported_is_complete()
    {
        var c = CandidacyService.Coverage("CE", [Scope("CE", "13935", 50, true)]);
        Assert.True(c.Complete);
        Assert.Equal(CompleteNote, c.Note);
        var uf = Assert.Single(c.Ufs);
        Assert.Equal((1, 1, 1, 1), (uf.ZonesWithResults, uf.ZonesExpected, uf.MunicipalitiesComplete, uf.MunicipalitiesExpected));
    }

    [Fact]
    public void Coverage_three_zone_municipality_with_one_zone_imported_is_partial()
    {
        // Regressão P1: um lote em 1 de 3 zonas NÃO torna o município (nem a UF) coberto.
        var c = CandidacyService.Coverage("CE",
            [Scope("CE", "13730", 37, true), Scope("CE", "13730", 120, false), Scope("CE", "13730", 123, false)]);
        AssertPartial(c);
        var uf = Assert.Single(c.Ufs);
        Assert.Equal((1, 3, 0, 1, 1), (uf.ZonesWithResults, uf.ZonesExpected, uf.MunicipalitiesComplete, uf.MunicipalitiesWithAnyResult, uf.MunicipalitiesExpected));
        Assert.Contains("1 de 3 zonas", c.Note, StringComparison.Ordinal);
    }

    [Fact]
    public void Coverage_three_zone_municipality_fully_imported_is_complete()
    {
        var c = CandidacyService.Coverage("CE",
            [Scope("CE", "13730", 37, true), Scope("CE", "13730", 120, true), Scope("CE", "13730", 123, true)]);
        Assert.True(c.Complete);
        Assert.Equal(CompleteNote, c.Note);
    }

    [Fact]
    public void Coverage_state_with_one_partially_imported_municipality_is_partial()
    {
        // Todos os municípios têm "algum" resultado — a contagem antiga por município declararia completo.
        var c = CandidacyService.Coverage("CE",
        [
            Scope("CE", "13935", 50, true),
            Scope("CE", "13897", 1, true), Scope("CE", "13897", 94, true),
            Scope("CE", "13730", 37, true), Scope("CE", "13730", 120, false), Scope("CE", "13730", 123, true),
        ]);
        AssertPartial(c);
        var uf = Assert.Single(c.Ufs);
        Assert.Equal(3, uf.MunicipalitiesWithAnyResult);
        Assert.Equal(2, uf.MunicipalitiesComplete);
        Assert.Equal((5, 6), (uf.ZonesWithResults, uf.ZonesExpected));
    }

    [Fact]
    public void Coverage_federal_contest_with_only_ce_loaded_is_partial()
    {
        IReadOnlyList<CoverageScopeRow> scopes =
        [
            Scope("CE", "13935", 50, true), Scope("CE", "13730", 37, true),
            Scope("PE", "25313", 1, false),
        ];
        var national = CandidacyService.Coverage("BR", scopes);
        AssertPartial(national);
        Assert.Equal(["CE"], national.Ufs.Select(u => u.Uf));
        Assert.True(national.Ufs[0].Complete);
        Assert.Contains("CE", national.Note, StringComparison.Ordinal);
        Assert.Contains("exterior", national.Note, StringComparison.Ordinal);
        AssertPartial(CandidacyService.Coverage("PE", scopes));
        AssertPartial(CandidacyService.Coverage("SP", scopes));
    }

    [Fact]
    public async Task Politician_candidacies_carry_the_party_of_that_election_and_derived_shares()
    {
        var repo = Repo();
        var politician = Guid.NewGuid();
        var withVotes = new CandidacyRow
        {
            Id = Guid.NewGuid(),
            TseCandidateId = 60002537654,
            CandidateNumber = 5533,
            BallotName = "CANDIDATO",
            PartyNumber = 55,
            PartyAcronym = "PSD",
            Year = 2026,
            Round = 1,
            OfficeCode = 6,
            OfficeName = "DEPUTADO FEDERAL",
            Scope = "state",
            ElectoralUnit = "CE",
            IdentityStatus = "resolved",
            PoliticianId = politician,
            HasVotes = true,
            SourceMember = "consulta_cand_2026_CE.csv",
            SourceLine = 2,
        };
        var vice = new CandidacyRow
        {
            Id = Guid.NewGuid(),
            TseCandidateId = 60002537655,
            CandidateNumber = 555,
            BallotName = "CANDIDATO",
            Year = 2026,
            Round = 1,
            OfficeCode = 9,
            OfficeName = "1º SUPLENTE",
            Scope = "state",
            ElectoralUnit = "CE",
            IdentityStatus = "resolved",
            PoliticianId = politician,
        };
        repo.Candidacies.AddRange([withVotes, vice]);
        repo.CandidacyVotes[withVotes.Id] =
        [
            new TerritoryVotesRow { Uf = "CE", MunicipalityTseCode = "13897", MunicipalityName = "Fortaleza", Votes = 1000, ValidVotes = 3000, Urns = 10 },
            new TerritoryVotesRow { Uf = "CE", MunicipalityTseCode = "13730", MunicipalityName = "Caucaia", Votes = 2000, ValidVotes = 4000, Urns = 5 },
            new TerritoryVotesRow { Uf = "CE", MunicipalityTseCode = "13935", MunicipalityName = "General Sampaio", Votes = 5, ValidVotes = 0, Urns = 1 },
        ];
        repo.Coverage.AddRange([Scope("CE", "13897", 1, true), Scope("CE", "13730", 37, true), Scope("CE", "13935", 50, true)]);
        var service = new CandidacyService(repo);
        var response = await service.ByPoliticianAsync(politician, 2, Ct);
        var c = response.Candidacies.Single(x => x.Id == withVotes.Id);
        Assert.Equal("PSD", c.Party!.Acronym);
        Assert.True(c.ProfileAvailable);
        Assert.Equal(3005, c.Performance!.Votes);
        Assert.Equal(["Caucaia", "Fortaleza"], c.Performance.Municipalities.Select(m => m.MunicipalityName));
        Assert.Equal(50, c.Performance.Municipalities[0].ShareOfValidVotes);
        Assert.True(c.Performance.Coverage.Complete);
        Assert.Null(response.Candidacies.Single(x => x.Id == vice.Id).Performance);
        Assert.Null(CandidacyService.TerritoryView(repo.CandidacyVotes[withVotes.Id][2]).ShareOfValidVotes);
        await Assert.ThrowsAsync<ElectoralNotFoundException>(() => service.PerformanceAsync(Guid.NewGuid(), Ct));
    }
}
