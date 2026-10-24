using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using RepBrasil.Application.LiveElection.Tse;

namespace RepBrasil.Application.LiveElection;

public enum TerritoryScope
{
    Br,
    Uf,
    Mu,
    Zona,
}

/// <summary>Abrangência de um arquivo: "br"; UF minúscula ("sp", "zz" = exterior); município (5 dígitos); zona ("mmmmm-zzzz").</summary>
public readonly record struct TerritoryKey(TerritoryScope Scope, string Code)
{
    public static readonly TerritoryKey National = new(TerritoryScope.Br, "br");

    public static TerritoryKey State(string uf) => new(TerritoryScope.Uf, uf.ToLowerInvariant());

    public static TerritoryKey Municipality(string tseCode) => new(TerritoryScope.Mu, tseCode);

    public static TerritoryKey Zone(string municipality, string zone) => new(TerritoryScope.Zona, $"{municipality}-{zone}");

    public string ScopeName => Scope switch
    {
        TerritoryScope.Br => "br",
        TerritoryScope.Uf => "uf",
        TerritoryScope.Mu => "mu",
        _ => "zona",
    };

    public override string ToString() => $"{ScopeName}:{Code}";
}

/// <summary>Dados cadastrais do candidato (parte fixa do EA20) e situação oficial.</summary>
public sealed record CandidateProfile(
    string Key,
    int Number,
    string? Name,
    string BallotName,
    int Position,
    int? PartyNumber,
    string? PartyAcronym,
    string? PartyName,
    Ea20Group Group,
    Ea20RunningMate? Vice,
    string? Destination,
    string? Situation,
    bool? Elected,
    IReadOnlyList<Ea20Substitute> Substituted);

public sealed record CandidateTally(string Key, long? Votes, decimal? Percent);

/// <summary>
/// Snapshot normalizado e imutável de uma abrangência: uma unidade consistente (nunca mistura gerações).
/// <see cref="ContentHash"/> cobre só o que é relevante (votos, totais e indicadores oficiais): regenerar o mesmo
/// resultado no TSE (novo idg/dg/hg) não cria snapshot novo.
/// </summary>
public sealed record TerritorySnapshot(
    TerritoryKey Key,
    string? Uf,
    int ElectionCode,
    int Round,
    char Phase,
    DateTimeOffset? GeneratedAt,
    long? GenerationId,
    DateTimeOffset? TotalizedAt,
    string Progress,
    bool? VotesReleased,
    bool? FinalTotalization,
    string? MathFlag,
    string? NonFinalReason,
    bool? NoElectedAttribution,
    IReadOnlyList<string> NoElectedReasons,
    IReadOnlyList<CandidateProfile> Profiles,
    IReadOnlyList<CandidateTally> Candidates,
    SectionCounts Sections,
    ElectorateCounts Electorate,
    VoteCounts Votes,
    DateTimeOffset IngestedAt,
    string PayloadSha256,
    string ContentHash,
    string? ETag,
    string? LastModified)
{
    public static TerritorySnapshot From(
        Ea20Result result,
        TerritoryKey key,
        string? uf,
        DateTimeOffset ingestedAt,
        ReadOnlySpan<byte> payload,
        string? etag,
        string? lastModified)
    {
        var profiles = result.Office.Candidates
            .Select(c => new CandidateProfile(
                c.Sqcand,
                c.Number,
                c.Name,
                c.BallotName,
                c.Position,
                c.PartyNumber,
                c.PartyAcronym,
                c.PartyName,
                c.Group,
                c.RunningMates.FirstOrDefault(m => string.Equals(m.Kind, "v", StringComparison.OrdinalIgnoreCase)),
                c.Destination,
                c.Situation,
                c.Elected,
                c.Substituted))
            .ToList();
        // dv = "n": o TSE publica zero no lugar dos votos; o REPBrasil não exibe zero como resultado.
        var released = result.VotesReleased != false;
        var tallies = result.Office.Candidates
            .Select(c => new CandidateTally(c.Sqcand, released ? c.Votes : null, released ? c.Percent : null))
            .ToList();
        var snapshot = new TerritorySnapshot(
            key,
            uf?.ToLowerInvariant(),
            result.ElectionCode,
            result.Round,
            result.Phase,
            result.GeneratedAt,
            result.GenerationId,
            result.TotalizedAt,
            result.Progress,
            result.VotesReleased,
            result.FinalTotalization,
            result.MathematicallyDefined,
            result.NonFinalReason,
            result.NoElectedAttribution,
            result.NoElectedReasons,
            profiles,
            tallies,
            result.Sections,
            result.Electorate,
            released ? result.Votes : VoteCounts.Empty,
            ingestedAt,
            Convert.ToHexString(SHA256.HashData(payload)).ToLowerInvariant(),
            "",
            etag,
            lastModified);
        return snapshot with { ContentHash = snapshot.ComputeContentHash() };
    }

    public string ComputeContentHash()
    {
        var b = new StringBuilder(512);
        void Add(object? value) => b.Append(Convert.ToString(value, CultureInfo.InvariantCulture)).Append('|');
        Add(Key);
        Add(ElectionCode);
        Add(Progress);
        Add(VotesReleased);
        Add(FinalTotalization);
        Add(MathFlag);
        Add(NonFinalReason);
        Add(NoElectedAttribution);
        Add(string.Join(';', NoElectedReasons));
        foreach (var p in Profiles) Add($"{p.Key}:{p.Destination}:{p.Situation}:{p.Elected}");
        foreach (var c in Candidates) Add($"{c.Key}:{c.Votes}:{c.Percent}");
        Add(Sections);
        Add(Electorate);
        Add(Votes);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(b.ToString()))).ToLowerInvariant();
    }

    public bool HasVotes => Candidates.Any(c => c.Votes > 0);

    /// <summary>Líder por votos absolutos (inteiros). Empate ou ausência de votos → null.</summary>
    public string? LeaderKey => Leader(Candidates);

    public long? LeadVotes => Lead(Candidates);

    public decimal? LeadPp
    {
        get
        {
            var ordered = Candidates.Where(c => c.Percent is not null).OrderByDescending(c => c.Percent).ToList();
            return ordered.Count >= 2 ? ordered[0].Percent - ordered[1].Percent : null;
        }
    }

    public static string? Leader(IReadOnlyList<CandidateTally> candidates)
    {
        var ordered = candidates.Where(c => c.Votes is not null).OrderByDescending(c => c.Votes).ToList();
        if (ordered.Count == 0 || ordered[0].Votes is null or 0) return null;
        if (ordered.Count > 1 && ordered[0].Votes == ordered[1].Votes) return null;
        return ordered[0].Key;
    }

    public static long? Lead(IReadOnlyList<CandidateTally> candidates)
    {
        var ordered = candidates.Where(c => c.Votes is not null).OrderByDescending(c => c.Votes).ToList();
        return ordered.Count >= 2 ? ordered[0].Votes - ordered[1].Votes : null;
    }
}
