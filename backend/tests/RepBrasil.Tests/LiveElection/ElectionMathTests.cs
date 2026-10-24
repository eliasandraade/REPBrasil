using RepBrasil.Application.LiveElection;
using RepBrasil.Application.LiveElection.Tse;

namespace RepBrasil.Tests.LiveElection;

/// <summary>Validador matemático independente: desigualdade estrita, inteiros, teto conservador e invariantes.</summary>
public sealed class ElectionMathTests
{
    private static ElectorateCounts Electorate(long remainingNotTotalized, long notCounted = 0, long total = 10_000)
    {
        var est = total - remainingNotTotalized;
        var esi = est;
        return new ElectorateCounts(total, est, remainingNotTotalized, esi, 0, esi - notCounted, notCounted, esi, 0, null, null, null, null);
    }

    private static IReadOnlyList<CandidateTally> Votes(long a, long b) => [new("a", a, null), new("b", b, null)];

    [Theory]
    [InlineData(60, 40, 30, false)] // 60 > 70? não: não definido
    [InlineData(80, 40, 30, true)] // 80 > 70: irreversível
    [InlineData(70, 40, 30, false)] // 70 > 70? não: ainda cabe empate
    [InlineData(71, 40, 30, true)]
    [InlineData(0, 0, 0, false)]
    public void Strict_inequality_on_integers(long leader, long runnerUp, long remaining, bool expected)
    {
        Assert.Equal(expected, ElectionMath.IsIrreversible(leader, runnerUp, remaining));
        if (leader > runnerUp)
        {
            var result = ElectionMath.Evaluate(Votes(leader, runnerUp), Electorate(remaining));
            Assert.True(result.Available);
            Assert.Equal(expected, result.IsMathematicallyIrreversible);
            Assert.Equal(leader - runnerUp, result.LeadVotes);
            Assert.Equal(remaining, result.RemainingElectorateUpperBound);
            Assert.Equal(leader - runnerUp - remaining, result.SafetyMargin);
            Assert.Equal(leader - runnerUp + 1, result.VotesNeededForTrailingCandidate);
            Assert.Equal(runnerUp + remaining, result.MaxPossibleTrailingCandidate);
        }
    }

    [Fact]
    public void Distance_to_irreversibility_matches_the_example()
    {
        // Vantagem 4.321.987; eleitorado restante 6.038.221 → distância 1.716.235 (precisa ser estritamente maior).
        var result = ElectionMath.Evaluate(Votes(54_321_987, 50_000_000), Electorate(6_038_221, total: 160_000_000));
        Assert.False(result.IsMathematicallyIrreversible);
        Assert.Equal(1_716_235, result.DistanceToIrreversibility);
    }

    [Fact]
    public void Remaining_includes_sections_marked_not_counted()
    {
        var e = Electorate(remainingNotTotalized: 20, notCounted: 15);
        var remaining = ElectionMath.Remaining(e);
        Assert.True(remaining.InvariantsOk);
        Assert.Equal(35, remaining.UpperBound);
        // 70 − 40 = 30 de vantagem: não supera 35.
        Assert.False(ElectionMath.Evaluate(Votes(70, 40), e).IsMathematicallyIrreversible);
    }

    [Fact]
    public void Inconsistent_electorate_suspends_the_verdict_but_keeps_the_conservative_bound()
    {
        var e = new ElectorateCounts(10_000, 9_000, 500, 9_000, 0, 9_000, 0, 8_000, 1_000, null, null, null, null);
        var remaining = ElectionMath.Remaining(e);
        Assert.False(remaining.InvariantsOk);
        Assert.Equal(1_000, remaining.UpperBound);
        var result = ElectionMath.Evaluate(Votes(9_000, 10), e);
        Assert.False(result.IsMathematicallyIrreversible);
        Assert.False(result.InvariantsOk);
    }

    [Fact]
    public void Tie_has_no_leader_and_no_verdict()
    {
        var result = ElectionMath.Evaluate(Votes(500, 500), Electorate(0));
        Assert.Null(result.LeaderKey);
        Assert.False(result.IsMathematicallyIrreversible);
        Assert.Equal(1, result.DistanceToIrreversibility);
    }

    [Fact]
    public void Missing_votes_make_the_check_unavailable()
    {
        var result = ElectionMath.Evaluate([new("a", null, null), new("b", null, null)], Electorate(0));
        Assert.False(result.Available);
        Assert.False(result.IsMathematicallyIrreversible);
    }

    /// <summary>Propriedade: com teto ≥ vantagem, nunca irreversível; com vantagem &gt; teto (e invariantes ok), sempre.</summary>
    [Fact]
    public void Property_irreversible_iff_lead_exceeds_remaining()
    {
        var random = new Random(20261025);
        for (var i = 0; i < 20_000; i++)
        {
            var b = random.NextInt64(0, 80_000_000);
            var a = b + random.NextInt64(0, 10_000_000);
            var remaining = random.NextInt64(0, 20_000_000);
            var result = ElectionMath.Evaluate(Votes(a, b), Electorate(remaining, total: 200_000_000));
            Assert.Equal(a - b > remaining, result.IsMathematicallyIrreversible);
            if (!result.IsMathematicallyIrreversible) Assert.True(result.DistanceToIrreversibility > 0);
        }
    }

    [Fact]
    public void Shares_use_absolute_numbers_never_rounded_internally()
    {
        Assert.Equal(50m, ElectionMath.Share(1, 2));
        Assert.Null(ElectionMath.Share(1, 0));
        Assert.Null(ElectionMath.Share(null, 10));
        Assert.Equal(33.333333333333333333333333333m, ElectionMath.Share(1, 3));
    }

    [Fact]
    public void Official_invariants_hold_for_consistent_files_and_flag_drift()
    {
        var ok = TseFixtures.Snapshot(TseFixtures.AtProgress(0.6) with { SectionsNotInstalled = 3, ElectorateNotInstalled = 900, SectionsNotCounted = 1, ElectorateNotCounted = 300 });
        Assert.Empty(ElectionMath.Invariants(ok.Sections, ok.Electorate, ok.Votes, ok.Candidates));

        var broken = ok with { Votes = ok.Votes with { Total = ok.Votes.Total + 1 } };
        Assert.Contains("tv = vb + vn + vnt + van + vansj + vv", ElectionMath.Invariants(broken.Sections, broken.Electorate, broken.Votes, broken.Candidates));
    }

    [Fact]
    public void Annulled_candidate_votes_count_in_vvc_but_not_in_valid()
    {
        var s = TseFixtures.Snapshot(TseFixtures.AtProgress(0.5) with { DestinationB = "Anulado sub judice" });
        Assert.Empty(ElectionMath.Invariants(s.Sections, s.Electorate, s.Votes, s.Candidates));
        Assert.Equal(s.Votes.Valid + s.Votes.AnnulledSubJudice, s.Votes.ToCandidates);
        Assert.Equal("Anulado sub judice", s.Profiles[1].Destination);
    }

    [Fact]
    public void Velocity_per_minute_is_descriptive()
    {
        Assert.Equal(100m, ElectionMath.PerMinute(1_000, 1_500, TimeSpan.FromMinutes(5)));
        Assert.Null(ElectionMath.PerMinute(1_000, 1_500, TimeSpan.Zero));
    }
}
