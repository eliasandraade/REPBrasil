using System.Globalization;

namespace RepBrasil.Application.Electoral;

/// <summary>Disputa de uma candidatura: cargo + unidade eleitoral (BR, UF ou município TSE).</summary>
public sealed record ContestInfo(
    int Year, int Round, int ElectionCode, int OfficeCode, string OfficeName, string Scope, string ElectoralUnit,
    string? Uf, string? UnitName)
{
    public static ContestInfo From(XrayCandidacyRow c) => new(
        c.Year, c.Round, c.TseElectionCode, c.OfficeCode, c.OfficeName, c.Scope, c.ElectoralUnit.Trim(),
        string.IsNullOrWhiteSpace(c.ContestUf) ? null : c.ContestUf.Trim(), c.UnitName);

    public ElectionOffice Key => new(Year, Round, OfficeCode);

    /// <summary>
    /// Cargo cujo BU define a cobertura: o próprio, ou o do titular para vice/suplente (votados na chapa).
    /// </summary>
    public ElectionOffice CoverageKey =>
        new(Year, Round, Comparability.TicketHeads.TryGetValue(OfficeCode, out var head) ? head : OfficeCode);

    /// <summary>O território (UF, opcionalmente município) intersecta a unidade da disputa.</summary>
    public bool Covers(string uf, string? municipalityTseCode) => Scope switch
    {
        "federal" => true,
        "state" => Uf == uf,
        "municipal" => Uf == uf && (municipalityTseCode is null || ElectoralUnit == municipalityTseCode),
        _ => false,
    };

    /// <summary>Uma zona (UF + município + zona) pertence à unidade da disputa.</summary>
    public bool Contains(string uf, string municipalityTseCode) => Covers(uf, municipalityTseCode);

    public ContestRefDto ToDto() => new(
        Year, Round, ElectionCode, OfficeCode, OfficeName,
        new ElectoralUnitDto(Scope, ElectoralUnit, UnitName ?? ElectoralUnit, Uf));
}

/// <summary>
/// Regras determinísticas de comparabilidade e de estado dos valores. Nenhuma regra converte
/// ausência em zero e nenhuma compara cargos ou unidades diferentes como se fossem a mesma disputa.
/// </summary>
public static class Comparability
{
    /// <summary>Cargos votados na chapa do titular: vice → titular, suplentes → senador.</summary>
    public static readonly IReadOnlyDictionary<int, int> TicketHeads = new Dictionary<int, int>
    {
        [2] = 1,
        [4] = 3,
        [9] = 5,
        [10] = 5,
        [12] = 11,
    };

    public static bool IsTicketMember(int officeCode) => TicketHeads.ContainsKey(officeCode);

    /// <summary>Comparabilidade direta entre duas candidaturas (mesmo cargo e mesma unidade eleitoral).</summary>
    public static string Contest(ContestInfo a, ContestInfo b, bool aHasVotes, bool bHasVotes)
    {
        if (!aHasVotes || !bHasVotes) return ContestComparability.Unavailable;
        if (a.OfficeCode != b.OfficeCode) return ContestComparability.DifferentOffice;
        if (a.Scope != b.Scope || a.ElectoralUnit != b.ElectoralUnit) return ContestComparability.DifferentTerritorialScope;
        return ContestComparability.Comparable;
    }

    public enum Coverage { None, Partial, Full }

    public static Coverage CoverageOf(int zonesCovered, int zonesExpected) =>
        zonesCovered == 0 ? Coverage.None : zonesExpected > zonesCovered ? Coverage.Partial : Coverage.Full;

    /// <summary>
    /// Estado de um valor. Ordem das regras: fora da disputa → sem cobertura → chapa (vice/suplente)
    /// → fora da urna → sem vínculo → cobertura parcial → valor/zero real.
    /// </summary>
    public static string Cell(
        bool inContest, Coverage coverage, bool ticketMember, bool notOnBallot, bool hasLink, long votes)
    {
        if (!inContest) return CellState.OutsideContest;
        if (coverage == Coverage.None) return CellState.NoCoverage;
        if (ticketMember) return CellState.TicketMember;
        if (notOnBallot) return CellState.NotOnBallot;
        if (!hasLink) return CellState.Unlinked;
        if (coverage == Coverage.Partial) return CellState.PartialCoverage;
        return votes > 0 ? CellState.Value : CellState.Zero;
    }

    /// <summary>Estados em que o número de votos é um fato afirmável (inclui o zero real).</summary>
    public static bool HasCount(string state) =>
        state is CellState.Value or CellState.Zero or CellState.PartialCoverage;

    /// <summary>Estados comparáveis entre si sem ressalva (cobertura completa).</summary>
    public static bool IsComplete(string state) => state is CellState.Value or CellState.Zero;

    public static bool NotOnBallot(string? insertedInUrn) =>
        insertedInUrn is not null && insertedInUrn.Trim().ToUpperInvariant() is "NÃO" or "NAO" or "N";

    /// <summary>
    /// Seção histórica = UF + município + zona + seção. Entre eleições ela só é comparável quando o
    /// conjunto principal + agregadas é idêntico; ausente em alguma eleição ⇒ sem comparação.
    /// </summary>
    public static string SectionStatus(IReadOnlyList<IReadOnlyCollection<int>?> membersPerElection)
    {
        if (membersPerElection.Count == 0 || membersPerElection.Any(m => m is null))
            return TerritoryComparability.CoverageOrSectionMissing;
        var first = membersPerElection[0]!.OrderBy(x => x).ToArray();
        return membersPerElection.Skip(1).All(m => m!.OrderBy(x => x).SequenceEqual(first))
            ? TerritoryComparability.Comparable
            : TerritoryComparability.SectionCompositionChanged;
    }

    /// <summary>Percentual com 2 casas (meio para longe do zero); denominador ausente ou zero ⇒ null.</summary>
    public static double? Pct(long numerator, long? denominator) =>
        denominator is > 0 ? Math.Round(numerator * 10000.0 / denominator.Value, MidpointRounding.AwayFromZero) / 100 : null;

    /// <summary>Variação absoluta e percentual. Base ausente ⇒ nada; base zero ⇒ só a absoluta.</summary>
    public static (long? Delta, double? Percent) Delta(long? from, long? to)
    {
        if (from is null || to is null) return (null, null);
        var delta = to.Value - from.Value;
        return (delta, Pct(delta, from));
    }

    public static double? DeltaPoints(double? from, double? to) =>
        from is null || to is null ? null : Math.Round((to.Value - from.Value) * 100, MidpointRounding.AwayFromZero) / 100;

    /// <summary>
    /// "A superou B": A tinha menos votos que B na eleição anterior e mais na posterior, no mesmo
    /// território, com os quatro valores completos. Empate não é superação.
    /// </summary>
    public static bool Overtook(long aBefore, long bBefore, long aAfter, long bAfter) => aBefore < bBefore && aAfter > bAfter;
}

/// <summary>Formatação pt-BR dos textos determinísticos (os valores estruturados vão sem formatação).</summary>
public static class Fmt
{
    private static readonly CultureInfo PtBr = CultureInfo.GetCultureInfo("pt-BR");
    private static readonly HashSet<string> NameParticles = ["da", "de", "do", "das", "dos", "e", "del"];

    /// <summary>
    /// Nome publicado em CAIXA ALTA ("ANDRÉ FERNANDES") ou capitalizado palavra a palavra ("Juazeiro Do Norte") em
    /// caixa de nome: partículas soltas (da, de, do, das, dos, e, del) em minúscula, exceto na 1ª palavra; em caixa
    /// alta, cada palavra é capitalizada antes (também após hífen e apóstrofo). Acentos e grafia oficial ficam.
    /// </summary>
    public static string Name(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        var upper = value == value.ToUpper(PtBr);
        var words = value.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return string.Join(' ', words.Select((w, i) =>
        {
            var lower = w.ToLower(PtBr);
            if (i > 0 && NameParticles.Contains(lower)) return lower;
            return upper ? TitleWord(lower) : w;
        }));
    }

    private static string TitleWord(string lower)
    {
        var chars = lower.ToCharArray();
        for (var i = 0; i < chars.Length; i++)
            if (char.IsLetter(chars[i]) && (i == 0 || chars[i - 1] is '-' or '\'' or '’'))
                chars[i] = char.ToUpper(chars[i], PtBr);
        return new string(chars);
    }

    public static string Int(long value) => value.ToString("N0", PtBr);

    public static string Signed(long value) => (value > 0 ? "+" : value < 0 ? "−" : "") + Math.Abs(value).ToString("N0", PtBr);

    public static string Pct(double value) => value.ToString("0.##", PtBr) + "%";

    public static string SignedPct(double value) => (value > 0 ? "+" : value < 0 ? "−" : "") + Math.Abs(value).ToString("0.##", PtBr) + "%";

    public static string Money(decimal value) => value.ToString("C2", PtBr);

    public static string SignedMoney(decimal value) => (value > 0 ? "+" : value < 0 ? "−" : "") + Math.Abs(value).ToString("C2", PtBr);

    public static string Election(int year, int round) => round == 1 ? year.ToString(CultureInfo.InvariantCulture) : $"{year} (2º turno)";
}
