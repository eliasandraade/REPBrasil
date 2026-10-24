using System.Text.Json;
using static RepBrasil.Application.LiveElection.Tse.TseValues;

namespace RepBrasil.Application.LiveElection.Tse;

/// <summary>
/// Parser dos arquivos JSON de divulgação do TSE (EA11, EA12, EA14/EA15 e EA20). Dados externos são entrada não
/// confiável: campos obrigatórios ausentes ou valores impossíveis viram <see cref="TseContractException"/>; campos
/// opcionais ausentes viram null. Nenhum arquivo é "corrigido".
/// </summary>
public static class TseParser
{
    private static readonly JsonDocumentOptions Options = new() { AllowTrailingCommas = true, MaxDepth = 32 };

    private static JsonDocument Open(ReadOnlyMemory<byte> content, string kind)
    {
        if (content.IsEmpty) throw new TseContractException($"{kind}: arquivo vazio");
        var span = content.Span;
        if (span.Length >= 3 && span[0] == 0xEF && span[1] == 0xBB && span[2] == 0xBF) content = content[3..];
        try
        {
            var document = JsonDocument.Parse(content, Options);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                document.Dispose();
                throw new TseContractException($"{kind}: a raiz não é um objeto");
            }
            return document;
        }
        catch (JsonException e)
        {
            throw new TseContractException($"{kind}: JSON inválido ({e.Message})");
        }
    }

    private static char PhaseOf(JsonElement root, string kind) =>
        Code(root, "f", "o", "s") is { } f ? f[0] : throw new TseContractException($"{kind}: fase (f) ausente");

    private static int Required(int? value, string field, string kind) =>
        value ?? throw new TseContractException($"{kind}: campo obrigatório '{field}' ausente");

    private static string Required(string? value, string field, string kind) =>
        value ?? throw new TseContractException($"{kind}: campo obrigatório '{field}' ausente");

    public static Ea11Config ParseEa11(ReadOnlyMemory<byte> content)
    {
        using var document = Open(content, "EA11");
        var root = document.RootElement;
        var templates = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in Items(root, "arq"))
        {
            var type = Text(item, "tp");
            var dir = Text(item, "dir");
            if (type is not null && dir is not null) templates[type] = dir;
        }

        var pleitos = new List<Ea11Pleito>();
        foreach (var pl in Items(root, "pl"))
        {
            var elections = new List<Ea11Election>();
            foreach (var e in Items(pl, "e"))
            {
                var scopes = Items(e, "abr")
                    .Select(a => new Ea11ScopeOffices(
                        Text(a, "cd") ?? "",
                        [.. Items(a, "cp").Select(cp => new Ea11Office(Required(Int(cp, "cd"), "cp.cd", "EA11"), Text(cp, "ds") ?? "", Int(cp, "tp")))]))
                    .ToList();
                elections.Add(new Ea11Election(
                    Required(Int(e, "cd"), "e.cd", "EA11"),
                    Int(e, "cdt2"),
                    Text(e, "nm") ?? "",
                    Required(Int(e, "t"), "e.t", "EA11"),
                    Int(e, "tp"),
                    scopes));
            }
            pleitos.Add(new Ea11Pleito(Required(Int(pl, "cd"), "pl.cd", "EA11"), Text(pl, "c") ?? "", Date(pl, "dt"), elections));
        }

        return new Ea11Config(Timestamp(root, "dg", "hg"), Long(root, "idg"), PhaseOf(root, "EA11"), templates, pleitos);
    }

    public static Ea12Config ParseEa12(ReadOnlyMemory<byte> content)
    {
        using var document = Open(content, "EA12");
        var root = document.RootElement;
        var ufs = new List<Ea12Uf>();
        foreach (var abr in Items(root, "abr"))
        {
            var uf = Required(Text(abr, "cd"), "abr.cd", "EA12").ToLowerInvariant();
            if (uf.Length != 2 || !uf.All(char.IsAsciiLetterLower)) throw new TseContractException($"EA12: UF inválida '{uf}'");
            var municipalities = new List<Ea12Municipality>();
            foreach (var mu in Items(abr, "mu"))
            {
                var code = Required(Text(mu, "cd"), "mu.cd", "EA12");
                if (code.Length != 5 || !code.All(char.IsAsciiDigit)) throw new TseContractException($"EA12: código de município inválido '{code}'");
                var ibge = Text(mu, "cdi");
                if (ibge is not null && (ibge.Length != 7 || !ibge.All(char.IsAsciiDigit))) throw new TseContractException($"EA12: código IBGE inválido '{ibge}'");
                var zones = TextList(mu, "z");
                if (zones.Any(z => z.Length != 4 || !z.All(char.IsAsciiDigit))) throw new TseContractException($"EA12: zona inválida em {code}");
                municipalities.Add(new Ea12Municipality(code, ibge, Text(mu, "nm") ?? code, Flag(mu, "c") == true, zones));
            }
            ufs.Add(new Ea12Uf(uf, Text(abr, "ds") ?? uf.ToUpperInvariant(), municipalities));
        }
        return new Ea12Config(Timestamp(root, "dg", "hg"), Long(root, "idg"), ufs);
    }

    public static AccompanimentFile ParseAccompaniment(ReadOnlyMemory<byte> content)
    {
        using var document = Open(content, "EA14/EA15");
        var root = document.RootElement;
        var entries = new List<AccompanimentEntry>();
        foreach (var abr in Items(root, "abr"))
        {
            var type = Code(abr, "tpabr", "br", "uf", "mun", "mu") ?? throw new TseContractException("EA14/EA15: tpabr ausente");
            entries.Add(new AccompanimentEntry(
                type == "mu" ? "mun" : type,
                Required(Text(abr, "cdabr"), "cdabr", "EA14/EA15").ToLowerInvariant(),
                Code(abr, "and", "n", "p", "f") ?? throw new TseContractException("EA14/EA15: and ausente"),
                Timestamp(abr, "dt", "ht"),
                Sections(abr),
                Electorate(abr)));
        }
        return new AccompanimentFile(
            Required(Int(root, "ele"), "ele", "EA14/EA15"),
            Required(Int(root, "t"), "t", "EA14/EA15"),
            PhaseOf(root, "EA14/EA15"),
            Timestamp(root, "dg", "hg"),
            Long(root, "idg"),
            entries);
    }

    public static Ea20Result ParseEa20(ReadOnlyMemory<byte> content, int officeCode)
    {
        using var document = Open(content, "EA20");
        var root = document.RootElement;
        var round = Required(Int(root, "t"), "t", "EA20");
        if (round is not (1 or 2)) throw new TseContractException($"EA20: turno inválido {round}");

        var office = Items(root, "carg").FirstOrDefault(c => Int(c, "cd") == officeCode);
        if (office.ValueKind != JsonValueKind.Object) throw new TseContractException($"EA20: cargo {officeCode} ausente em carg");

        var candidates = new List<Ea20Candidate>();
        var positions = new HashSet<int>();
        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var agr in Items(office, "agr"))
        {
            var group = new Ea20Group(Text(agr, "n"), Text(agr, "nm"), Code(agr, "tp", "c", "f", "i"), Text(agr, "com"));
            foreach (var par in Items(agr, "par"))
            {
                foreach (var cand in Items(par, "cand"))
                {
                    var candidate = Candidate(cand, par, group);
                    if (!positions.Add(candidate.Position)) throw new TseContractException($"EA20: seq {candidate.Position} repetido");
                    if (!keys.Add(candidate.Sqcand)) throw new TseContractException($"EA20: sqcand {candidate.Sqcand} repetido");
                    candidates.Add(candidate);
                }
            }
        }
        candidates.Sort((a, b) => a.Position.CompareTo(b.Position));

        var sections = Property(root, "s") is not null ? Sections(root) : throw new TseContractException("EA20: elemento s ausente");
        var electorate = Property(root, "e") is not null ? Electorate(root) : throw new TseContractException("EA20: elemento e ausente");
        if (sections.Totalized > sections.Total) throw new TseContractException("EA20: seções totalizadas acima do total");

        return new Ea20Result(
            Required(Int(root, "ele"), "ele", "EA20"),
            round,
            PhaseOf(root, "EA20"),
            Flag(root, "sup"),
            Code(root, "tpabr", "br", "uf", "mu", "zona") ?? throw new TseContractException("EA20: tpabr ausente"),
            Required(Text(root, "cdabr"), "cdabr", "EA20").ToLowerInvariant(),
            Timestamp(root, "dg", "hg"),
            Long(root, "idg"),
            Flag(root, "dv"),
            Timestamp(root, "dt", "ht"),
            Flag(root, "tf"),
            Text(root, "mntf"),
            Code(root, "and", "n", "p", "f") ?? throw new TseContractException("EA20: and ausente"),
            Code(root, "md", "e", "s", "n"),
            Flag(root, "esae"),
            TextList(root, "mnae"),
            new Ea20Office(officeCode, Text(office, "nmn") ?? Text(office, "nmm") ?? "", Int(office, "nv"), candidates),
            sections,
            electorate,
            Property(root, "v") is not null ? Votes(root) : VoteCounts.Empty);
    }

    private static Ea20Candidate Candidate(JsonElement cand, JsonElement par, Ea20Group group)
    {
        var sqcand = Text(cand, "sqcand") ?? throw new TseContractException("EA20: candidato sem sqcand");
        if (sqcand.Length > 20 || !sqcand.All(char.IsAsciiDigit)) throw new TseContractException($"EA20: sqcand inválido '{sqcand}'");
        var position = Int(cand, "seq") ?? throw new TseContractException($"EA20: candidato {sqcand} sem seq");
        if (position <= 0) throw new TseContractException($"EA20: seq inválido {position}");
        var mates = Items(cand, "vs")
            .Select(v => new Ea20RunningMate(Text(v, "tp"), Text(v, "sqcand"), Text(v, "nm"), Text(v, "nmu"), Text(v, "sgp")))
            .ToList();
        var substituted = Items(cand, "subs")
            .Select(s => new Ea20Substitute(Text(s, "nm"), Text(s, "nmu"), Text(s, "sgp")))
            .ToList();
        DateOnly? birth;
        try { birth = Date(cand, "dt"); }
        catch (TseContractException) { birth = null; }
        return new Ea20Candidate(
            Int(cand, "n") ?? throw new TseContractException($"EA20: candidato {sqcand} sem número"),
            sqcand,
            Text(cand, "nm"),
            Text(cand, "nmu") ?? throw new TseContractException($"EA20: candidato {sqcand} sem nome de urna"),
            birth,
            Text(cand, "dvt"),
            position,
            Flag(cand, "e"),
            Text(cand, "st"),
            Count(cand, "vap"),
            Dec(cand, "pvap"),
            Percent(cand, "pvapn"),
            mates,
            substituted,
            Int(par, "n"),
            Text(par, "sg"),
            Text(par, "nm"),
            Text(par, "nfed"),
            group);
    }

    private static SectionCounts Sections(JsonElement parent)
    {
        var s = Property(parent, "s") ?? default;
        if (s.ValueKind != JsonValueKind.Object) return SectionCounts.Empty;
        return new SectionCounts(
            Count(s, "ts"),
            Count(s, "st"),
            Count(s, "snt"),
            Count(s, "si"),
            Count(s, "sni"),
            Count(s, "sa"),
            Count(s, "sna"),
            Percent(s, "pstn"),
            Percent(s, "psin"),
            Percent(s, "psan"));
    }

    private static ElectorateCounts Electorate(JsonElement parent)
    {
        var e = Property(parent, "e") ?? default;
        if (e.ValueKind != JsonValueKind.Object) return ElectorateCounts.Empty;
        return new ElectorateCounts(
            Count(e, "te"),
            Count(e, "est"),
            Count(e, "esnt"),
            Count(e, "esi"),
            Count(e, "esni"),
            Count(e, "esa"),
            Count(e, "esna"),
            Count(e, "c"),
            Count(e, "a"),
            Percent(e, "pestn"),
            Percent(e, "pesan"),
            Percent(e, "pcn"),
            Percent(e, "pan"));
    }

    private static VoteCounts Votes(JsonElement parent)
    {
        var v = Property(parent, "v") ?? default;
        if (v.ValueKind != JsonValueKind.Object) return VoteCounts.Empty;
        return new VoteCounts(
            Count(v, "tv"),
            Count(v, "vvc"),
            Count(v, "vv"),
            Count(v, "vnom"),
            Count(v, "vl"),
            Count(v, "van"),
            Count(v, "vansj"),
            Count(v, "vscv"),
            Count(v, "vb"),
            Count(v, "tvn"),
            Count(v, "vn"),
            Count(v, "vnt"),
            Count(v, "vsan"),
            Percent(v, "pvvcn"),
            Percent(v, "pvbn"),
            Percent(v, "ptvnn"),
            Percent(v, "pvann"));
    }
}
