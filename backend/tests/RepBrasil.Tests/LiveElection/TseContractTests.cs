using RepBrasil.Application.LiveElection;
using RepBrasil.Application.LiveElection.Tse;

namespace RepBrasil.Tests.LiveElection;

/// <summary>Contrato dos arquivos do TSE: parser tolerante (texto, vírgula, vazio) e construtor central de URLs.</summary>
public sealed class TseContractTests
{
    // Trecho com o formato REAL do EA20 nacional do 2º turno antes da divulgação (valores fictícios).
    private const string PreElection = """
        {"ele": "6258", "t": "2", "f": "o", "sup": "n", "tpabr": "br", "cdabr": "br", "dg": "15/10/2026", "hg": "09:38:12",
         "idg": "3535426", "dt": "", "ht": "", "dv": "s", "tf": "n", "and": "n",
         "carg": [{"cd": "1", "nmn": "Presidente", "nmm": "Presidente", "nmf": "Presidente", "nv": "1",
           "fed": [{"n": "101", "sg": "FED", "nm": "FEDERAÇÃO TESTE", "com": "1-A/2-B", "npar": ["1", "2"]}],
           "agr": [
             {"n": "280001801177", "nm": "PARTIDO X", "tp": "i", "com": "PX", "par": [{"n": "22", "sg": "PX", "nm": "PARTIDO X", "nfed": "", "tvtn": "0", "tvan": "0",
               "cand": [{"n": "22", "sqcand": "280000000002", "nm": "CANDIDATO X", "nmu": "X", "dt": "30/04/1981", "seq": "2", "e": "n", "st": "", "vap": "0", "pvap": "0,00", "pvapn": "0",
                 "vs": [{"tp": "v", "sqcand": "280000000003", "nm": "VICE X", "nmu": "VICE X", "sgp": "PX"}]}]}]},
             {"n": "280001800617", "nm": "COLIGAÇÃO Y", "tp": "c", "com": "PY / PZ", "tvtn": "0", "tvan": "0", "par": [{"n": "13", "sg": "PY", "nm": "PARTIDO Y", "nfed": "101", "tvtn": "0", "tvan": "0",
               "cand": [{"n": "13", "sqcand": "280000000001", "nm": "CANDIDATA Y", "nmu": "Y", "dt": "06/10/1945", "seq": "1", "e": "n", "st": "", "vap": "0", "pvap": "0,00", "pvapn": "0",
                 "vs": [{"tp": "v", "sqcand": "280000000004", "nm": "VICE Y", "nmu": "VICE Y", "sgp": "PZ"}]}]}]}]}],
         "s": {"ts": "499248", "st": "0", "pst": "0,00", "pstn": "0", "snt": "499248", "psnt": "100,00", "psntn": "100", "si": "0", "psi": "0,00", "psin": "0", "sni": "0", "psni": "0,00", "psnin": "0", "sa": "0", "psa": "0,00", "psan": "0", "sna": "0", "psna": "0,00", "psnan": "0"},
         "e": {"te": "158745502", "est": "0", "pest": "0,00", "pestn": "0", "esnt": "158745502", "pesnt": "100,00", "pesntn": "100", "esi": "0", "pesi": "0,00", "pesin": "0", "esni": "0", "pesni": "0,00", "pesnin": "0", "esa": "0", "pesa": "0,00", "pesan": "0", "esna": "0", "pesna": "0,00", "pesnan": "0", "c": "0", "pc": "0,00", "pcn": "0", "a": "0", "pa": "0,00", "pan": "0"},
         "v": {"tv": "0", "vvc": "0", "pvvc": "0,00", "pvvcn": "0,00", "vv": "0", "pvv": "0,00", "pvvn": "0,00", "vnom": "0", "pvnom": "0,00", "pvnomn": "0,00", "van": "0", "pvan": "0,00", "pvann": "0,00", "vansj": "0", "pvansj": "0,00", "pvansjn": "0,00", "vb": "0", "pvb": "0,00", "pvbn": "0,00", "tvn": "0", "ptvn": "0,00", "ptvnn": "0,00", "vn": "0", "pvn": "0,00", "pvnn": "0,00", "vnt": "0", "pvnt": "0,00", "pvntn": "0,00", "vsan": "0", "vscv": "0"}}
        """;

    [Fact]
    public void Real_pre_election_shape_parses_with_empty_times_as_null_and_candidates_in_official_order()
    {
        var r = TseParser.ParseEa20(TseFixtures.Utf8(PreElection), 1);
        Assert.Equal(6258, r.ElectionCode);
        Assert.Equal(2, r.Round);
        Assert.Equal('o', r.Phase);
        Assert.Equal("n", r.Progress);
        Assert.Null(r.TotalizedAt);
        Assert.Null(r.MathematicallyDefined);
        Assert.Equal(new DateTimeOffset(2026, 10, 15, 9, 38, 12, TimeSpan.FromHours(-3)), r.GeneratedAt);
        Assert.Equal(["280000000001", "280000000002"], r.Office.Candidates.Select(c => c.Sqcand));
        var y = r.Office.Candidates[0];
        Assert.Equal("Y", y.BallotName);
        Assert.Equal("c", y.Group.Kind);
        Assert.Equal("PY / PZ", y.Group.Composition);
        Assert.Equal("VICE Y", y.RunningMates.Single().BallotName);
        Assert.Equal(158_745_502, r.Electorate.Total);
        Assert.Equal(499_248, r.Sections.NotTotalized);
        Assert.Equal(0m, r.Sections.TotalizedPct);
    }

    [Fact]
    public void Percentages_keep_the_official_nine_decimals_with_comma()
    {
        var bytes = TseFixtures.Ea20(TseFixtures.AtProgress(0.33333, 0.5123456789));
        var r = TseParser.ParseEa20(bytes, 1);
        var pct = r.Office.Candidates[0].Percent!.Value;
        Assert.Equal(9, BitConverter.GetBytes(decimal.GetBits(pct)[3])[2]);
        Assert.InRange(pct, 51.23m, 51.24m);
    }

    [Theory]
    [InlineData("47,027772356", 47.027772356)]
    [InlineData("100", 100)]
    [InlineData("0,00", 0)]
    [InlineData("1.234,5", 1234.5)]
    [InlineData("99.987654", 99.987654)]
    public void Decimal_strings_accept_comma_and_dot(string text, double expected) =>
        Assert.Equal((decimal)expected, TseValues.ParseDecimal(text, "x"));

    [Fact]
    public void Missing_optional_fields_become_null_never_zero()
    {
        var json = PreElection.Replace("\"v\": {", "\"vx\": {", StringComparison.Ordinal);
        var r = TseParser.ParseEa20(TseFixtures.Utf8(json), 1);
        Assert.Null(r.Votes.Total);
        Assert.Null(r.Votes.Blank);
    }

    [Theory]
    [InlineData("")]
    [InlineData("{not json")]
    [InlineData("[]")]
    public void Invalid_json_is_a_contract_error(string text) =>
        Assert.Throws<TseContractException>(() => TseParser.ParseEa20(TseFixtures.Utf8(text), 1));

    [Fact]
    public void Contract_violations_fail_closed()
    {
        Assert.Throws<TseContractException>(() => TseParser.ParseEa20(TseFixtures.Utf8(PreElection.Replace("\"and\": \"n\"", "\"and\": \"x\"", StringComparison.Ordinal)), 1));
        Assert.Throws<TseContractException>(() => TseParser.ParseEa20(TseFixtures.Utf8(PreElection.Replace("\"vap\": \"0\"", "\"vap\": \"-5\"", StringComparison.Ordinal)), 1));
        Assert.Throws<TseContractException>(() => TseParser.ParseEa20(TseFixtures.Utf8(PreElection.Replace("\"seq\": \"2\"", "\"seq\": \"1\"", StringComparison.Ordinal)), 1));
        Assert.Throws<TseContractException>(() => TseParser.ParseEa20(TseFixtures.Utf8(PreElection), 3));
    }

    [Fact]
    public void Votes_hidden_by_dv_n_become_null_in_the_snapshot()
    {
        var s = TseFixtures.Snapshot(TseFixtures.AtProgress(0.5) with { Dv = "n" });
        Assert.All(s.Candidates, c => Assert.Null(c.Votes));
        Assert.Null(s.Votes.Total);
        Assert.False(s.VotesReleased);
    }

    [Fact]
    public void Accompaniment_files_parse_br_uf_and_mun_entries()
    {
        const string ea15 = """
            {"ele": "6258", "t": "2", "f": "o", "dg": "25/10/2026", "hg": "18:00:00", "idg": "1",
             "abr": [
               {"and": "p", "tpabr": "uf", "cdabr": "ac", "dt": "25/10/2026", "ht": "17:59:00", "munnr": "0", "s": {"ts": "2270", "st": "100", "snt": "2170", "pstn": "4,405286344"}, "e": {"te": "613742", "est": "27000", "esnt": "586742"}},
               {"and": "n", "tpabr": "mun", "cdabr": "01570", "dt": "", "ht": "", "s": {"ts": "28", "st": "0", "snt": "28"}, "e": {"te": "7294", "est": "0", "esnt": "7294"}}
             ]}
            """;
        var f = TseParser.ParseAccompaniment(TseFixtures.Utf8(ea15));
        Assert.Equal(6258, f.ElectionCode);
        Assert.Equal(2, f.Entries.Count);
        Assert.Equal("mun", f.Entries[1].ScopeType);
        Assert.Equal("01570", f.Entries[1].Code);
        Assert.Null(f.Entries[1].TotalizedAt);
        Assert.Equal(4.405286344m, f.Entries[0].Sections.TotalizedPct);
    }

    [Fact]
    public void Ea12_preserves_leading_zeros_capital_flag_and_exterior_without_ibge()
    {
        const string ea12 = """
            {"dg": "15/10/2026", "hg": "09:38:00", "idg": "3531598", "f": "o", "abr": [
              {"cd": "ac", "ds": "ACRE", "mu": [{"cd": "01120", "cdi": "1200013", "nm": "ACRELÂNDIA", "c": "n", "z": ["0008"]}, {"cd": "01392", "cdi": "1200401", "nm": "RIO BRANCO", "c": "s", "z": ["0001", "0009"]}]},
              {"cd": "zz", "ds": "EXTERIOR", "mu": [{"cd": "29254", "cdi": "", "nm": "ABIDJÃ", "c": "n", "z": ["0001"]}]}]}
            """;
        var c = TseParser.ParseEa12(TseFixtures.Utf8(ea12));
        Assert.Equal("01120", c.Ufs[0].Municipalities[0].TseCode);
        Assert.True(c.Ufs[0].Municipalities[1].Capital);
        Assert.Equal(["0001", "0009"], c.Ufs[0].Municipalities[1].Zones);
        Assert.Null(c.Ufs[1].Municipalities[0].IbgeCode);
    }

    [Fact]
    public void Ea11_discovery_finds_second_round_president_and_links_first_round_by_cdt2()
    {
        const string ea11 = """
            {"dg": "18/10/2026", "hg": "12:38:11", "f": "o", "idg": "3715499",
             "arq": [{"tp": "u", "dir": "<base>/<ambiente>/<ciclo>/<cd_eleicao>/dados/<uf>"}],
             "pl": [
               {"cd": "3220", "c": "ele2026", "dt": "04/10/2026", "e": [
                 {"cd": "6257", "cdt2": "6258", "nm": "Federal 1º Turno", "t": "1", "tp": "8", "abr": [{"cd": "br", "cp": [{"cd": "1", "ds": "Presidente", "tp": "1"}]}]},
                 {"cd": "6259", "cdt2": "6260", "nm": "Estadual 1º Turno", "t": "1", "tp": "1", "abr": [{"cd": "br", "cp": [{"cd": "3", "ds": "Governador", "tp": "1"}]}]}]},
               {"cd": "3221", "c": "ele2026", "dt": "25/10/2026", "e": [
                 {"cd": "6260", "cdt2": "", "nm": "Estadual 2º Turno", "t": "2", "tp": "1", "abr": [{"cd": "am", "cp": [{"cd": "3", "ds": "Governador", "tp": "1"}]}]},
                 {"cd": "6258", "cdt2": "", "nm": "Federal 2º Turno", "t": "2", "tp": "8", "abr": [{"cd": "br", "cp": [{"cd": "1", "ds": "Presidente", "tp": "1"}]}]}]}]}
            """;
        var config = TseParser.ParseEa11(TseFixtures.Utf8(ea11));
        var found = ElectionDiscovery.Discover(config, "ele2026", 2, 1, expectedElectionCode: 6258, expectedPleitoCode: 3221);
        Assert.Equal(6258, found.ElectionCode);
        Assert.Equal(3221, found.PleitoCode);
        Assert.Equal(6257, found.FirstRoundElectionCode);
        Assert.Equal(new DateOnly(2026, 10, 25), found.Date);
        Assert.Empty(found.Warnings);

        var divergent = ElectionDiscovery.Discover(config, "ele2026", 2, 1, expectedElectionCode: 9999);
        Assert.Equal(6258, divergent.ElectionCode);
        Assert.Contains(divergent.Warnings, w => w.Contains("vale o EA11", StringComparison.Ordinal));
    }

    [Fact]
    public void Path_builder_pads_codes_and_follows_ea11_templates()
    {
        var p = new TsePathBuilder(TseEnvironment.Official("ele2026"));
        Assert.Equal("https://resultados.tse.jus.br/oficial/comum/config/ele-c.json", p.ElectionConfig().AbsoluteUri);
        Assert.Equal("https://resultados.tse.jus.br/oficial/ele2026/6258/dados/br/br-c0001-e006258-u.json", p.Result(6258, 1).AbsoluteUri);
        Assert.Equal("https://resultados.tse.jus.br/oficial/ele2026/6258/dados/sp/sp-c0001-e006258-u.json", p.Result(6258, 1, "SP").AbsoluteUri);
        Assert.Equal("https://resultados.tse.jus.br/oficial/ele2026/6258/dados/sp/sp71072-c0001-e006258-u.json", p.Result(6258, 1, "sp", "71072").AbsoluteUri);
        Assert.Equal("https://resultados.tse.jus.br/oficial/ele2026/6258/dados/sp/sp71072-z0001-c0001-e006258-u.json", p.Result(6258, 1, "sp", "71072", "0001").AbsoluteUri);
        Assert.Equal("https://resultados.tse.jus.br/oficial/ele2026/6258/dados/br/br-e006258-ab.json", p.Accompaniment(6258).AbsoluteUri);
        Assert.Equal("https://resultados.tse.jus.br/oficial/ele2026/6258/dados/zz/zz-e006258-ab.json", p.Accompaniment(6258, "zz").AbsoluteUri);
        Assert.Equal("https://resultados.tse.jus.br/oficial/ele2026/6258/config/mun-e006258-cm.json", p.MunicipalityConfig(6258).AbsoluteUri);
        Assert.Equal("https://resultados.tse.jus.br/oficial/ele2026/6258/fotos/br/280002542548.jpeg", p.Photo(6258, "br", "280002542548").AbsoluteUri);

        var sim = new TsePathBuilder(TseEnvironment.Simulation("simulado2026", "ele2026"));
        Assert.Equal("https://resultados-sim.tse.jus.br/simulado/simulado2026/ele2026/22410/dados/br/br-c0001-e022410-u.json", sim.Result(22410, 1).AbsoluteUri);
        Assert.Equal("https://resultados-sim.tse.jus.br/simulado/simulado2026/comum/config/ele-c.json", sim.ElectionConfig().AbsoluteUri);
    }

    [Fact]
    public void Path_builder_never_guesses_codes()
    {
        var p = new TsePathBuilder(TseEnvironment.Official("ele2026"));
        Assert.Throws<ArgumentException>(() => p.Result(6258, 1, "sp", "1072"));
        Assert.Throws<ArgumentException>(() => p.Result(6258, 1, "sp", "71072", "1"));
        Assert.Throws<ArgumentException>(() => p.Result(6258, 1, "br"));
        Assert.Throws<ArgumentException>(() => p.Result(6258, 1, null, "71072"));
        Assert.Throws<ArgumentOutOfRangeException>(() => p.Result(1_000_000, 1));
        Assert.Throws<ArgumentException>(() => new TsePathBuilder(new TseEnvironment("https://example.com", "oficial", "ele2026")));
        Assert.Throws<ArgumentException>(() => new TsePathBuilder(new TseEnvironment("http://resultados.tse.jus.br", "oficial", "ele2026")));
        Assert.Throws<ArgumentException>(() => new TsePathBuilder(TseEnvironment.Official("ele2026"), new Dictionary<string, string> { ["u"] = "https://evil/<uf>" }));
    }
}
