using System.Collections.Immutable;
using RepBrasil.Application.LiveElection;
using RepBrasil.Application.LiveElection.Tse;

namespace RepBrasil.Tests.LiveElection;

/// <summary>Estados visuais, eventos reais (troca de liderança, md=e uma vez, tf=s) e projeções públicas.</summary>
public sealed class LiveStateMachineTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 25, 22, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Start = new(2026, 10, 25, 17, 0, 0, TimeSpan.FromHours(-3));

    private static LivePhase Phase(TseFixtures.Scenario? s, bool stale = false, bool failing = false, DateTimeOffset? now = null) =>
        LivePhases.Resolve(new PhaseInput(s is null ? null : TseFixtures.Snapshot(s), stale, failing, now ?? Now, Start));

    [Fact]
    public void Phase_follows_official_flags_with_explicit_precedence()
    {
        Assert.Equal(LivePhase.PRE_ELECTION, Phase(null));
        Assert.Equal(LivePhase.SOURCE_ERROR, Phase(null, failing: true));
        Assert.Equal(LivePhase.PRE_ELECTION, Phase(TseFixtures.AtProgress(0), now: Start.AddMinutes(-5)));
        Assert.Equal(LivePhase.WAITING_FOR_RELEASE, Phase(TseFixtures.AtProgress(0), now: Start.AddMinutes(1)));
        Assert.Equal(LivePhase.WAITING_FOR_RELEASE, Phase(TseFixtures.AtProgress(0.3) with { Dv = "n" }));
        Assert.Equal(LivePhase.LIVE, Phase(TseFixtures.AtProgress(0.3)));
        Assert.Equal(LivePhase.LIVE, Phase(TseFixtures.AtProgress(0.3) with { Md = "n" }));
        Assert.Equal(LivePhase.LIVE_STALE, Phase(TseFixtures.AtProgress(0.3), stale: true));
        Assert.Equal(LivePhase.LIVE_STALE, Phase(TseFixtures.AtProgress(0.3), failing: true));
        Assert.Equal(LivePhase.MATHEMATICALLY_DEFINED, Phase(TseFixtures.AtProgress(0.9) with { Md = "e" }));
        Assert.Equal(LivePhase.MATHEMATICALLY_DEFINED, Phase(TseFixtures.AtProgress(1) with { Md = "e" }));
        Assert.Equal(LivePhase.FINALIZING, Phase(TseFixtures.AtProgress(1)));
        Assert.Equal(LivePhase.FINAL, Phase(TseFixtures.AtProgress(1) with { Tf = "s" }));
    }

    private static DetectionResult Detect(TseFixtures.Scenario? before, TseFixtures.Scenario after, string? lastLeader = null, MathTracking? math = null, long version = 2)
    {
        var prev = before is null ? null : TseFixtures.Snapshot(before);
        var curr = TseFixtures.Snapshot(after);
        return EventDetector.Detect(prev, curr, lastLeader ?? prev?.LeaderKey, math ?? MathTracking.Empty, ElectionMath.Evaluate(curr.Candidates, curr.Electorate), version, Now, k => k == TseFixtures.A ? "TESTE A" : "TESTE B");
    }

    [Fact]
    public void Lead_change_is_detected_only_when_the_first_place_changes()
    {
        var bAhead = TseFixtures.AtProgress(0.2, 0.48);
        var aAhead = TseFixtures.AtProgress(0.3, 0.53);
        var result = Detect(bAhead, aAhead);
        var change = Assert.Single(result.Events, e => e.Type == LiveEventTypes.LeadChange);
        Assert.Equal("Mudança de liderança", change.Title);
        Assert.NotNull(result.LeadChange);
        Assert.Equal(TseFixtures.B, result.LeadChange!.PreviousLeaderKey);
        Assert.Equal(TseFixtures.A, result.LeadChange.NewLeaderKey);
        Assert.DoesNotContain(Detect(aAhead, TseFixtures.AtProgress(0.4, 0.55)).Events, e => e.Type == LiveEventTypes.LeadChange);
    }

    [Fact]
    public void Tie_in_between_still_reports_the_change_against_the_last_leader()
    {
        var tie = TseFixtures.AtProgress(0.3, 0.5) with { VotesA = 1000, VotesB = 1000 };
        var tieResult = Detect(TseFixtures.AtProgress(0.2, 0.48), tie);
        Assert.DoesNotContain(tieResult.Events, e => e.Type == LiveEventTypes.LeadChange);
        Assert.Equal(TseFixtures.B, tieResult.LastLeaderKey);
        var after = Detect(tie, TseFixtures.AtProgress(0.35, 0.55), lastLeader: TseFixtures.B);
        Assert.Contains(after.Events, e => e.Type == LiveEventTypes.LeadChange);
    }

    [Fact]
    public void Milestones_are_only_the_real_crossings()
    {
        var events = Detect(TseFixtures.AtProgress(0.2), TseFixtures.AtProgress(0.51)).Events.Where(e => e.Type == LiveEventTypes.SectionsMilestone).Select(e => e.Title).ToList();
        Assert.Equal(["25% das seções totalizadas", "50% das seções totalizadas"], events);
        // Primeiro snapshot observado já em 60%: nenhum marco anterior é inventado.
        Assert.DoesNotContain(Detect(null, TseFixtures.AtProgress(0.6)).Events, e => e.Type == LiveEventTypes.SectionsMilestone);
    }

    [Fact]
    public void Totalization_start_is_reported_when_observed()
    {
        var events = Detect(TseFixtures.AtProgress(0), TseFixtures.AtProgress(0.01)).Events;
        Assert.Contains(events, e => e.Type == LiveEventTypes.TotalizationStarted && e.Title == "Divulgação iniciada");
    }

    [Fact]
    public void Official_md_e_is_recorded_once_with_evidence_and_independent_lead_time()
    {
        var threshold = TseFixtures.AtProgress(0.95, 0.60);
        var early = Detect(TseFixtures.AtProgress(0.9, 0.6), threshold);
        var internalAlert = Assert.Single(early.Events, e => e.Type == LiveEventTypes.MathThreshold);
        Assert.Equal("internal", internalAlert.Visibility);
        Assert.Equal("Limite matemático independente do REPBrasil atingido; aguardando sinal oficial md=e.", internalAlert.Title);
        Assert.NotNull(early.Math.RepBrasilDetectedAt);
        Assert.Null(early.Math.TseSignalDetectedAt);

        var official = Detect(threshold, threshold with { Md = "e", SectionsTotalized = threshold.SectionsTotalized + 1 }, math: early.Math);
        var defined = Assert.Single(official.Events, e => e.Type == LiveEventTypes.MathematicallyDefined);
        Assert.Equal("public", defined.Visibility);
        Assert.Equal("md-e", defined.DedupeKey);
        Assert.Equal(TseFixtures.A, defined.Payload["leaderKey"]);
        Assert.NotNull(defined.Payload["repBrasilMathDetectedAt"]);
        Assert.NotNull(official.Math.Defined);
        Assert.Equal(TseFixtures.A, official.Math.Defined!.LeaderKey);

        // Repetição do mesmo sinal não gera outro evento.
        var again = Detect(threshold with { Md = "e" }, threshold with { Md = "e", SectionsTotalized = threshold.SectionsTotalized + 2 }, math: official.Math);
        Assert.DoesNotContain(again.Events, e => e.Type == LiveEventTypes.MathematicallyDefined);
    }

    [Fact]
    public void Final_totalization_and_reprocessing_and_regression_are_events()
    {
        var final = Detect(TseFixtures.AtProgress(1), TseFixtures.AtProgress(1) with { Tf = "s", VotesA = TseFixtures.AtProgress(1).VotesA + 1 });
        Assert.Contains(final.Events, e => e.Type == LiveEventTypes.Finalized);

        var reprocessing = Detect(TseFixtures.AtProgress(1) with { Tf = "s" }, TseFixtures.AtProgress(1) with { Mntf = "Atualização de registro de candidatura após a totalização" });
        Assert.Contains(reprocessing.Events, e => e.Type == LiveEventTypes.Reprocessing);

        var regression = Detect(TseFixtures.AtProgress(0.6), TseFixtures.AtProgress(0.59));
        Assert.Contains(regression.Events, e => e.Type == LiveEventTypes.DataCorrection);
    }

    private static LiveElectionState State(TerritorySnapshot national, params (string Uf, TerritorySnapshot Snapshot)[] states)
    {
        var discovered = new DiscoveredElection("ele2026", 3221, new DateOnly(2026, 10, 25), TseFixtures.Election, "Federal", 2, 1, "Presidente", 9001, 3220, []);
        var ea12 = new Ea12Config(null, null, [.. Regions.ByUf.Keys.Select((uf, i) => new Ea12Uf(uf, uf.ToUpperInvariant(), [new Ea12Municipality((90000 + i).ToString("D5", System.Globalization.CultureInfo.InvariantCulture), null, "CAPITAL " + uf, true, ["0001"])]))]);
        var context = new LiveElectionContext(LiveModes.Official, TseEnvironment.Official("ele2026"), discovered, 2026, Start, ea12);
        return LiveElectionState.Initial(context) with
        {
            National = national,
            States = states.ToImmutableDictionary(x => x.Uf, x => x.Snapshot),
            Phase = LivePhase.LIVE,
        };
    }

    [Fact]
    public void Public_math_never_anticipates_the_official_signal()
    {
        var irreversible = TseFixtures.Snapshot(TseFixtures.AtProgress(0.95, 0.62));
        Assert.True(ElectionMath.Evaluate(irreversible.Candidates, irreversible.Electorate).IsMathematicallyIrreversible);
        var publicMath = LiveProjector.MathPublic(State(irreversible));
        Assert.Null(publicMath.Independent.DistanceToIrreversibility);
        Assert.False(publicMath.Official.Defined);
        Assert.NotNull(publicMath.Independent.LeadVotes);

        var reachable = TseFixtures.Snapshot(TseFixtures.AtProgress(0.3, 0.52));
        Assert.True(LiveProjector.MathPublic(State(reachable)).Independent.DistanceToIrreversibility > 0);

        var official = TseFixtures.Snapshot(TseFixtures.AtProgress(0.95, 0.62) with { Md = "e" });
        Assert.True(LiveProjector.MathPublic(State(official)).Official.Defined);
    }

    [Fact]
    public void Regions_aggregate_absolute_votes_not_the_average_of_percentages()
    {
        // SP: A 90 de 100; RJ: A 10 de 1000. Média de % seria 50%; soma absoluta dá 100/1100 = 9,09%.
        var sp = TseFixtures.Snapshot(new TseFixtures.Scenario { Scope = "uf", Code = "sp", Electorate = 200, Sections = 2, SectionsTotalized = 2, VotesA = 90, VotesB = 10 });
        var rj = TseFixtures.Snapshot(new TseFixtures.Scenario { Scope = "uf", Code = "rj", Electorate = 2000, Sections = 2, SectionsTotalized = 2, VotesA = 10, VotesB = 990 });
        var state = State(TseFixtures.Snapshot(TseFixtures.AtProgress(0.5)), ("sp", sp), ("rj", rj));
        var region = LiveProjector.Region(state, "SE", "Sudeste", LiveProjector.CandidateOrder(state));
        var a = region.Candidates.Single(c => c.Key == TseFixtures.A);
        Assert.Equal(100, a.Votes);
        Assert.Equal(100m * 100 / 1100, a.Pct);
        Assert.Equal(LiveProjector.Coverage_Partial, region.Coverage); // MG e ES ausentes
        Assert.Equal(TseFixtures.B, region.LeaderKey);
    }

    [Fact]
    public void Remaining_votes_by_uf_add_not_totalized_and_not_counted_electorate()
    {
        var file = new AccompanimentFile(TseFixtures.Election, 2, 'o', null, null,
        [
            new AccompanimentEntry("uf", "sp", "p", null, new SectionCounts(100, 60, 40, 60, 0, 60, 0, 60, 100, 100), new ElectorateCounts(1000, 600, 400, 600, 0, 590, 10, 500, 100, 60, null, null, null)),
            new AccompanimentEntry("uf", "ce", "p", null, new SectionCounts(50, 50, 0, 50, 0, 50, 0, 100, 100, 100), new ElectorateCounts(400, 400, 0, 400, 0, 400, 0, 320, 80, 100, null, null, null)),
        ]);
        var state = State(TseFixtures.Snapshot(TseFixtures.AtProgress(0.5))) with { NationalAccompaniment = file };
        var remaining = LiveProjector.Remaining(state);
        Assert.Equal("SP", remaining[0].Uf);
        Assert.Equal(410, remaining[0].RemainingUpperBound);
        Assert.Equal(100m, remaining[0].ShareOfRemaining);
        Assert.Equal(0, remaining[1].RemainingUpperBound);
    }

    [Fact]
    public void Absence_is_null_in_the_contract_never_zero()
    {
        var state = State(TseFixtures.Snapshot(TseFixtures.AtProgress(0.5)));
        var missing = LiveProjector.State(state, "sp");
        Assert.False(missing.Available);
        Assert.All(missing.Candidates, c => Assert.Null(c.Votes));
        Assert.Null(missing.Sections.Total);
        Assert.Equal(LiveProjector.Coverage_Partial, missing.Coverage);
    }

    [Fact]
    public void Municipal_leading_count_only_appears_with_complete_coverage()
    {
        var state = State(TseFixtures.Snapshot(TseFixtures.AtProgress(0.5)));
        var summary = LiveProjector.States(state).Summary;
        Assert.False(summary.Municipalities.Complete);
        Assert.Null(summary.Municipalities.Leading);
    }
}
