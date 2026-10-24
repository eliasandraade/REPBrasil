namespace RepBrasil.Application.LiveElection.Tse;

// Modelos dos arquivos de divulgação de resultados do TSE (Eleições 2026), na forma lida pelo parser.
// Os nomes dos campos oficiais estão nos comentários. Ausência é null; o parser nunca inventa zero.

/// <summary>EA11 (ele-c.json): templates de diretório e pleitos/eleições.</summary>
public sealed record Ea11Config(
    DateTimeOffset? GeneratedAt,
    long? GenerationId,
    char Phase,
    IReadOnlyDictionary<string, string> DirectoryTemplates,
    IReadOnlyList<Ea11Pleito> Pleitos);

public sealed record Ea11Pleito(int Code, string Cycle, DateOnly? Date, IReadOnlyList<Ea11Election> Elections);

/// <summary>Eleição do EA11: cd, cdt2 (eleição do 2º turno), nm, t (turno), tp (tipo) e cargos por abrangência.</summary>
public sealed record Ea11Election(
    int Code,
    int? SecondRoundCode,
    string Name,
    int Round,
    int? Type,
    IReadOnlyList<Ea11ScopeOffices> Scopes)
{
    public bool HasOffice(int officeCode, string scope) =>
        Scopes.Any(s => string.Equals(s.Scope, scope, StringComparison.OrdinalIgnoreCase) && s.Offices.Any(o => o.Code == officeCode));
}

public sealed record Ea11ScopeOffices(string Scope, IReadOnlyList<Ea11Office> Offices);

public sealed record Ea11Office(int Code, string Name, int? Type);

/// <summary>EA12 (mun-e&lt;eleição&gt;-cm.json): municípios por UF, com código TSE, código IBGE, capital e zonas.</summary>
public sealed record Ea12Config(DateTimeOffset? GeneratedAt, long? GenerationId, IReadOnlyList<Ea12Uf> Ufs);

public sealed record Ea12Uf(string Uf, string Name, IReadOnlyList<Ea12Municipality> Municipalities);

/// <summary>cd (TSE, 5 dígitos), cdi (IBGE, 7 dígitos; vazio no exterior), nm, c (capital), z (zonas, 4 dígitos).</summary>
public sealed record Ea12Municipality(string TseCode, string? IbgeCode, string Name, bool Capital, IReadOnlyList<string> Zones);

/// <summary>EA14 (br-e…-ab.json) e EA15 (&lt;uf&gt;-e…-ab.json): acompanhamento por abrangência, sem votos.</summary>
public sealed record AccompanimentFile(
    int ElectionCode,
    int Round,
    char Phase,
    DateTimeOffset? GeneratedAt,
    long? GenerationId,
    IReadOnlyList<AccompanimentEntry> Entries);

/// <summary>Entrada abr: tpabr (br, uf, mun), cdabr, and, dt/ht (última totalização), seções e eleitorado.</summary>
public sealed record AccompanimentEntry(
    string ScopeType,
    string Code,
    string Progress,
    DateTimeOffset? TotalizedAt,
    SectionCounts Sections,
    ElectorateCounts Electorate);

/// <summary>EA20 (…-u.json): resultado unificado de uma abrangência.</summary>
public sealed record Ea20Result(
    int ElectionCode,
    int Round,
    char Phase,
    bool? Supplementary,
    string ScopeType,
    string ScopeCode,
    DateTimeOffset? GeneratedAt,
    long? GenerationId,
    bool? VotesReleased,
    DateTimeOffset? TotalizedAt,
    bool? FinalTotalization,
    string? NonFinalReason,
    string Progress,
    string? MathematicallyDefined,
    bool? NoElectedAttribution,
    IReadOnlyList<string> NoElectedReasons,
    Ea20Office Office,
    SectionCounts Sections,
    ElectorateCounts Electorate,
    VoteCounts Votes);

public sealed record Ea20Office(int Code, string Name, int? Vacancies, IReadOnlyList<Ea20Candidate> Candidates);

/// <summary>Agremiação (agr): coligação (c), federação (f) ou partido isolado (i).</summary>
public sealed record Ea20Group(string? Number, string? Name, string? Kind, string? Composition);

public sealed record Ea20RunningMate(string? Kind, string? Sqcand, string? Name, string? BallotName, string? Party);

public sealed record Ea20Substitute(string? Name, string? BallotName, string? Party);

/// <summary>Candidato (cand): n, sqcand, nm, nmu, dt, dvt, seq, e, st, vap, pvap, pvapn, vs, subs + partido/agremiação.</summary>
public sealed record Ea20Candidate(
    int Number,
    string Sqcand,
    string? Name,
    string BallotName,
    DateOnly? BirthDate,
    string? Destination,
    int Position,
    bool? Elected,
    string? Situation,
    long? Votes,
    decimal? PercentRounded,
    decimal? Percent,
    IReadOnlyList<Ea20RunningMate> RunningMates,
    IReadOnlyList<Ea20Substitute> Substituted,
    int? PartyNumber,
    string? PartyAcronym,
    string? PartyName,
    string? FederationNumber,
    Ea20Group Group);

/// <summary>s: ts, st, snt, si, sni, sa, sna e os percentuais oficiais com 9 casas (…n).</summary>
public sealed record SectionCounts(
    long? Total,
    long? Totalized,
    long? NotTotalized,
    long? Installed,
    long? NotInstalled,
    long? Counted,
    long? NotCounted,
    decimal? TotalizedPct,
    decimal? InstalledPct,
    decimal? CountedPct)
{
    public static readonly SectionCounts Empty = new(null, null, null, null, null, null, null, null, null, null);
}

/// <summary>e: te, est, esnt, esi, esni, esa, esna, c, a e os percentuais oficiais (…n).</summary>
public sealed record ElectorateCounts(
    long? Total,
    long? InTotalized,
    long? InNotTotalized,
    long? InInstalled,
    long? InNotInstalled,
    long? InCounted,
    long? InNotCounted,
    long? Turnout,
    long? Abstention,
    decimal? InTotalizedPct,
    decimal? InCountedPct,
    decimal? TurnoutPct,
    decimal? AbstentionPct)
{
    public static readonly ElectorateCounts Empty = new(null, null, null, null, null, null, null, null, null, null, null, null, null);
}

/// <summary>v: tv, vvc, vv, vnom, vl, van, vansj, vscv, vb, tvn, vn, vnt, vsan e percentuais oficiais (…n).</summary>
public sealed record VoteCounts(
    long? Total,
    long? ToCandidates,
    long? Valid,
    long? Nominal,
    long? Legend,
    long? Annulled,
    long? AnnulledSubJudice,
    long? NoCandidate,
    long? Blank,
    long? NullTotal,
    long? Null,
    long? TechnicalNull,
    long? AnnulledSections,
    decimal? ToCandidatesPct,
    decimal? BlankPct,
    decimal? NullTotalPct,
    decimal? AnnulledPct)
{
    public static readonly VoteCounts Empty = new(null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null);
}
