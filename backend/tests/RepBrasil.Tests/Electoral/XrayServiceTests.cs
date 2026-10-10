using RepBrasil.Application.Electoral;

namespace RepBrasil.Tests.Electoral;

/// <summary>Raio X do perfil e listas territoriais sobre dados fictícios.</summary>
public class XrayServiceTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly Guid Politician = Guid.NewGuid(), Person = Guid.NewGuid();
    private static readonly Guid A22 = Guid.NewGuid(), A26 = Guid.NewGuid(), Governor = Guid.NewGuid(), Vice = Guid.NewGuid();

    private static FakeXrayRepository Repo()
    {
        var repo = new FakeXrayRepository();
        repo.Politicians.Add(new PoliticianRefRow { Id = Politician, Name = "Candidata Fictícia", PersonId = Person });
        repo.Municipalities.AddRange([
            new MunicipalityRefRow { Uf = "CE", TseCode = "11111", Name = "Município Um", Slug = "municipio-um", IbgeCode = 2300001 },
            new MunicipalityRefRow { Uf = "CE", TseCode = "22222", Name = "Município Dois", Slug = "municipio-dois", IbgeCode = 2300002 },
        ]);
        repo.Candidacies.AddRange([
            Xray.Candidacy(A22, 2022, 7, "state", "CE", 12345, "CANDIDATA", Person, Politician, outcome: "SUPLENTE", elected: false),
            Xray.Candidacy(A26, 2026, 7, "state", "CE", 12345, "CANDIDATA", Person, Politician, outcome: "ELEITO POR QP", elected: true),
            Xray.Candidacy(Governor, 2026, 3, "state", "CE", 77, "GOVERNADOR FICTÍCIO", officeName: "Governador"),
            Xray.Candidacy(Vice, 2026, 4, "state", "CE", 77, "VICE FICTÍCIA", Person, Politician, hasLink: false, officeName: "Vice-Governador"),
        ]);
        foreach (var year in new[] { 2022, 2026 })
        {
            repo.Expected.AddRange([Xray.Zone(year, "11111", 1, "Município Um"), Xray.Zone(year, "22222", 2, "Município Dois")]);
            repo.Totals.AddRange([Xray.Totals(year, 7, "11111", 1, 1000), Xray.Totals(year, 7, "22222", 2, 1000)]);
        }
        repo.Totals.AddRange([Xray.Totals(2026, 3, "11111", 1, 1200), Xray.Totals(2026, 3, "22222", 2, 900)]);
        repo.ZoneVotes.AddRange([
            Xray.ZoneVotes(A22, "11111", 1, 10),
            Xray.ZoneVotes(A22, "22222", 2, 30),
            Xray.ZoneVotes(A26, "11111", 1, 20),
            Xray.ZoneVotes(A26, "22222", 2, 25),
            Xray.ZoneVotes(Governor, "11111", 1, 600),
            Xray.ZoneVotes(Governor, "22222", 2, 450),
        ]);
        repo.Ranks.AddRange([
            new ContestRankRow { CandidacyId = A22, Votes = 40, Rank = 9, CandidatesWithVotes = 50 },
            new ContestRankRow { CandidacyId = A26, Votes = 45, Rank = 3, CandidatesWithVotes = 48 },
        ]);
        repo.Tickets.Add(new TicketRow { CandidacyId = Vice, HeadCandidacyId = Governor, HeadBallotName = "GOVERNADOR FICTÍCIO", HeadOfficeCode = 3 });
        repo.Assets.AddRange([
            new AssetRow { CandidacyId = A22, TypeCode = 11, Type = "Casa", Description = "CASA NA RUA FICTÍCIA", Value = 100_000m },
            new AssetRow { CandidacyId = A22, TypeCode = 21, Type = "Veículo", Description = "CARRO", Value = 50_000m },
            new AssetRow { CandidacyId = A26, TypeCode = 11, Type = "Casa", Description = "Casa na Rua Fictícia", Value = 150_000m },
            new AssetRow { CandidacyId = A26, TypeCode = 12, Type = "Apartamento", Description = "APARTAMENTO", Value = 200_000m },
        ]);
        repo.Records.AddRange([
            new SourceRecordRow { CandidacyId = A26, Kind = "social_network", PayloadJson = """{"order": 2, "url": "https://example.org/b"}""" },
            new SourceRecordRow { CandidacyId = A26, Kind = "social_network", PayloadJson = """{"order": 1, "url": "https://example.org/a"}""" },
            new SourceRecordRow { CandidacyId = A26, Kind = "complement", PayloadJson = """{"inserted_in_urn": "SIM", "reelection": "N"}""" },
        ]);
        repo.Priors.Add(new PriorRow
        {
            CandidacyId = A26,
            PriorYear = 2024,
            PriorTurn = 1,
            PriorTseCandidateId = 60001,
            PriorOfficeCode = 13,
            PriorOfficeName = "Vereador",
            PriorElectoralUnit = "11111",
            PriorUnitName = "MUNICÍPIO UM",
            PriorCandidateNumber = 12345,
            PriorBallotName = "CANDIDATA",
            PriorPartyAcronym = "PF",
            PriorRoundOutcome = "SUPLENTE",
        });
        return repo;
    }

    [Fact]
    public async Task Xray_lists_candidacies_with_totals_ticket_and_evolution()
    {
        var r = await new XrayService(Repo()).BuildAsync(Politician, Ct);

        Assert.Equal(["Vice-Governador", "Deputado Estadual", "Deputado Estadual"], r.Candidacies.Select(c => c.Contest.OfficeName));
        var a26 = r.Candidacies.Single(c => c.CandidacyId == A26);
        Assert.Equal(45, a26.Totals.Votes);
        Assert.Equal(2.25, a26.Totals.ShareOfValidVotes);
        Assert.Equal(3, a26.Totals.Rank);
        Assert.True(a26.Totals.Coverage.Complete);
        Assert.Equal(["https://example.org/a", "https://example.org/b"], a26.Records.SocialNetworks);

        var vice = r.Candidacies.Single(c => c.CandidacyId == Vice);
        Assert.Equal(CellState.TicketMember, vice.Totals.State);
        Assert.Null(vice.Totals.Votes);
        Assert.Equal((Governor, 1050L), (vice.Ticket!.HeadCandidacyId!.Value, vice.Ticket.HeadVotes!.Value));
        Assert.Equal("vice", vice.Ticket.Role);

        var step = Assert.Single(r.Evolution);
        Assert.Equal((A22, A26, ContestComparability.Comparable), (step.FromCandidacyId, step.ToCandidacyId, step.Comparability));
        Assert.Equal((5L, 12.5), (step.DeltaVotes!.Value, step.DeltaPercent!.Value));

        var history = Assert.Single(r.OfficialHistory);
        Assert.Equal((2024, "Vereador", false), (history.Year, history.OfficeName, history.Imported));
        Assert.Contains(r.Insights, i => i.Code == "evolution_votes");
        Assert.Contains(r.Insights, i => i.Code == "rank_in_contest" && i.Values["rank"] is 3);
        Assert.Contains(r.Insights, i => i.Code == "top_territory" && i.Text.Contains("Município Dois"));
    }

    [Fact]
    public async Task Evolution_compares_with_the_previous_candidacy_of_the_same_contest()
    {
        // Dep. Estadual 2022 → Vereadora 2024 → Dep. Estadual 2026: o delta é 2022 → 2026, não 2024 → 2026
        var repo = Repo();
        var v24 = Guid.NewGuid();
        repo.Candidacies.Add(Xray.Candidacy(v24, 2024, 13, "municipal", "11111", 12345, "CANDIDATA", Person, Politician, officeName: "Vereador"));
        var r = await new XrayService(repo).BuildAsync(Politician, Ct);
        Assert.Equal([(A22, v24), (A22, A26)], r.Evolution.Select(s => (s.FromCandidacyId, s.ToCandidacyId)));
        Assert.NotEqual(ContestComparability.Comparable, r.Evolution[0].Comparability);
        Assert.Equal((ContestComparability.Comparable, 5L), (r.Evolution[1].Comparability, r.Evolution[1].DeltaVotes!.Value));
        Assert.Contains(r.Insights, i => i.Code == "evolution_votes" && i.Text.Contains("de 2022 para 2026"));
    }

    [Fact]
    public async Task Assets_evolution_matches_items_without_judging()
    {
        var r = await new XrayService(Repo()).BuildAsync(Politician, Ct);
        var step = Assert.Single(r.AssetsEvolution);
        Assert.Equal((150_000m, 350_000m, 200_000m), (step.FromTotal, step.ToTotal, step.Delta));
        Assert.Equal(133.33, step.DeltaPercent);
        Assert.Equal((1, 1, 1), (step.Added, step.Removed, step.Kept)); // casa mantida, carro saiu, apartamento entrou
        var insight = r.Insights.Single(i => i.Code == "assets_change");
        Assert.Contains("não indica irregularidade", insight.Text);
    }

    [Fact]
    public async Task Partial_coverage_has_no_rank_and_no_delta()
    {
        var repo = Repo();
        repo.Expected.Add(Xray.Zone(2026, "33333", 3, "Município Três")); // zona esperada sem BU importado
        var r = await new XrayService(repo).BuildAsync(Politician, Ct);
        var a26 = r.Candidacies.Single(c => c.CandidacyId == A26);
        Assert.Equal(CellState.PartialCoverage, a26.Totals.State);
        Assert.False(a26.Totals.Coverage.Complete);
        Assert.Null(a26.Totals.Rank);
        Assert.Equal(ContestComparability.Unavailable, Assert.Single(r.Evolution).Comparability);
        Assert.Contains(r.Insights, i => i.Code == "coverage_partial");
        Assert.Contains("dos votos da candidatura com Boletim de Urna importado", r.Insights.Single(i => i.Code == "top_territory").Text);
    }

    [Fact]
    public async Task Unknown_politician_is_not_found_and_no_candidacy_is_empty()
    {
        await Assert.ThrowsAsync<ElectoralNotFoundException>(() => new XrayService(Repo()).BuildAsync(Guid.NewGuid(), Ct));
        var repo = Repo();
        var lonely = Guid.NewGuid();
        repo.Politicians.Add(new PoliticianRefRow { Id = lonely, Name = "Sem Candidaturas" });
        var r = await new XrayService(repo).BuildAsync(lonely, Ct);
        Assert.Empty(r.Candidacies);
    }

    [Fact]
    public async Task Territory_candidates_filter_sort_page_and_rank()
    {
        var repo = Repo();
        var service = new TerritoryService(repo);
        var all = await service.CandidatesAsync(new CandidatesQuery(2026, 1, "CE", null, null, null, null, null, null, null, null, "votes", "desc", 1, 50), Ct);
        Assert.Equal([Governor, A26, Vice], all.Items.Select(i => i.CandidacyId));
        Assert.Equal(CellState.TicketMember, all.Items.Single(i => i.CandidacyId == Vice).State);
        Assert.Contains(all.Offices, f => f.Value == "7" && f.Count == 1);

        var municipality = await service.CandidatesAsync(new CandidatesQuery(2026, 1, "CE", "22222", null, 7, null, null, null, null, null, null, null, 1, 10), Ct);
        var only = Assert.Single(municipality.Items);
        Assert.Equal((25L, 2.5, 1), (only.Votes!.Value, only.Share!.Value, only.Rank!.Value));
        Assert.Equal("Município Dois", municipality.MunicipalityName);

        var elected = await service.CandidatesAsync(new CandidatesQuery(2026, 1, "CE", null, null, null, null, "candidata", null, true, null, null, null, 1, 10), Ct);
        Assert.Equal(A26, Assert.Single(elected.Items).CandidacyId);
        var paged = await service.CandidatesAsync(new CandidatesQuery(2026, 1, "CE", null, null, null, null, null, null, null, null, "votes", "desc", 2, 1), Ct);
        Assert.Equal((3, A26), (paged.Total, Assert.Single(paged.Items).CandidacyId));
        await Assert.ThrowsAsync<ElectoralBadRequestException>(() =>
            service.CandidatesAsync(new CandidatesQuery(2026, 1, "CE", null, 1, null, null, null, null, null, null, null, null, 1, 10), Ct));
    }

    [Fact]
    public async Task Distribution_and_map_layers_come_from_the_api_values()
    {
        var repo = Repo();
        var service = new TerritoryService(repo);
        var d = await service.DistributionAsync(A26, "municipality", null, null, null, Ct);
        Assert.Equal(["Município Dois", "Município Um"], d.Territories.Select(t => t.MunicipalityName));
        Assert.Equal(45, d.Summary.Votes);
        Assert.Equal(25, d.Summary.Best!.Votes);
        Assert.Contains("(55,56% da votação da candidatura)", d.Insights.Single(i => i.Code == "top_territory").Text);
        // município escolhido: o percentual é do recorte, não da votação inteira
        var zones = await service.DistributionAsync(A26, "zone", null, "22222", null, Ct);
        Assert.Contains("(100% dos votos da candidatura no recorte)", zones.Insights.Single(i => i.Code == "top_territory").Text);

        var growth = await service.MapAsync(new MapQuery(2026, 1, "CE", "growth", null, A26, A22, null, null, null), Ct);
        Assert.Equal(ContestComparability.Comparable, growth.Comparability);
        Assert.Equal(10, growth.Features.Single(f => f.MunicipalityTseCode == "11111").Value);
        Assert.Equal(2300001, growth.Features.Single(f => f.MunicipalityTseCode == "11111").IbgeCode);
        var decline = await service.MapAsync(new MapQuery(2026, 1, "CE", "decline", null, A26, A22, null, null, null), Ct);
        Assert.Equal(-5, decline.Features.Single(f => f.MunicipalityTseCode == "22222").Value);

        var winner = await service.MapAsync(new MapQuery(2026, 1, "CE", "winner", 7, null, null, null, null, null), Ct);
        Assert.All(winner.Features, f => Assert.Equal(A26.ToString(), f.Category));
        Assert.Equal(A26.ToString(), Assert.Single(winner.Legend).Category);
        await Assert.ThrowsAsync<ElectoralBadRequestException>(() =>
            service.MapAsync(new MapQuery(2026, 1, "CE", "winner", null, null, null, null, null, null), Ct));
    }

    [Fact]
    public async Task Section_distribution_uses_the_reference_municipality_name()
    {
        var repo = Repo();
        repo.Sections.Add(Xray.Section(31, 2026, 7, 5, [5], zone: 2, municipality: "22222")); // nome do BU: caixa alta
        repo.SectionVotes.Add(Xray.Votes(31, A26, 12));
        var d = await new TerritoryService(repo).DistributionAsync(A26, "section", null, "22222", null, Ct);
        var only = Assert.Single(d.Territories);
        Assert.Equal(("Município Dois", 12L), (only.MunicipalityName, only.Votes!.Value));
        Assert.StartsWith("Maior votação: Município Dois · zona 2 · seção 5", d.Insights.Single(i => i.Code == "top_territory").Text);
    }
}
