using System.Globalization;

namespace RepBrasil.Application.LiveElection;

public sealed record DetectionResult(
    IReadOnlyList<LiveEvent> Events,
    LeadChangeRecord? LeadChange,
    MathTracking Math,
    string? LastLeaderKey);

/// <summary>
/// Compara o snapshot nacional anterior com o novo e produz só eventos reais (marcos nunca são inventados: um marco
/// cruzado antes do primeiro snapshot observado não vira evento). Chaves de deduplicação tornam a gravação idempotente.
/// </summary>
public static class EventDetector
{
    private static readonly decimal[] Milestones = [10m, 25m, 50m, 75m, 90m, 95m, 99m, 100m];

    public static DetectionResult Detect(
        TerritorySnapshot? previous,
        TerritorySnapshot current,
        string? lastLeaderKey,
        MathTracking math,
        IrreversibilityResult independent,
        long version,
        DateTimeOffset now,
        Func<string, string> nameOf)
    {
        var events = new List<LiveEvent>();
        var at = current.TotalizedAt ?? current.GeneratedAt;
        var pct = current.Sections.TotalizedPct;
        var scope = current.Key.ScopeName;
        var code = current.Key.Code;

        LiveEvent Event(string type, string? dedupe, string title, string? detail, IReadOnlyDictionary<string, object?>? payload = null, string visibility = "public") =>
            new(0, type, visibility, dedupe, scope, code, at, now, title, detail, pct, payload ?? new Dictionary<string, object?>());

        var started = current.Sections.Totalized > 0 || current.Progress is "p" or "f";
        var wasStarted = previous is not null && (previous.Sections.Totalized > 0 || previous.Progress is "p" or "f");
        if (started && previous is not null && !wasStarted)
            events.Add(Event(LiveEventTypes.TotalizationStarted, "totalization-started", "Divulgação iniciada", "Primeiros dados oficiais de totalização publicados pelo TSE."));

        if (previous?.Sections.TotalizedPct is { } before && pct is { } after)
        {
            foreach (var milestone in Milestones.Where(m => before < m && after >= m))
            {
                var label = milestone.ToString("0", CultureInfo.InvariantCulture);
                events.Add(Event(LiveEventTypes.SectionsMilestone, $"sections-{label}", $"{label}% das seções totalizadas", null));
            }
        }

        LeadChangeRecord? leadChange = null;
        var leader = current.LeaderKey;
        if (leader is not null && lastLeaderKey is not null && leader != lastLeaderKey)
        {
            leadChange = new LeadChangeRecord(0, at, now, lastLeaderKey, leader, pct, current.Candidates, current.LeadVotes, version);
            events.Add(Event(
                LiveEventTypes.LeadChange,
                $"lead-change-{version}",
                "Mudança de liderança",
                $"{nameOf(leader)} passa a ter mais votos totalizados.",
                new Dictionary<string, object?>
                {
                    ["previousLeaderKey"] = lastLeaderKey,
                    ["newLeaderKey"] = leader,
                    ["leadVotes"] = current.LeadVotes,
                    ["snapshotVersion"] = version,
                }));
        }

        var nextMath = math;
        if (independent.IsMathematicallyIrreversible && math.RepBrasilDetectedAt is null)
        {
            nextMath = nextMath with { RepBrasilDetectedAt = now };
            if (current.MathFlag != "e")
            {
                events.Add(Event(
                    LiveEventTypes.MathThreshold,
                    "math-threshold",
                    "Limite matemático independente do REPBrasil atingido; aguardando sinal oficial md=e.",
                    null,
                    MathPayload(current, independent, now, null),
                    visibility: "internal"));
            }
        }

        if (current.MathFlag == "e" && math.TseSignalDetectedAt is null)
        {
            var defined = leader is null
                ? null
                : new DefinedSnapshot(
                    leader,
                    current.Candidates.First(c => c.Key == leader).Votes,
                    current.Candidates.First(c => c.Key == leader).Percent,
                    current.LeadVotes,
                    pct,
                    at,
                    now);
            nextMath = nextMath with { TseDefinedAt = at, TseSignalDetectedAt = now, Defined = defined };
            events.Add(Event(
                LiveEventTypes.MathematicallyDefined,
                "md-e",
                "Resultado matematicamente definido segundo os dados oficiais do TSE",
                leader is null ? null : $"{nameOf(leader)} com o resultado matematicamente definido (sinal oficial md=e).",
                MathPayload(current, independent, now, nextMath.RepBrasilDetectedAt)));
        }

        if (current.FinalTotalization == true && previous?.FinalTotalization != true)
            events.Add(Event(LiveEventTypes.Finalized, "finalized", "Totalização final", "O TSE concluiu a totalização final do 2º turno."));

        if (current.NonFinalReason is { } reason && previous?.NonFinalReason != reason)
            events.Add(Event(LiveEventTypes.Reprocessing, $"reprocessing-{current.ContentHash[..16]}", "Reprocessamento pendente de totalização final", reason));

        if (previous is not null && Regressed(previous, current))
        {
            events.Add(Event(
                LiveEventTypes.DataCorrection,
                $"data-correction-{version}",
                "Números revisados pelo TSE",
                "O arquivo oficial trouxe números menores que o anterior (reprocessamento). O dado oficial novo foi aceito e o anterior continua no histórico.",
                new Dictionary<string, object?>
                {
                    ["previousContentHash"] = previous.ContentHash,
                    ["currentContentHash"] = current.ContentHash,
                    ["snapshotVersion"] = version,
                }));
        }

        return new DetectionResult(events, leadChange, nextMath, leader ?? lastLeaderKey);
    }

    /// <summary>Votos de algum candidato, seções totalizadas ou total de votos diminuíram.</summary>
    public static bool Regressed(TerritorySnapshot previous, TerritorySnapshot current)
    {
        if (current.Sections.Totalized < previous.Sections.Totalized) return true;
        if (current.Votes.Total < previous.Votes.Total) return true;
        foreach (var c in current.Candidates)
        {
            var before = previous.Candidates.FirstOrDefault(p => p.Key == c.Key);
            if (before?.Votes is not null && c.Votes is not null && c.Votes < before.Votes) return true;
        }
        return false;
    }

    private static Dictionary<string, object?> MathPayload(TerritorySnapshot s, IrreversibilityResult m, DateTimeOffset now, DateTimeOffset? repBrasilDetectedAt) => new()
    {
        ["tseTotalizedAt"] = s.TotalizedAt,
        ["tseGeneratedAt"] = s.GeneratedAt,
        ["tseGenerationId"] = s.GenerationId,
        ["receivedAt"] = now,
        ["leaderKey"] = m.LeaderKey,
        ["runnerUpKey"] = m.RunnerUpKey,
        ["leaderVotes"] = m.LeaderVotes,
        ["runnerUpVotes"] = m.RunnerUpVotes,
        ["leadVotes"] = m.LeadVotes,
        ["remainingElectorateUpperBound"] = m.RemainingElectorateUpperBound,
        ["safetyMargin"] = m.SafetyMargin,
        ["independentIrreversible"] = m.IsMathematicallyIrreversible,
        ["invariantsOk"] = m.InvariantsOk,
        ["sectionsTotalizedPct"] = s.Sections.TotalizedPct,
        ["electorateNotTotalized"] = s.Electorate.InNotTotalized,
        ["electorateNotCounted"] = s.Electorate.InNotCounted,
        ["mathFlag"] = s.MathFlag,
        ["finalTotalization"] = s.FinalTotalization,
        ["contentHash"] = s.ContentHash,
        ["payloadSha256"] = s.PayloadSha256,
        ["repBrasilMathDetectedAt"] = repBrasilDetectedAt,
        ["repBrasilLeadSeconds"] = repBrasilDetectedAt is { } r && s.MathFlag == "e" ? (now - r).TotalSeconds : null,
    };
}
