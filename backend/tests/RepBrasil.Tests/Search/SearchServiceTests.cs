using RepBrasil.Application.Interfaces;
using RepBrasil.Application.Search;

namespace RepBrasil.Tests.Search;

/// <summary>Busca global com catálogo sintético: normalização, filtros de pleito, territórios, partidos e ordem dos grupos.</summary>
public class SearchServiceTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private sealed class FakeSearchRepository(SearchCatalog catalog) : ISearchRepository
    {
        public List<(IReadOnlyList<string> Terms, string Text, SearchFilter Filter)> PoliticianCalls { get; } = [];
        public List<SearchPoliticianRow> Politicians { get; } = [];
        public int CatalogCalls { get; private set; }

        public Task<IReadOnlyList<SearchPoliticianRow>> PoliticiansAsync(
            IReadOnlyList<string> terms, string text, SearchFilter filter, int limit, CancellationToken ct)
        {
            PoliticianCalls.Add((terms, text, filter));
            return Task.FromResult<IReadOnlyList<SearchPoliticianRow>>(Politicians.Take(limit).ToList());
        }

        public Task<SearchCatalog> CatalogAsync(CancellationToken ct)
        {
            CatalogCalls++;
            return Task.FromResult(catalog);
        }
    }

    private static SearchTerritoryRow State(string uf, string name, string? elections = null) =>
        new() { Kind = "state", Uf = uf, Name = name, Elections = elections };

    private static SearchTerritoryRow Municipality(string uf, string state, string code, string name, string slug, string? elections = null) =>
        new() { Kind = "municipality", Uf = uf, StateName = state, TseCode = code, Name = name, Slug = slug, Elections = elections };

    private static SearchElectionRow Election(int year, int round, string uf, int office) =>
        new() { Year = (short)year, Round = (short)round, Uf = uf, OfficeCode = office };

    private static SearchPartyRow Party(string acronym, string name, int number, int candidacies, int year) =>
        new() { Acronym = acronym, Name = name, Number = number, Candidacies = candidacies, Year = (short)year, Round = 1 };

    private static SearchCatalog Catalog() => new(
        [
            State("CE", "Ceará", "2024-2,2024-1,2022-1"),
            State("SP", "São Paulo"),
            State("BA", "Bahia"),
            Municipality("CE", "Ceará", "13897", "Fortaleza", "fortaleza", "2024-2,2024-1,2022-1"),
            Municipality("CE", "Ceará", "14478", "Juazeiro do Norte", "juazeiro-do-norte", "2024-1,2022-1"),
            Municipality("BA", "Bahia", "36692", "Juazeiro", "juazeiro"),
            Municipality("MG", "Minas Gerais", "45250", "Fortaleza de Minas", "fortaleza-de-minas"),
            Municipality("SP", "São Paulo", "71072", "São Paulo", "sao-paulo"),
            Municipality("SP", "São Paulo", "61018", "Adamantina", "adamantina"),
            Municipality("RN", "Rio Grande do Norte", "16837", "Governador Dix-Sept Rosado", "governador-dix-sept-rosado"),
        ],
        [
            Party("PT", "PARTIDO DOS TRABALHADORES", 13, 1772, 2026),
            Party("PTB", "PARTIDO TRABALHISTA BRASILEIRO", 14, 50, 2022),
            Party("PC do B", "PARTIDO COMUNISTA DO BRASIL", 65, 140, 2024),
            Party("PCDOB", "PARTIDO COMUNISTA DO BRASIL", 65, 5, 2026),
            Party("PSTU", "PARTIDO SOCIALISTA DOS TRABALHADORES UNIFICADO", 16, 24, 2026),
        ],
        [
            Election(2022, 1, "CE", 6), Election(2022, 1, "CE", 3), Election(2022, 1, "CE", 1),
            Election(2024, 1, "CE", 11), Election(2024, 1, "CE", 13), Election(2024, 2, "CE", 11),
        ]);

    [Theory]
    [InlineData("Deputado Federal 2022", 2022, null, 6, "")]
    [InlineData("prefeito 2024 2º turno", 2024, 2, 11, "")]
    [InlineData("vereadora segundo turno", null, 2, 13, "")]
    [InlineData("eleições 2026", 2026, null, null, "")]
    [InlineData("André Fernandes", null, null, null, "andre fernandes")]
    [InlineData("Juazeiro do Norte", null, null, null, "juazeiro do norte")]
    public void Parse_extracts_the_election_filter_and_keeps_the_rest_as_text(string q, int? year, int? round, int? office, string text)
    {
        var p = SearchService.Parse(q);
        Assert.Equal(new SearchFilter(year, round, office), p.Filter);
        Assert.Equal(text, p.Text);
    }

    [Fact]
    public void Parse_drops_particles_from_required_terms_but_not_from_the_ranking_text()
    {
        var p = SearchService.Parse("  Juazeiro   DO Norte ");
        Assert.Equal(["juazeiro", "norte"], p.Terms);
        Assert.Equal("juazeiro do norte", p.Text);
    }

    [Theory]
    [InlineData("São Gonçalo d'Água", "sao goncalo d agua")]
    [InlineData("ÉSIO DO PT", "esio do pt")]
    [InlineData("50% _x_", "50 x")]
    [InlineData(null, "")]
    public void Fold_removes_accents_case_and_punctuation(string? value, string folded) =>
        Assert.Equal(folded, SearchService.Fold(value));

    [Fact]
    public void A_term_must_start_a_word()
    {
        Assert.True(SearchService.StartsWord("esio do pt", "pt"));
        Assert.True(SearchService.StartsWord("andre fernandes de moura", "fern"));
        Assert.False(SearchService.StartsWord("governador dix sept rosado", "pt"));
    }

    [Fact]
    public void Name_terms_keep_particles_only_when_nothing_else_is_left()
    {
        Assert.Equal(["andre", "moura"], SearchService.NameTerms("André de Moura"));
        Assert.Equal(["da"], SearchService.NameTerms("da"));
        Assert.Empty(SearchService.NameTerms("%"));
    }

    [Fact]
    public void A_state_name_alone_does_not_bring_every_municipality_of_the_state()
    {
        var found = SearchService.MatchTerritories(Catalog(), SearchService.Parse("sao paulo")).ToList();
        Assert.Equal(["São Paulo/state", "São Paulo/municipality"], found.Select(t => $"{t.Item.Row.Name}/{t.Item.Row.Kind}"));
        Assert.All(found, t => Assert.Equal(0, t.Rank));
    }

    [Fact]
    public void Places_with_imported_elections_come_first_then_the_best_match()
    {
        var found = SearchService.MatchTerritories(Catalog(), SearchService.Parse("juazeiro")).ToList();
        Assert.Equal(["Juazeiro do Norte", "Juazeiro"], found.Select(t => t.Item.Row.Name));
        Assert.Equal([1, 0], found.Select(t => t.Rank));
    }

    [Fact]
    public void Uf_code_narrows_a_municipality_and_matches_the_state()
    {
        var fortaleza = SearchService.MatchTerritories(Catalog(), SearchService.Parse("fortaleza ce")).ToList();
        Assert.Equal(["Fortaleza"], fortaleza.Select(t => t.Item.Row.Name));
        Assert.Equal(0, fortaleza[0].Rank);

        var ce = SearchService.MatchTerritories(Catalog(), SearchService.Parse("CE")).First();
        Assert.Equal(("state", 0), (ce.Item.Row.Kind, ce.Rank));
        Assert.DoesNotContain(SearchService.MatchTerritories(Catalog(), SearchService.Parse("pt")), t => t.Item.Row.Name.Contains("Dix-Sept"));
    }

    [Fact]
    public void Same_acronym_spelled_differently_is_one_party_with_the_latest_spelling()
    {
        var found = SearchService.MatchParties(Catalog(), SearchService.Parse("pcdob")).ToList();
        var party = Assert.Single(found);
        Assert.Equal(("PCDOB", 145, 2026, 0), (party.Item.Row.Acronym, party.Item.Row.Candidacies, (int)party.Item.Row.Year, party.Rank));
        Assert.Single(SearchService.MatchParties(Catalog(), SearchService.Parse("PC do B")));
    }

    [Fact]
    public void Exact_acronym_comes_before_prefix_and_name_matches()
    {
        Assert.Equal(["PT", "PTB"], SearchService.MatchParties(Catalog(), SearchService.Parse("pt")).Select(p => p.Item.Row.Acronym));
        var byName = SearchService.MatchParties(Catalog(), SearchService.Parse("partido dos trabalhadores")).ToList();
        Assert.Equal([("PT", 0), ("PSTU", 3)], byName.Select(p => (p.Item.Row.Acronym, p.Rank)));
    }

    [Fact]
    public async Task Office_and_year_alone_suggest_the_election_in_each_uf_with_data()
    {
        var repo = new FakeSearchRepository(Catalog());
        var r = await new SearchService(repo).SearchAsync("Deputado Federal 2022", 6, Ct);
        var e = Assert.Single(r.Elections);
        Assert.Equal((2022, 1, "CE", (string?)null, (int?)6), (e.Year, e.Round, e.Uf, e.Municipality, e.OfficeCode));
        Assert.Equal("Deputado Federal · Ceará · Eleições 2022 · 1º turno", e.Label);
        Assert.Empty(repo.PoliticianCalls); // nenhum termo de nome: não busca pessoas
        Assert.Equal([SearchGroups.Elections], r.Order);
    }

    [Fact]
    public async Task Office_place_and_year_suggest_the_municipal_election_and_skip_people_named_after_the_place()
    {
        var repo = new FakeSearchRepository(Catalog());
        var r = await new SearchService(repo).SearchAsync("prefeito fortaleza 2024", 6, Ct);
        Assert.Equal(["Prefeito · Fortaleza · Eleições 2024 · 1º turno", "Prefeito · Fortaleza · Eleições 2024 · 2º turno"],
            r.Elections.Select(e => e.Label));
        Assert.All(r.Elections, e => Assert.Equal(("CE", "fortaleza", 11), (e.Uf, e.Municipality!, e.OfficeCode!.Value)));
        Assert.Empty(repo.PoliticianCalls);
        Assert.Equal([SearchGroups.Elections, SearchGroups.Territories], r.Order);
    }

    [Fact]
    public async Task A_municipality_only_gets_the_rounds_it_had()
    {
        var r = await new SearchService(new FakeSearchRepository(Catalog())).SearchAsync("juazeiro do norte 2024", 6, Ct);
        Assert.Equal([(2024, 1)], r.Elections.Select(e => (e.Year, e.Round)));
    }

    [Fact]
    public async Task A_person_with_a_year_filters_candidacies_and_suggests_no_election()
    {
        var repo = new FakeSearchRepository(Catalog());
        repo.Politicians.Add(new SearchPoliticianRow
        {
            Id = Guid.NewGuid(),
            Name = "Ciro Ferreira Gomes",
            BallotName = "Ciro Gomes",
            Rank = 1,
            Year = 2022,
            Round = 1,
            OfficeCode = 1,
            OfficeName = "PRESIDENTE",
            UnitName = "Brasil",
            PartyAcronym = "PDT",
            Elected = false,
        });
        var r = await new SearchService(repo).SearchAsync("ciro 2022", 6, Ct);
        var call = Assert.Single(repo.PoliticianCalls);
        Assert.Equal(["ciro"], call.Terms);
        Assert.Equal(("ciro", new SearchFilter(2022, null, null)), (call.Text, call.Filter));
        Assert.Empty(r.Elections);
        Assert.Equal("Presidente", r.Politicians.Single().Candidacy!.OfficeName); // nome do cargo pelo código, não em caixa alta
    }

    [Fact]
    public async Task Groups_are_ordered_by_their_best_match()
    {
        var repo = new FakeSearchRepository(Catalog());
        repo.Politicians.Add(new SearchPoliticianRow { Id = Guid.NewGuid(), Name = "Francisco Ésio de Souza", BallotName = "Ésio do PT", Rank = 2 });
        var r = await new SearchService(repo).SearchAsync("PT", 6, Ct);
        Assert.Equal([SearchGroups.Parties, SearchGroups.Politicians], r.Order);
    }

    [Theory]
    [InlineData("x")]
    [InlineData("%")]
    [InlineData("   ")]
    [InlineData("a o")]
    public async Task Queries_too_short_to_mean_anything_touch_nothing(string q)
    {
        var repo = new FakeSearchRepository(Catalog());
        var r = await new SearchService(repo).SearchAsync(q, 6, Ct);
        Assert.Empty(r.Order);
        Assert.Empty(repo.PoliticianCalls);
        Assert.Equal(0, repo.CatalogCalls);
    }

    [Fact]
    public async Task Limit_is_clamped()
    {
        var repo = new FakeSearchRepository(Catalog());
        var r = await new SearchService(repo).SearchAsync("fortaleza", 500, Ct);
        Assert.True(r.Territories.Count <= SearchService.MaxLimit);
    }
}
