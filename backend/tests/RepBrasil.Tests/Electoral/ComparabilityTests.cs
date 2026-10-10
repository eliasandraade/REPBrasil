using RepBrasil.Application.Electoral;

namespace RepBrasil.Tests.Electoral;

public class ComparabilityTests
{
    private static ContestInfo Contest(int office, string scope, string unit, string? uf = "CE") =>
        new(2026, 1, 1, office, "Cargo", scope, unit, uf, unit);

    [Fact]
    public void Contest_comparability_requires_same_office_and_same_unit()
    {
        var de2022 = Contest(7, "state", "CE");
        var de2026 = Contest(7, "state", "CE");
        Assert.Equal(ContestComparability.Comparable, Comparability.Contest(de2022, de2026, true, true));
        Assert.Equal(ContestComparability.DifferentOffice, Comparability.Contest(Contest(6, "state", "CE"), Contest(5, "state", "CE"), true, true));
        Assert.Equal(ContestComparability.DifferentOffice, Comparability.Contest(Contest(13, "municipal", "13897"), de2026, true, true));
        Assert.Equal(ContestComparability.DifferentTerritorialScope,
            Comparability.Contest(Contest(11, "municipal", "13897"), Contest(11, "municipal", "13730"), true, true));
        Assert.Equal(ContestComparability.Unavailable, Comparability.Contest(de2022, de2026, true, false));
    }

    [Fact]
    public void Cell_state_never_turns_absence_into_zero()
    {
        var full = Comparability.Coverage.Full;
        Assert.Equal(CellState.OutsideContest, Comparability.Cell(false, full, false, false, true, 0));
        Assert.Equal(CellState.NoCoverage, Comparability.Cell(true, Comparability.Coverage.None, false, false, true, 0));
        Assert.Equal(CellState.TicketMember, Comparability.Cell(true, full, true, false, false, 0));
        Assert.Equal(CellState.NotOnBallot, Comparability.Cell(true, full, false, true, false, 0));
        Assert.Equal(CellState.Unlinked, Comparability.Cell(true, full, false, false, false, 0));
        Assert.Equal(CellState.PartialCoverage, Comparability.Cell(true, Comparability.Coverage.Partial, false, false, true, 3));
        Assert.Equal(CellState.Zero, Comparability.Cell(true, full, false, false, true, 0));
        Assert.Equal(CellState.Value, Comparability.Cell(true, full, false, false, true, 7));
        Assert.False(Comparability.HasCount(CellState.Unlinked));
        Assert.True(Comparability.HasCount(CellState.Zero));
    }

    [Fact]
    public void Section_identity_compares_principal_plus_aggregated_members()
    {
        Assert.Equal(TerritoryComparability.Comparable, Comparability.SectionStatus([new[] { 100 }, new[] { 100 }]));
        Assert.Equal(TerritoryComparability.Comparable, Comparability.SectionStatus([new[] { 102, 101 }, new[] { 101, 102 }]));
        Assert.Equal(TerritoryComparability.SectionCompositionChanged, Comparability.SectionStatus([new[] { 101, 102 }, new[] { 101 }]));
        Assert.Equal(TerritoryComparability.CoverageOrSectionMissing, Comparability.SectionStatus([new[] { 103 }, null]));
    }

    [Theory]
    [InlineData(10L, 20L, 10L, 100.0)]
    [InlineData(20L, 15L, -5L, -25.0)]
    [InlineData(3L, 4L, 1L, 33.33)]
    public void Delta_is_absolute_and_relative(long from, long to, long delta, double pct)
    {
        var (d, p) = Comparability.Delta(from, to);
        Assert.Equal(delta, d);
        Assert.Equal(pct, p);
    }

    [Fact]
    public void Delta_without_base_is_not_invented()
    {
        Assert.Equal((null, null), Comparability.Delta(null, 5));
        Assert.Equal((5L, (double?)null), Comparability.Delta(0, 5)); // base zero: só a variação absoluta
    }

    [Fact]
    public void Overtake_requires_strict_inversion()
    {
        Assert.True(Comparability.Overtook(10, 20, 20, 15));
        Assert.False(Comparability.Overtook(10, 20, 15, 15)); // empate não é superação
        Assert.False(Comparability.Overtook(20, 10, 30, 15)); // já estava à frente
    }

    [Fact]
    public void Not_on_ballot_reads_the_official_complement_flag()
    {
        Assert.True(Comparability.NotOnBallot("NÃO"));
        Assert.False(Comparability.NotOnBallot("SIM"));
        Assert.False(Comparability.NotOnBallot(null)); // desconhecido não é "fora da urna"
    }

    [Fact]
    public void Insight_texts_are_deterministic_and_carry_structured_values()
    {
        var contest = new ContestInfo(2022, 1, 546, 7, "Deputado Estadual", "state", "CE", "CE", "Ceará");
        var rank = InsightEngine.Rank(contest, 3, 573, 98765);
        Assert.Equal("rank_in_contest", rank.Code);
        Assert.Equal("3º lugar entre 573 números votados para Deputado Estadual (Ceará) em 2022, com 98.765 votos.", rank.Text);
        Assert.Equal(98765L, rank.Values["votes"]);
        var assets = InsightEngine.Assets(new AssetsStepDto(Guid.Empty, Guid.Empty, 100m, 150m, 50m, 50, 1, 0, 1), 2022, 2026);
        Assert.Contains("não indica irregularidade", assets.Text);
    }
}
