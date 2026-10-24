using System.Globalization;
using System.Text;
using System.Text.Json;
using RepBrasil.Application.LiveElection;
using RepBrasil.Application.LiveElection.Tse;

namespace RepBrasil.Tests.LiveElection;

/// <summary>
/// Fixtures SINTÉTICAS no formato real dos arquivos do TSE de 2026 (todos os valores como texto, percentuais oficiais com
/// vírgula e 9 casas, "100"/"0" sem casas, dt/ht vazios antes do início). Candidatos fictícios.
/// Cenários: 0%, 5%, 25%, 50%, 75%, 90%, 99%, 100%, troca de liderança, empate, vantagem mínima, limite independente,
/// md=e, tf=s, reprocessamento, candidato anulado/sub judice, seção não instalada e não apurada.
/// </summary>
public static class TseFixtures
{
    public const string A = "990000000001";
    public const string B = "990000000002";
    public const int Election = 9002;

    private static readonly CultureInfo Pt = CultureInfo.GetCultureInfo("pt-BR");

    public sealed record Scenario
    {
        public string Scope { get; init; } = "br";
        public string Code { get; init; } = "br";
        public long Electorate { get; init; } = 1_000_000;
        public long Sections { get; init; } = 3_000;
        public long SectionsTotalized { get; init; }
        public long SectionsNotInstalled { get; init; }
        public long SectionsNotCounted { get; init; }
        public long ElectorateNotInstalled { get; init; }
        public long ElectorateNotCounted { get; init; }
        public long VotesA { get; init; }
        public long VotesB { get; init; }
        public long Blank { get; init; }
        public long Null { get; init; }
        public long TechnicalNull { get; init; }
        public long Annulled { get; init; }
        public long AnnulledSubJudice { get; init; }
        public string? Md { get; init; }
        public string Tf { get; init; } = "n";
        public string Dv { get; init; } = "s";
        public string? Mntf { get; init; }
        public string? DestinationB { get; init; } = "Válido";
        public string Phase { get; init; } = "o";
        public int ElectionCode { get; init; } = Election;
        public string GeneratedAt { get; init; } = "25/10/2026 18:00:05";
        public string? TotalizedAt { get; init; } = "25/10/2026 18:00:00";
        public long Idg { get; init; } = 1;
        public string? And { get; init; }
    }

    private static string N(long v) => v.ToString(CultureInfo.InvariantCulture);

    private static string P2(long part, long whole) => whole <= 0 ? "0,00" : (part * 100m / whole).ToString("0.00", Pt);

    private static string P9(long part, long whole)
    {
        if (whole <= 0 || part == 0) return "0";
        if (part == whole) return "100";
        return (part * 100m / whole).ToString("0.000000000", Pt);
    }

    /// <summary>Eleitorado de seções totalizadas proporcional às seções totalizadas; comparecimento = votos.</summary>
    public static byte[] Ea20(Scenario s)
    {
        var est = s.Sections == 0 ? 0 : s.SectionsTotalized == s.Sections ? s.Electorate : s.Electorate * s.SectionsTotalized / s.Sections;
        var esi = est - s.ElectorateNotInstalled;
        var esa = esi - s.ElectorateNotCounted;
        var vv = s.VotesA + s.VotesB - (s.DestinationB == "Anulado" ? s.VotesB : 0) - (s.DestinationB == "Anulado sub judice" ? s.VotesB : 0);
        var van = s.DestinationB == "Anulado" ? s.VotesB : s.Annulled;
        var vansj = s.DestinationB == "Anulado sub judice" ? s.VotesB : s.AnnulledSubJudice;
        var vvc = s.VotesA + s.VotesB;
        var tvn = s.Null + s.TechnicalNull;
        var tv = vv + van + vansj + s.Blank + tvn;
        var c = tv;
        var a = esi - c;
        var si = s.SectionsTotalized - s.SectionsNotInstalled;
        var sa = si - s.SectionsNotCounted;
        var and = s.And ?? (s.SectionsTotalized == 0 ? "n" : s.Tf == "s" ? "f" : "p");
        var (dg, hg) = Split(s.GeneratedAt);
        var (dt, ht) = s.SectionsTotalized == 0 || s.TotalizedAt is null ? ("", "") : Split(s.TotalizedAt);
        var final = s.Tf == "s";
        var aWins = s.VotesA > s.VotesB;
        var root = new Dictionary<string, object?>
        {
            ["ele"] = N(s.ElectionCode),
            ["t"] = "2",
            ["f"] = s.Phase,
            ["sup"] = "n",
            ["tpabr"] = s.Scope,
            ["cdabr"] = s.Code,
            ["dg"] = dg,
            ["hg"] = hg,
            ["idg"] = N(s.Idg),
            ["dt"] = dt,
            ["ht"] = ht,
            ["dv"] = s.Dv,
            ["tf"] = s.Tf,
            ["and"] = and,
        };
        if (s.Md is not null) root["md"] = s.Md;
        if (s.Mntf is not null) root["mntf"] = s.Mntf;
        if (final)
        {
            root["esae"] = "n";
            root["mnae"] = Array.Empty<string>();
        }
        var showA = s.Dv == "s" ? s.VotesA : 0;
        var showB = s.Dv == "s" ? s.VotesB : 0;
        root["carg"] = new[]
        {
            new
            {
                cd = "1", nmn = "Presidente", nmm = "Presidente", nmf = "Presidenta", nv = "1", fed = Array.Empty<object>(),
                agr = new object[]
                {
                    new { n = "990001", nm = "COLIGAÇÃO TESTE A", tp = "c", com = "PTA / PTC", tvtn = "0", tvan = "0", par = new[] { new { n = "91", sg = "PTA", nm = "PARTIDO TESTE A", nfed = "", tvtn = "0", tvan = "0", cand = new[] { Candidate(A, "10", "CANDIDATA TESTE A", "TESTE A", "1", showA, vvc, final, aWins, "Válido") } } } },
                    new { n = "990002", nm = "PARTIDO TESTE B", tp = "i", com = "PTB", tvtn = "0", tvan = "0", par = new[] { new { n = "92", sg = "PTB", nm = "PARTIDO TESTE B", nfed = "", tvtn = "0", tvan = "0", cand = new[] { Candidate(B, "20", "CANDIDATO TESTE B", "TESTE B", "2", showB, vvc, final, !aWins, s.DestinationB) } } } },
                },
            },
        };
        root["s"] = new Dictionary<string, string>
        {
            ["ts"] = N(s.Sections),
            ["st"] = N(s.SectionsTotalized),
            ["pst"] = P2(s.SectionsTotalized, s.Sections),
            ["pstn"] = P9(s.SectionsTotalized, s.Sections),
            ["snt"] = N(s.Sections - s.SectionsTotalized),
            ["psnt"] = P2(s.Sections - s.SectionsTotalized, s.Sections),
            ["psntn"] = P9(s.Sections - s.SectionsTotalized, s.Sections),
            ["si"] = N(si),
            ["psi"] = P2(si, s.SectionsTotalized),
            ["psin"] = P9(si, s.SectionsTotalized),
            ["sni"] = N(s.SectionsNotInstalled),
            ["psni"] = P2(s.SectionsNotInstalled, s.SectionsTotalized),
            ["psnin"] = P9(s.SectionsNotInstalled, s.SectionsTotalized),
            ["sa"] = N(sa),
            ["psa"] = P2(sa, si),
            ["psan"] = P9(sa, si),
            ["sna"] = N(s.SectionsNotCounted),
            ["psna"] = P2(s.SectionsNotCounted, si),
            ["psnan"] = P9(s.SectionsNotCounted, si),
        };
        root["e"] = new Dictionary<string, string>
        {
            ["te"] = N(s.Electorate),
            ["est"] = N(est),
            ["pest"] = P2(est, s.Electorate),
            ["pestn"] = P9(est, s.Electorate),
            ["esnt"] = N(s.Electorate - est),
            ["pesnt"] = P2(s.Electorate - est, s.Electorate),
            ["pesntn"] = P9(s.Electorate - est, s.Electorate),
            ["esi"] = N(esi),
            ["pesi"] = P2(esi, est),
            ["pesin"] = P9(esi, est),
            ["esni"] = N(s.ElectorateNotInstalled),
            ["pesni"] = P2(s.ElectorateNotInstalled, est),
            ["pesnin"] = P9(s.ElectorateNotInstalled, est),
            ["esa"] = N(esa),
            ["pesa"] = P2(esa, esi),
            ["pesan"] = P9(esa, esi),
            ["esna"] = N(s.ElectorateNotCounted),
            ["pesna"] = P2(s.ElectorateNotCounted, esi),
            ["pesnan"] = P9(s.ElectorateNotCounted, esi),
            ["c"] = N(c),
            ["pc"] = P2(c, esi),
            ["pcn"] = P9(c, esi),
            ["a"] = N(a),
            ["pa"] = P2(a, esi),
            ["pan"] = P9(a, esi),
        };
        root["v"] = new Dictionary<string, string>
        {
            ["tv"] = N(tv),
            ["vvc"] = N(vvc),
            ["pvvc"] = P2(vvc, tv),
            ["pvvcn"] = P9(vvc, tv),
            ["vv"] = N(vv),
            ["pvv"] = P2(vv, vvc),
            ["pvvn"] = P9(vv, vvc),
            ["vnom"] = N(vv),
            ["pvnom"] = P2(vv, vv),
            ["pvnomn"] = P9(vv, vv),
            ["van"] = N(van),
            ["pvan"] = P2(van, vvc),
            ["pvann"] = P9(van, vvc),
            ["vansj"] = N(vansj),
            ["pvansj"] = P2(vansj, vvc),
            ["pvansjn"] = P9(vansj, vvc),
            ["vb"] = N(s.Blank),
            ["pvb"] = P2(s.Blank, tv),
            ["pvbn"] = P9(s.Blank, tv),
            ["tvn"] = N(tvn),
            ["ptvn"] = P2(tvn, tv),
            ["ptvnn"] = P9(tvn, tv),
            ["vn"] = N(s.Null),
            ["pvn"] = P2(s.Null, tvn),
            ["pvnn"] = P9(s.Null, tvn),
            ["vnt"] = N(s.TechnicalNull),
            ["pvnt"] = P2(s.TechnicalNull, tvn),
            ["pvntn"] = P9(s.TechnicalNull, tvn),
            ["vsan"] = "0",
            ["vscv"] = "0",
        };
        return JsonSerializer.SerializeToUtf8Bytes(root);
    }

    private static object Candidate(string sqcand, string n, string nm, string nmu, string seq, long votes, long vvc, bool final, bool winner, string? dvt) => new
    {
        n,
        sqcand,
        nm,
        nmu,
        dt = "01/01/1970",
        dvt = dvt ?? "",
        seq,
        e = final && winner ? "s" : "n",
        st = final ? (winner ? "Eleito" : "Não eleito") : "",
        vap = N(votes),
        pvap = P2(votes, vvc),
        pvapn = P9(votes, vvc),
        vs = new[] { new { tp = "v", sqcand = sqcand + "9", nm = "VICE TESTE", nmu = "VICE TESTE", sgp = "PT" } },
    };

    private static (string, string) Split(string stamp)
    {
        var parts = stamp.Split(' ');
        return (parts[0], parts[1]);
    }

    /// <summary>Apuração em p% das seções com A à frente por <paramref name="leadShare"/> dos válidos.</summary>
    public static Scenario AtProgress(double progress, double shareA = 0.52, long electorate = 1_000_000, long sections = 3_000)
    {
        var totalized = (long)Math.Round(sections * progress);
        var est = totalized == sections ? electorate : electorate * totalized / sections;
        var turnout = (long)Math.Round(est * 0.8);
        var blank = turnout / 50;
        var nulls = turnout / 30;
        var valid = turnout - blank - nulls;
        var a = (long)Math.Round(valid * shareA);
        return new Scenario { Electorate = electorate, Sections = sections, SectionsTotalized = totalized, VotesA = a, VotesB = valid - a, Blank = blank, Null = nulls };
    }

    public static TerritorySnapshot Snapshot(Scenario s, DateTimeOffset? ingestedAt = null)
    {
        var bytes = Ea20(s);
        var parsed = TseParser.ParseEa20(bytes, 1);
        var key = s.Scope switch
        {
            "uf" => TerritoryKey.State(s.Code),
            "mu" => TerritoryKey.Municipality(s.Code),
            _ => TerritoryKey.National,
        };
        return TerritorySnapshot.From(parsed, key, s.Scope == "br" ? null : s.Code, ingestedAt ?? new DateTimeOffset(2026, 10, 25, 21, 0, 0, TimeSpan.Zero), bytes, "\"etag\"", null);
    }

    public static byte[] Utf8(string json) => Encoding.UTF8.GetBytes(json);
}
