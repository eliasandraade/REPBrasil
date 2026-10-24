using RepBrasil.Application.LiveElection.Tse;

namespace RepBrasil.Application.LiveElection;

/// <summary>Teto conservador de eleitores que ainda podem aparecer na contagem.</summary>
public sealed record RemainingElectorate(long? UpperBound, bool InvariantsOk, string? Reason);

/// <summary>
/// Validador matemático independente do REPBrasil (nível 1). Conservador por construção: supõe que TODO eleitor ainda
/// potencialmente apurável vote validamente no segundo colocado. Não estima comparecimento, brancos nem nulos.
/// </summary>
public sealed record IrreversibilityResult(
    bool Available,
    string? Reason,
    string? LeaderKey,
    string? RunnerUpKey,
    long? LeaderVotes,
    long? RunnerUpVotes,
    long? LeadVotes,
    long? RemainingElectorateUpperBound,
    long? SafetyMargin,
    long? VotesNeededForTrailingCandidate,
    long? MaxPossibleTrailingCandidate,
    bool IsMathematicallyIrreversible,
    bool InvariantsOk)
{
    /// <summary>Quanto a vantagem precisa crescer (ou o teto cair) para a desigualdade valer: remaining − lead + 1.</summary>
    public long? DistanceToIrreversibility =>
        Available && !IsMathematicallyIrreversible ? RemainingElectorateUpperBound - LeadVotes + 1 : null;

    public static IrreversibilityResult Unavailable(string reason, bool invariantsOk = false) =>
        new(false, reason, null, null, null, null, null, null, null, null, null, false, invariantsOk);
}

/// <summary>
/// Métricas derivadas do REPBrasil. Lógica crítica só com inteiros (long, checked); percentuais são derivados para
/// apresentação. Agregações sempre por numerador/denominador absolutos — nunca média de percentuais.
/// </summary>
public static class ElectionMath
{
    public static long? VoteLead(long? leader, long? runnerUp) => leader is null || runnerUp is null ? null : checked(leader.Value - runnerUp.Value);

    public static decimal? PercentagePointLead(decimal? leader, decimal? runnerUp) => leader is null || runnerUp is null ? null : leader - runnerUp;

    /// <summary>part / whole × 100. Denominador zero ou ausente → null (não há percentual de nada).</summary>
    public static decimal? Share(long? part, long? whole) =>
        part is null || whole is null or <= 0 ? null : decimal.Divide(part.Value * 100m, whole.Value);

    public static decimal? ValidVoteShare(long? candidateVotes, long? validVotes) => Share(candidateVotes, validVotes);

    /// <summary>Comparecimento sobre o eleitorado de seções instaladas (definição do TSE para pc/pcn).</summary>
    public static decimal? TurnoutRate(long? turnout, long? electorateInInstalled) => Share(turnout, electorateInInstalled);

    public static decimal? AbstentionRate(long? abstention, long? electorateInInstalled) => Share(abstention, electorateInInstalled);

    public static decimal? BlankRate(long? blank, long? totalVotes) => Share(blank, totalVotes);

    public static decimal? NullRate(long? nullTotal, long? totalVotes) => Share(nullTotal, totalVotes);

    public static decimal? SectionsProgress(long? totalized, long? total) => Share(totalized, total);

    public static decimal? ElectorateProgress(long? inTotalized, long? total) => Share(inTotalized, total);

    /// <summary>
    /// Teto do eleitorado ainda potencialmente apurável: esnt + esna (eleitores de seções não totalizadas + de seções
    /// marcadas como não apuradas). Equivale a te − esa − esni quando os invariantes oficiais valem. Divergência entre as
    /// duas formas → invariantes inconsistentes: devolve o maior teto (conservador) e marca InvariantsOk = false.
    /// </summary>
    public static RemainingElectorate Remaining(ElectorateCounts e)
    {
        long? direct = e.InNotTotalized is null || e.InNotCounted is null ? null : checked(e.InNotTotalized.Value + e.InNotCounted.Value);
        long? complement = e.Total is null || e.InCounted is null || e.InNotInstalled is null
            ? null
            : checked(e.Total.Value - e.InCounted.Value - e.InNotInstalled.Value);
        if (direct is null && complement is null) return new RemainingElectorate(null, false, "Eleitorado restante não publicado.");
        if (direct is null || complement is null) return new RemainingElectorate(direct ?? complement, false, "Campos do eleitorado incompletos.");
        if (direct != complement)
            return new RemainingElectorate(Math.Max(direct.Value, complement.Value), false, "Invariantes do eleitorado inconsistentes (esnt + esna ≠ te − esa − esni).");
        if (direct < 0) return new RemainingElectorate(null, false, "Eleitorado restante negativo.");
        return new RemainingElectorate(direct, true, null);
    }

    public static long MathSafetyMargin(long leadVotes, long remainingUpperBound) => checked(leadVotes - remainingUpperBound);

    /// <summary>Desigualdade estrita: leader &gt; runnerUp + remaining. Igualdade ainda admite empate.</summary>
    public static bool IsIrreversible(long leaderVotes, long runnerUpVotes, long remainingUpperBound) =>
        leaderVotes > checked(runnerUpVotes + remainingUpperBound);

    public static IrreversibilityResult Evaluate(IReadOnlyList<CandidateTally> candidates, ElectorateCounts electorate)
    {
        var withVotes = candidates.Where(c => c.Votes is not null).OrderByDescending(c => c.Votes).ThenBy(c => c.Key, StringComparer.Ordinal).ToList();
        if (withVotes.Count < 2) return IrreversibilityResult.Unavailable("Votos de dois candidatos ainda não publicados.");
        var remaining = Remaining(electorate);
        if (remaining.UpperBound is null) return IrreversibilityResult.Unavailable(remaining.Reason ?? "Eleitorado restante indisponível.");

        var leader = withVotes[0];
        var runnerUp = withVotes[1];
        var lead = checked(leader.Votes!.Value - runnerUp.Votes!.Value);
        var bound = remaining.UpperBound.Value;
        // Sem invariantes íntegros o REPBrasil não afirma irreversibilidade: os números continuam visíveis, o veredito não.
        var irreversible = remaining.InvariantsOk && lead > 0 && IsIrreversible(leader.Votes.Value, runnerUp.Votes.Value, bound);
        return new IrreversibilityResult(
            true,
            remaining.InvariantsOk ? null : remaining.Reason,
            lead > 0 ? leader.Key : null,
            lead > 0 ? runnerUp.Key : null,
            leader.Votes,
            runnerUp.Votes,
            lead,
            bound,
            MathSafetyMargin(lead, bound),
            checked(lead + 1),
            checked(runnerUp.Votes.Value + bound),
            irreversible,
            remaining.InvariantsOk);
    }

    /// <summary>Invariantes oficiais (s, e, v e soma dos candidatos). Lista vazia = consistente.</summary>
    public static IReadOnlyList<string> Invariants(SectionCounts s, ElectorateCounts e, VoteCounts v, IReadOnlyList<CandidateTally> candidates)
    {
        var problems = new List<string>();
        void Check(string name, long? left, params long?[] parts)
        {
            if (left is null || parts.Any(p => p is null)) return;
            if (left != parts.Sum(p => p!.Value)) problems.Add(name);
        }
        Check("ts = st + snt", s.Total, s.Totalized, s.NotTotalized);
        Check("st = si + sni", s.Totalized, s.Installed, s.NotInstalled);
        Check("si = sa + sna", s.Installed, s.Counted, s.NotCounted);
        Check("te = est + esnt", e.Total, e.InTotalized, e.InNotTotalized);
        Check("est = esi + esni", e.InTotalized, e.InInstalled, e.InNotInstalled);
        Check("esi = esa + esna", e.InInstalled, e.InCounted, e.InNotCounted);
        Check("esi = c + a", e.InInstalled, e.Turnout, e.Abstention);
        if (v.NoCandidate is null or 0)
        {
            Check("tv = vb + vn + vnt + van + vansj + vv", v.Total, v.Blank, v.Null, v.TechnicalNull, v.Annulled, v.AnnulledSubJudice, v.Valid);
            Check("vvc = vv + van + vansj", v.ToCandidates, v.Valid, v.Annulled, v.AnnulledSubJudice);
        }
        Check("tvn = vn + vnt", v.NullTotal, v.Null, v.TechnicalNull);
        if (candidates.Count > 0 && candidates.All(c => c.Votes is not null) && v.ToCandidates is not null)
            Check("Σ vap = vvc", v.ToCandidates, [.. candidates.Select(c => c.Votes)]);
        return problems;
    }

    /// <summary>Taxa por minuto entre dois instantes (estatística operacional; nunca previsão de resultado).</summary>
    public static decimal? PerMinute(long? from, long? to, TimeSpan elapsed)
    {
        if (from is null || to is null || elapsed <= TimeSpan.Zero) return null;
        return decimal.Divide(to.Value - from.Value, (decimal)elapsed.TotalMinutes);
    }
}
