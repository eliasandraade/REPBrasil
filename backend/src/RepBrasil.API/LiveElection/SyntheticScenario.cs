using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using RepBrasil.Application.LiveElection.Tse;

namespace RepBrasil.API.LiveElection;

/// <summary>
/// Apuração SINTÉTICA para o modo replay (QA, demonstração, testes de ponta a ponta). Gera arquivos no formato exato dos
/// arquivos do TSE (todos os valores como texto, percentuais com vírgula, dt/ht vazios antes do início) para um
/// cenário determinístico: B à frente no começo, troca de liderança, limite matemático do REPBrasil atingido, sinal md=e
/// do "TSE" dois quadros depois e totalização final no fim. Candidatos e municípios são fictícios. Nunca é usado nos
/// modos official/simulation.
/// </summary>
public sealed class SyntheticScenario
{
    public const int SecondRound = 9002;
    public const int FirstRound = 9001;
    public const int Pleito = 9102;
    public const string SqcandA = "990000000001";
    public const string SqcandB = "990000000002";

    private static readonly CultureInfo Pt = CultureInfo.GetCultureInfo("pt-BR");

    // Eleitorado aproximado por UF (milhares) e inclinação para A (fração dos válidos). Fictício na proporção do real.
    private static readonly (string Uf, int Thousands, double LeanA, int Delay, int Duration)[] Ufs =
    [
        ("ac", 600, 0.38, 2, 40), ("al", 2400, 0.62, 10, 70), ("am", 2700, 0.47, 6, 80), ("ap", 550, 0.45, 4, 50),
        ("ba", 11300, 0.68, 12, 85), ("ce", 6800, 0.66, 9, 75), ("df", 2200, 0.41, 1, 35), ("es", 2900, 0.44, 3, 45),
        ("go", 4900, 0.40, 2, 50), ("ma", 4900, 0.67, 14, 90), ("mg", 16300, 0.51, 5, 70), ("ms", 2000, 0.39, 1, 40),
        ("mt", 2500, 0.36, 1, 45), ("pa", 6100, 0.55, 10, 85), ("pb", 3100, 0.63, 9, 70), ("pe", 7000, 0.65, 8, 70),
        ("pi", 2600, 0.69, 11, 75), ("pr", 8500, 0.38, 1, 45), ("rj", 12800, 0.46, 4, 60), ("rn", 2600, 0.60, 8, 65),
        ("ro", 1300, 0.34, 2, 40), ("rr", 380, 0.33, 3, 35), ("rs", 8600, 0.43, 1, 50), ("sc", 5600, 0.34, 1, 40),
        ("se", 1700, 0.61, 9, 60), ("sp", 34400, 0.45, 3, 65), ("to", 1100, 0.52, 6, 50), ("zz", 900, 0.48, 15, 60),
    ];

    private static readonly Dictionary<string, string> Capitals = new()
    {
        ["ac"] = "RIO BRANCO",
        ["al"] = "MACEIÓ",
        ["am"] = "MANAUS",
        ["ap"] = "MACAPÁ",
        ["ba"] = "SALVADOR",
        ["ce"] = "FORTALEZA",
        ["df"] = "BRASÍLIA",
        ["es"] = "VITÓRIA",
        ["go"] = "GOIÂNIA",
        ["ma"] = "SÃO LUÍS",
        ["mg"] = "BELO HORIZONTE",
        ["ms"] = "CAMPO GRANDE",
        ["mt"] = "CUIABÁ",
        ["pa"] = "BELÉM",
        ["pb"] = "JOÃO PESSOA",
        ["pe"] = "RECIFE",
        ["pi"] = "TERESINA",
        ["pr"] = "CURITIBA",
        ["rj"] = "RIO DE JANEIRO",
        ["rn"] = "NATAL",
        ["ro"] = "PORTO VELHO",
        ["rr"] = "BOA VISTA",
        ["rs"] = "PORTO ALEGRE",
        ["sc"] = "FLORIANÓPOLIS",
        ["se"] = "ARACAJU",
        ["sp"] = "SÃO PAULO",
        ["to"] = "PALMAS",
    };

    private readonly DateTimeOffset start;
    private readonly int lastCountingFrame;
    private readonly int finalFrame;
    private readonly int? thresholdFrame;
    private readonly Dictionary<string, Territory> municipalitiesByCode = new(StringComparer.Ordinal);
    private readonly Dictionary<string, List<Territory>> municipalitiesByUf = new(StringComparer.Ordinal);

    /// <param name="start">Horário (Brasília) do quadro 0, antes da divulgação.</param>
    /// <param name="step">Intervalo de tempo "oficial" entre quadros.</param>
    public SyntheticScenario(DateTimeOffset start, TimeSpan step)
    {
        this.start = start.ToOffset(TseValues.BrasiliaOffset);
        Step = step;
        var index = 0;
        foreach (var (uf, thousands, lean, _, _) in Ufs)
        {
            var list = new List<Territory>();
            var count = uf is "df" ? 1 : uf is "zz" ? 3 : 4;
            for (var i = 0; i < count; i++)
            {
                var code = (90000 + index * 10 + i).ToString("D5", CultureInfo.InvariantCulture);
                var capital = i == 0 && uf != "zz";
                var weight = count == 1 ? 1.0 : capital ? 0.4 : 0.6 / (count - 1);
                var name = capital ? Capitals[uf] : uf == "zz" ? $"CIDADE EXTERIOR {i + 1}" : $"MUNICÍPIO FICTÍCIO {i + 1} ({uf.ToUpperInvariant()})";
                var t = new Territory(uf, code, name, capital, (long)(thousands * 1000 * weight), lean + (capital ? 0.03 : -0.01 * i));
                list.Add(t);
                municipalitiesByCode[code] = t;
            }
            municipalitiesByUf[uf] = list;
            index++;
        }
        lastCountingFrame = Ufs.Max(u => u.Delay + u.Duration);
        finalFrame = lastCountingFrame + 2;
        thresholdFrame = Enumerable.Range(0, lastCountingFrame + 1).Cast<int?>().FirstOrDefault(f => IndependentlyIrreversible(f!.Value));
    }

    public TimeSpan Step { get; }

    public int FinalFrame => finalFrame;

    public int? ThresholdFrame => thresholdFrame;

    public int? OfficialDefinitionFrame => thresholdFrame + 2 < finalFrame ? thresholdFrame + 2 : null;

    private sealed record Territory(string Uf, string Code, string Name, bool Capital, long Electorate, double LeanA);

    private sealed record Counts(
        long Ts, long St, long Sni, long Te, long Est, long Esni, long C, long Vb, long Vn, long Vnt, long A, long B)
    {
        public long Snt => Ts - St;
        public long Si => St - Sni;
        public long Esnt => Te - Est;
        public long Esi => Est - Esni;
        public long Abst => Esi - C;
        public long Vv => A + B;
        public long Tv => C;

        public static Counts operator +(Counts x, Counts y) =>
            new(x.Ts + y.Ts, x.St + y.St, x.Sni + y.Sni, x.Te + y.Te, x.Est + y.Est, x.Esni + y.Esni, x.C + y.C, x.Vb + y.Vb, x.Vn + y.Vn, x.Vnt + y.Vnt, x.A + y.A, x.B + y.B);

        public static readonly Counts Zero = new(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }

    // ------------------------------------------------------------------ modelo

    private static double Fraction(string uf, int frame)
    {
        var u = Ufs.First(x => x.Uf == uf);
        var p = Math.Clamp((frame - u.Delay) / (double)u.Duration, 0, 1);
        return p <= 0 ? 0 : p >= 1 ? 1 : 1 - Math.Pow(1 - p, 1.6);
    }

    private static Counts CountsOf(long electorate, double lean, double p, int roundBias)
    {
        var ts = Math.Max(1, electorate / 320);
        var st = (long)Math.Floor(ts * p);
        var sni = st / 9000;
        var est = st == ts ? electorate : (long)Math.Floor(electorate * (st / (double)ts));
        var esni = st == 0 ? 0 : est * sni / Math.Max(1, st);
        var esi = est - esni;
        var c = (long)Math.Round(esi * 0.79);
        var vb = (long)Math.Round(c * 0.021);
        var vnt = (long)Math.Round(c * 0.0004);
        var vn = (long)Math.Round(c * 0.032);
        var vv = c - vb - vn - vnt;
        // Leve deriva da inclinação ao longo da apuração (seções urbanas primeiro).
        var share = Math.Clamp(lean + (p - 0.5) * 0.04 + roundBias * 0.0, 0.05, 0.95);
        var a = (long)Math.Round(vv * share);
        return new Counts(ts, st, sni, electorate, est, esni, c, vb, vn, vnt, a, vv - a);
    }

    private Counts UfCounts(string uf, int frame)
    {
        var p = Fraction(uf, Math.Min(frame, lastCountingFrame));
        return municipalitiesByUf[uf].Select(m => CountsOf(m.Electorate, m.LeanA, p, 0)).Aggregate(Counts.Zero, (x, y) => x + y);
    }

    private Counts NationalCounts(int frame) => Ufs.Select(u => UfCounts(u.Uf, frame)).Aggregate(Counts.Zero, (x, y) => x + y);

    private bool IndependentlyIrreversible(int frame)
    {
        var n = NationalCounts(frame);
        if (n.St == 0) return false;
        var lead = Math.Abs(n.A - n.B);
        return lead > n.Esnt; // esna = 0 no cenário
    }

    private DateTimeOffset FrameTime(int frame) => start + Step * frame;

    private int LastChange(string? uf, int frame)
    {
        if (frame <= 0) return 0;
        var f = Math.Min(frame, lastCountingFrame);
        if (uf is null) return f;
        var p = Fraction(uf, f);
        while (f > 0 && Math.Abs(Fraction(uf, f - 1) - p) < 1e-12) f--;
        return f;
    }

    // ------------------------------------------------------------------ arquivos

    /// <summary>Conteúdo do arquivo pedido no quadro <paramref name="frame"/>; null = não existe (404).</summary>
    public byte[]? File(string path, int frame)
    {
        var name = path[(path.LastIndexOf('/') + 1)..];
        if (name == "ele-c.json") return Ea11();
        if (name == $"mun-e{SecondRound:D6}-cm.json" || name == $"mun-e{FirstRound:D6}-cm.json") return Ea12();
        if (name == $"br-e{SecondRound:D6}-ab.json") return Ea14(frame);
        if (name.EndsWith($"-e{SecondRound:D6}-ab.json", StringComparison.Ordinal)) return Ea15(name[..2], frame);
        var isSecond = name.EndsWith($"-e{SecondRound:D6}-u.json", StringComparison.Ordinal);
        var isFirst = name.EndsWith($"-e{FirstRound:D6}-u.json", StringComparison.Ordinal);
        if (!isSecond && !isFirst) return null;
        var prefix = name[..name.IndexOf("-c", StringComparison.Ordinal)];
        if (!name.Contains("-c0001-", StringComparison.Ordinal)) return null;
        if (prefix == "br") return isSecond ? Result("br", "br", null, NationalCounts(frame), frame, null) : FirstRoundResult("br", "br", NationalCounts(lastCountingFrame), 0.0);
        var uf = prefix[..2];
        if (!municipalitiesByUf.ContainsKey(uf)) return null;
        if (prefix.Length == 2)
            return isSecond ? Result("uf", uf, uf, UfCounts(uf, frame), frame, uf) : FirstRoundResult("uf", uf, UfCounts(uf, lastCountingFrame), Ufs.First(u => u.Uf == uf).LeanA);
        var code = prefix.Substring(2, 5);
        if (!municipalitiesByCode.TryGetValue(code, out var m) || m.Uf != uf) return null;
        var p = Fraction(uf, Math.Min(frame, lastCountingFrame));
        var counts = CountsOf(m.Electorate, m.LeanA, isSecond ? p : 1, 0);
        var zoneMarker = prefix.IndexOf("-z", StringComparison.Ordinal);
        if (zoneMarker > 0)
        {
            if (!isSecond) return null;
            var zone = prefix[(zoneMarker + 2)..];
            var half = !m.Capital ? (zone == "0001" ? counts : null) : zone == "0001" ? CountsOf(m.Electorate / 2, m.LeanA, p, 0) : zone == "0002" ? CountsOf(m.Electorate - m.Electorate / 2, m.LeanA, p, 0) : null;
            return half is null ? null : Result("zona", zone, uf, half, frame, uf);
        }
        return isSecond ? Result("mu", code, uf, counts, frame, uf) : FirstRoundResult("mu", code, counts, m.LeanA);
    }

    public static string ETagOf(byte[] content) => $"\"{Convert.ToHexString(MD5.HashData(content)).ToLowerInvariant()}\"";

    private static string N(long v) => v.ToString(CultureInfo.InvariantCulture);

    private static string P2(long part, long whole) => whole <= 0 ? "0,00" : (part * 100m / whole).ToString("0.00", Pt);

    private static string P9(long part, long whole)
    {
        if (whole <= 0 || part == 0) return "0";
        if (part == whole) return "100";
        return (part * 100m / whole).ToString("0.000000000", Pt);
    }

    private static (string D, string H) Stamp(DateTimeOffset t) =>
        (t.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture), t.ToString("HH:mm:ss", CultureInfo.InvariantCulture));

    private byte[] Ea11()
    {
        var (d, h) = Stamp(start);
        var date = start.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);
        return JsonSerializer.SerializeToUtf8Bytes(new Dictionary<string, object?>
        {
            ["dg"] = d,
            ["hg"] = h,
            ["f"] = "s",
            ["idg"] = "1",
            ["arq"] = TsePathBuilder.DocumentedTemplates.Select(kv => new { tp = kv.Key, dir = kv.Value }).ToArray(),
            ["pl"] = new object[]
            {
                new { cd = "9101", cdpr = "9100", c = "ele2026", dt = date, dtlim = date, e = new object[] { Election(FirstRound, SecondRound, "1", "Eleição Sintética Federal - 1º Turno") } },
                new { cd = N(Pleito), cdpr = "9100", c = "ele2026", dt = date, dtlim = date, e = new object[] { Election(SecondRound, null, "2", "Eleição Sintética Federal - 2º Turno") } },
            },
        });
    }

    private static object Election(int code, int? second, string turn, string name) => new
    {
        cd = N(code),
        cdt2 = second is null ? "" : N(second.Value),
        sqele = "",
        nm = name,
        t = turn,
        tp = "8",
        abr = new[] { new { cd = "br", cp = new[] { new { cd = "1", ds = "Presidente", tp = "1" } } } },
    };

    private byte[] Ea12()
    {
        var (d, h) = Stamp(start);
        return JsonSerializer.SerializeToUtf8Bytes(new
        {
            dg = d,
            hg = h,
            idg = "2",
            f = "s",
            abr = Ufs.Select(u => new
            {
                cd = u.Uf,
                ds = Application.LiveElection.Regions.NameOfUf(u.Uf).ToUpperInvariant(),
                mu = municipalitiesByUf[u.Uf].Select(m => new
                {
                    cd = m.Code,
                    cdi = u.Uf == "zz" ? "" : "99" + m.Code,
                    nm = m.Name,
                    c = m.Capital ? "s" : "n",
                    z = m.Capital ? new[] { "0001", "0002" } : new[] { "0001" },
                }).ToArray(),
            }).ToArray(),
        });
    }

    private static Dictionary<string, string> Sections(Counts c) => new()
    {
        ["ts"] = N(c.Ts),
        ["st"] = N(c.St),
        ["pst"] = P2(c.St, c.Ts),
        ["pstn"] = P9(c.St, c.Ts),
        ["snt"] = N(c.Snt),
        ["psnt"] = P2(c.Snt, c.Ts),
        ["psntn"] = P9(c.Snt, c.Ts),
        ["si"] = N(c.Si),
        ["psi"] = P2(c.Si, c.St),
        ["psin"] = P9(c.Si, c.St),
        ["sni"] = N(c.Sni),
        ["psni"] = P2(c.Sni, c.St),
        ["psnin"] = P9(c.Sni, c.St),
        ["sa"] = N(c.Si),
        ["psa"] = P2(c.Si, c.Si),
        ["psan"] = P9(c.Si, c.Si),
        ["sna"] = "0",
        ["psna"] = "0,00",
        ["psnan"] = "0",
    };

    private static Dictionary<string, string> Electorate(Counts c) => new()
    {
        ["te"] = N(c.Te),
        ["est"] = N(c.Est),
        ["pest"] = P2(c.Est, c.Te),
        ["pestn"] = P9(c.Est, c.Te),
        ["esnt"] = N(c.Esnt),
        ["pesnt"] = P2(c.Esnt, c.Te),
        ["pesntn"] = P9(c.Esnt, c.Te),
        ["esi"] = N(c.Esi),
        ["pesi"] = P2(c.Esi, c.Est),
        ["pesin"] = P9(c.Esi, c.Est),
        ["esni"] = N(c.Esni),
        ["pesni"] = P2(c.Esni, c.Est),
        ["pesnin"] = P9(c.Esni, c.Est),
        ["esa"] = N(c.Esi),
        ["pesa"] = P2(c.Esi, c.Esi),
        ["pesan"] = P9(c.Esi, c.Esi),
        ["esna"] = "0",
        ["pesna"] = "0,00",
        ["pesnan"] = "0",
        ["c"] = N(c.C),
        ["pc"] = P2(c.C, c.Esi),
        ["pcn"] = P9(c.C, c.Esi),
        ["a"] = N(c.Abst),
        ["pa"] = P2(c.Abst, c.Esi),
        ["pan"] = P9(c.Abst, c.Esi),
    };

    private static Dictionary<string, string> Votes(Counts c) => new()
    {
        ["tv"] = N(c.Tv),
        ["vvc"] = N(c.Vv),
        ["pvvc"] = P2(c.Vv, c.Tv),
        ["pvvcn"] = P9(c.Vv, c.Tv),
        ["vv"] = N(c.Vv),
        ["pvv"] = P2(c.Vv, c.Vv),
        ["pvvn"] = P9(c.Vv, c.Vv),
        ["vnom"] = N(c.Vv),
        ["pvnom"] = P2(c.Vv, c.Vv),
        ["pvnomn"] = P9(c.Vv, c.Vv),
        ["van"] = "0",
        ["pvan"] = "0,00",
        ["pvann"] = "0",
        ["vansj"] = "0",
        ["pvansj"] = "0,00",
        ["pvansjn"] = "0",
        ["vb"] = N(c.Vb),
        ["pvb"] = P2(c.Vb, c.Tv),
        ["pvbn"] = P9(c.Vb, c.Tv),
        ["tvn"] = N(c.Vn + c.Vnt),
        ["ptvn"] = P2(c.Vn + c.Vnt, c.Tv),
        ["ptvnn"] = P9(c.Vn + c.Vnt, c.Tv),
        ["vn"] = N(c.Vn),
        ["pvn"] = P2(c.Vn, c.Vn + c.Vnt),
        ["pvnn"] = P9(c.Vn, c.Vn + c.Vnt),
        ["vnt"] = N(c.Vnt),
        ["pvnt"] = P2(c.Vnt, c.Vn + c.Vnt),
        ["pvntn"] = P9(c.Vnt, c.Vn + c.Vnt),
        ["vsan"] = "0",
        ["vscv"] = "0",
    };

    private byte[] Ea14(int frame)
    {
        var (d, h) = Stamp(FrameTime(frame));
        var entries = Ufs.Select(u => Accompaniment("uf", u.Uf, UfCounts(u.Uf, frame), LastChange(u.Uf, frame), Fraction(u.Uf, Math.Min(frame, lastCountingFrame)))).ToList();
        var n = NationalCounts(frame);
        entries.Add(Accompaniment("br", "br", n, LastChange(null, frame), n.Ts == n.St ? 1 : n.St / (double)Math.Max(1, n.Ts), frame >= finalFrame));
        return JsonSerializer.SerializeToUtf8Bytes(new Dictionary<string, object?> { ["ele"] = N(SecondRound), ["t"] = "2", ["f"] = "s", ["dg"] = d, ["hg"] = h, ["idg"] = N(10_000 + frame), ["abr"] = entries });
    }

    private byte[] Ea15(string uf, int frame)
    {
        if (!municipalitiesByUf.TryGetValue(uf, out var list)) return [];
        var (d, h) = Stamp(FrameTime(frame));
        var p = Fraction(uf, Math.Min(frame, lastCountingFrame));
        var entries = new List<Dictionary<string, object?>> { Accompaniment("uf", uf, UfCounts(uf, frame), LastChange(uf, frame), p) };
        entries.AddRange(list.Select(m => Accompaniment("mun", m.Code, CountsOf(m.Electorate, m.LeanA, p, 0), LastChange(uf, frame), p)));
        return JsonSerializer.SerializeToUtf8Bytes(new Dictionary<string, object?> { ["ele"] = N(SecondRound), ["t"] = "2", ["f"] = "s", ["dg"] = d, ["hg"] = h, ["idg"] = N(20_000 + frame), ["abr"] = entries });
    }

    private Dictionary<string, object?> Accompaniment(string type, string code, Counts c, int changedFrame, double p, bool final = false)
    {
        var started = c.St > 0;
        var (d, h) = started ? Stamp(FrameTime(changedFrame)) : ("", "");
        return new Dictionary<string, object?>
        {
            ["and"] = !started ? "n" : (type == "br" ? final : c.Snt == 0) ? "f" : "p",
            ["tpabr"] = type,
            ["cdabr"] = code,
            ["dt"] = d,
            ["ht"] = h,
            ["s"] = Sections(c),
            ["e"] = Electorate(c),
        };
    }

    private byte[] Result(string type, string code, string? uf, Counts c, int frame, string? ufForTime)
    {
        var national = type == "br";
        var final = national ? frame >= finalFrame : c.Snt == 0 && frame >= finalFrame;
        var md = national && OfficialDefinitionFrame is { } md0 && frame >= md0 && !final ? "e" : null;
        var started = c.St > 0;
        var (dg, hg) = Stamp(FrameTime(frame));
        var (dt, ht) = started ? Stamp(FrameTime(LastChange(ufForTime, frame))) : ("", "");
        var winnerA = c.A > c.B;
        var root = new Dictionary<string, object?>
        {
            ["ele"] = N(SecondRound),
            ["t"] = "2",
            ["f"] = "s",
            ["sup"] = "n",
            ["tpabr"] = type,
            ["cdabr"] = code,
            ["dg"] = dg,
            ["hg"] = hg,
            ["idg"] = N(100_000 + frame),
            ["dt"] = dt,
            ["ht"] = ht,
            ["dv"] = "s",
            ["tf"] = final ? "s" : "n",
            ["and"] = !started ? "n" : final || (!national && c.Snt == 0) ? "f" : "p",
        };
        if (md is not null) root["md"] = md;
        if (final)
        {
            root["esae"] = "n";
            root["mnae"] = Array.Empty<string>();
        }
        root["carg"] = new[]
        {
            new
            {
                cd = "1", nmn = "Presidente", nmm = "Presidente", nmf = "Presidenta", nv = "1",
                fed = Array.Empty<object>(),
                agr = new object[]
                {
                    Group("990001", "COLIGAÇÃO FICTÍCIA A", "c", "PFA / PFC", Party("91", "PFA", "PARTIDO FICTÍCIO A", Candidate(SqcandA, "10", "CANDIDATA FICTÍCIA A", "CANDIDATA A", "1", c.A, c.Vv, final, winnerA))),
                    Group("990002", "PARTIDO FICTÍCIO B", "i", "PFB", Party("92", "PFB", "PARTIDO FICTÍCIO B", Candidate(SqcandB, "20", "CANDIDATO FICTÍCIO B", "CANDIDATO B", "2", c.B, c.Vv, final, !winnerA))),
                },
            },
        };
        root["s"] = Sections(c);
        root["e"] = Electorate(c);
        root["v"] = Votes(c);
        return JsonSerializer.SerializeToUtf8Bytes(root);
    }

    private static object Group(string n, string nm, string tp, string com, object party) =>
        new { n, nm, tp, com, tvtn = "0", tvan = "0", par = new[] { party } };

    private static object Party(string n, string sg, string nm, object candidate) =>
        new { n, sg, nm, nfed = "", tvtn = "0", tvan = "0", cand = new[] { candidate } };

    private static object Candidate(string sqcand, string n, string nm, string nmu, string seq, long votes, long valid, bool final, bool winner) => new
    {
        n,
        sqcand,
        nm,
        nmu,
        dt = "01/01/1970",
        dvt = "Válido",
        seq,
        e = final && winner ? "s" : "n",
        st = final ? (winner ? "Eleito" : "Não eleito") : "",
        vap = N(votes),
        pvap = P2(votes, valid),
        pvapn = P9(votes, valid),
        vs = new[] { new { tp = "v", sqcand = sqcand + "9", nm = "VICE FICTÍCIO", nmu = "VICE " + nmu, sgp = "PF" } },
    };

    private byte[] FirstRoundResult(string type, string code, Counts c, double lean)
    {
        var (d, h) = Stamp(start - TimeSpan.FromDays(21));
        // 1º turno: quatro candidaturas; A e B com o mesmo sqcand do 2º turno.
        var valid = c.Vv;
        var a = (long)Math.Round(valid * (0.40 + lean * 0.08));
        var b = (long)Math.Round(valid * 0.38);
        var cc = (long)Math.Round(valid * 0.12);
        var dd = valid - a - b - cc;
        var root = new Dictionary<string, object?>
        {
            ["ele"] = N(FirstRound),
            ["t"] = "1",
            ["f"] = "s",
            ["sup"] = "n",
            ["tpabr"] = type,
            ["cdabr"] = code,
            ["dg"] = d,
            ["hg"] = h,
            ["idg"] = "5",
            ["dt"] = d,
            ["ht"] = h,
            ["dv"] = "s",
            ["tf"] = "s",
            ["and"] = "f",
            ["esae"] = "n",
            ["mnae"] = Array.Empty<string>(),
            ["carg"] = new[]
            {
                new
                {
                    cd = "1", nmn = "Presidente", nmm = "Presidente", nmf = "Presidenta", nv = "1", fed = Array.Empty<object>(),
                    agr = new object[]
                    {
                        Group("990001", "COLIGAÇÃO FICTÍCIA A", "c", "PFA / PFC", Party("91", "PFA", "PARTIDO FICTÍCIO A", FirstRoundCandidate(SqcandA, "10", "CANDIDATA A", "1", a, valid, true))),
                        Group("990002", "PARTIDO FICTÍCIO B", "i", "PFB", Party("92", "PFB", "PARTIDO FICTÍCIO B", FirstRoundCandidate(SqcandB, "20", "CANDIDATO B", "2", b, valid, true))),
                        Group("990003", "PARTIDO FICTÍCIO C", "i", "PFC3", Party("93", "PFC3", "PARTIDO FICTÍCIO C", FirstRoundCandidate("990000000003", "30", "CANDIDATO C", "3", cc, valid, false))),
                        Group("990004", "PARTIDO FICTÍCIO D", "i", "PFD", Party("94", "PFD", "PARTIDO FICTÍCIO D", FirstRoundCandidate("990000000004", "40", "CANDIDATA D", "4", dd, valid, false))),
                    },
                },
            },
            ["s"] = Sections(c),
            ["e"] = Electorate(c),
            ["v"] = Votes(c),
        };
        return JsonSerializer.SerializeToUtf8Bytes(root);
    }

    private static object FirstRoundCandidate(string sqcand, string n, string nmu, string seq, long votes, long valid, bool second) => new
    {
        n,
        sqcand,
        nm = nmu,
        nmu,
        dt = "01/01/1970",
        dvt = "Válido",
        seq,
        e = second ? "s" : "n",
        st = second ? "2º turno" : "Não eleito",
        vap = N(votes),
        pvap = P2(votes, valid),
        pvapn = P9(votes, valid),
        vs = Array.Empty<object>(),
    };
}
