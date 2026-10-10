using RepBrasil.Application.Electoral;

namespace RepBrasil.Tests.Electoral;

public class ResultsAssemblerTests
{
    private static UrnOfficeRow Urn(int? turnout, int votesTotal, int? eligible = 100) => new()
    {
        ResultId = 1,
        OfficeCode = 1,
        OfficeName = "Presidente",
        ElectionCode = 6257,
        Section = 381,
        Eligible = eligible,
        Turnout = turnout,
        Abstentions = eligible - turnout,
        VotesTotal = votesTotal,
    };

    private static VoteRow Vote(string kind, int number, int votes, int? party = null) => new()
    {
        VoteKind = kind,
        Number = number,
        Votes = votes,
        Name = $"V{number}",
        PartyNumber = party,
        TypeCode = 1,
        TypeDescription = kind,
    };

    [Fact]
    public void Missing_blank_or_null_is_zero_only_when_the_urn_accounting_closes()
    {
        var votes = new List<VoteRow> { Vote("candidate", 13, 60, 13), Vote("candidate", 22, 30, 22) };

        var closed = ResultsAssembler.Metrics(Urn(turnout: 90, votesTotal: 90), votes);
        Assert.Equal(90, closed.Valid);
        Assert.Equal(0, closed.Blank);
        Assert.Equal(0, closed.Null);

        // Senador: 2 votos por eleitor — soma ≠ comparecimento ⇒ ausência não é zero
        var open = ResultsAssembler.Metrics(Urn(turnout: 90, votesTotal: 170), votes);
        Assert.Equal(90, open.Valid);
        Assert.Null(open.Blank);
        Assert.Null(open.Null);

        // comparecimento não informado ⇒ nada é confirmado
        var unknown = ResultsAssembler.Metrics(Urn(turnout: null, votesTotal: 90, eligible: null), votes);
        Assert.Null(unknown.Eligible);
        Assert.Null(unknown.Turnout);
        Assert.Null(unknown.Blank);
    }

    [Fact]
    public void Unknown_vote_kinds_make_valid_votes_undetermined()
    {
        var votes = new List<VoteRow> { Vote("candidate", 13, 60), Vote("technical_null", 97, 2) };
        Assert.Null(ResultsAssembler.Metrics(Urn(62, 62), votes).Valid);
    }

    [Fact]
    public void Percentages_only_for_nominal_and_legend_over_valid_votes()
    {
        var votes = new List<VoteRow>
        {
            Vote("candidate", 13, 153, 13), Vote("party_legend", 13, 2, 13), Vote("candidate", 22, 128, 22),
            Vote("blank", 95, 5), Vote("null", 96, 13),
        };
        var items = ResultsAssembler.VoteItems(votes, valid: 283);
        Assert.Equal([153, 128, 13, 5, 2], items.Select(i => i.Votes));
        Assert.Equal(54.06, items.Single(i => i.Votable.Number == 13 && i.VoteType == "nominal").Percentage);
        Assert.Null(items.Single(i => i.VoteType == "branco").Percentage);
        Assert.Null(items.Single(i => i.VoteType == "nulo").Percentage);
        Assert.Null(ResultsAssembler.Percentage(10, null));
        Assert.Null(ResultsAssembler.Percentage(10, 0));
    }

    [Fact]
    public void Candidate_link_is_optional_enrichment_and_never_changes_votes()
    {
        var politician = Guid.NewGuid();
        var votes = new List<VoteRow>
        {
            new() { VoteKind = "candidate", Number = 13, Votes = 153, TypeCode = 1, TypeDescription = "Nominal",
                    CandidacyId = Guid.NewGuid(), TseCandidateId = 280001, PersonId = Guid.NewGuid(), PoliticianId = politician },
            new() { VoteKind = "candidate", Number = 22, Votes = 130, TypeCode = 1, TypeDescription = "Nominal" },
        };
        var items = ResultsAssembler.VoteItems(votes, 283);
        var linked = items.Single(i => i.Votable.Number == 13);
        Assert.True(linked.ProfileAvailable);
        Assert.Equal(politician, linked.Candidacy!.PoliticianId);
        var unlinked = items.Single(i => i.Votable.Number == 22);
        Assert.False(unlinked.ProfileAvailable);
        Assert.Null(unlinked.Candidacy);
        Assert.Equal(130, unlinked.Votes);
        Assert.Equal(45.94, unlinked.Percentage);
    }

    [Fact]
    public void Filters_and_available_filters()
    {
        var votes = new List<VoteRow> { Vote("candidate", 13, 10, 13), Vote("party_legend", 22, 3, 22), Vote("blank", 95, 1) };
        Assert.Equal([22], ResultsAssembler.Filter(votes, new ResultFiltersDto(null, null, null, "legenda")).Select(v => v.Number));
        Assert.Equal([13], ResultsAssembler.Filter(votes, new ResultFiltersDto(null, 13, null, null)).Select(v => v.Number));
        Assert.Equal([22], ResultsAssembler.Filter(votes, new ResultFiltersDto(null, null, 22, null)).Select(v => v.Number));
        var available = ResultsAssembler.AvailableFilters(votes);
        Assert.Equal([13], available.Candidates.Select(c => c.Number));
        Assert.Equal([13, 22], available.Parties.Select(p => p.Number));
        Assert.Equal(["nominal", "legenda", "branco"], available.VoteTypes);
        Assert.False(available.Federation.Available);
    }

    [Fact]
    public void Provenance_keeps_only_the_warnings_of_the_urn()
    {
        var batch = new BatchRow
        {
            BatchId = Guid.NewGuid(),
            ZipSha256 = "db72",
            CsvSha256 = "e626",
            OfficialChecksumAlgorithm = "sha512",
            WarningsJson = """[{"code":"polling_place_mismatch","section":381},{"code":"polling_place_mismatch","section":7}]""",
        };
        var p = ResultsAssembler.Provenance(batch, 381);
        Assert.Single(p.Warnings);
        Assert.True(p.OfficialChecksum.Verified);
        Assert.Equal("not_available", p.Validation.Ea20);
    }

    [Theory]
    [InlineData("General Sampaio", "general-sampaio")]
    [InlineData("Juazeiro do Norte", "juazeiro-do-norte")]
    [InlineData("Itapajé", "itapaje")]
    [InlineData("  São João do Jaguaribe ", "sao-joao-do-jaguaribe")]
    public void Slug_matches_the_etl_algorithm(string name, string slug) => Assert.Equal(slug, Slug.From(name));
}
