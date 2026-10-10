using RepBrasil.Application.Electoral;

namespace RepBrasil.Tests.Electoral;

/// <summary>Cenários sintéticos de comparação entre eleições (dados fictícios).</summary>
public class ComparisonServiceTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly Guid PersonA = Guid.NewGuid(), PersonB = Guid.NewGuid(), PersonC = Guid.NewGuid(), PersonD = Guid.NewGuid();
    private static readonly Guid A22 = Guid.NewGuid(), B22 = Guid.NewGuid(), A26 = Guid.NewGuid(), B26 = Guid.NewGuid();
    private static readonly Guid C26 = Guid.NewGuid(), D22 = Guid.NewGuid(), D26 = Guid.NewGuid(), E26 = Guid.NewGuid(), F26 = Guid.NewGuid();

    private static FakeXrayRepository Repo()
    {
        var repo = new FakeXrayRepository();
        repo.Municipalities.Add(new MunicipalityRefRow { Uf = "CE", TseCode = "99999", Name = "Município Fictício", Slug = "municipio-ficticio" });
        repo.Candidacies.AddRange([
            Xray.Candidacy(A22, 2022, 7, "state", "CE", 12345, "CANDIDATA A", PersonA),
            Xray.Candidacy(B22, 2022, 7, "state", "CE", 22222, "CANDIDATO B", PersonB),
            Xray.Candidacy(A26, 2026, 7, "state", "CE", 12345, "CANDIDATA A", PersonA),
            Xray.Candidacy(B26, 2026, 7, "state", "CE", 22222, "CANDIDATO B", PersonB),
            Xray.Candidacy(C26, 2026, 7, "state", "CE", 33333, "CANDIDATA C", PersonC),
            Xray.Candidacy(D22, 2022, 6, "state", "CE", 4444, "CANDIDATO D", PersonD, officeName: "Deputado Federal"),
            Xray.Candidacy(D26, 2026, 5, "state", "CE", 444, "CANDIDATO D", PersonD, officeName: "Senador"),
            Xray.Candidacy(E26, 2026, 7, "state", "CE", 55555, "SEM VÍNCULO", hasLink: false),
            Xray.Candidacy(F26, 2026, 7, "state", "CE", 66666, "FORA DA URNA", hasLink: false, insertedInUrn: "NÃO"),
        ]);
        // 2022: seções 100, 101 (+102 agregada), 103 e 104; 2026: 100, 101 (sem agregada), 104 — 103 não existe mais.
        repo.Sections.AddRange([
            Xray.Section(1, 2022, 7, 100, [100]), Xray.Section(2, 2022, 7, 101, [101, 102]),
            Xray.Section(3, 2022, 7, 103, [103]), Xray.Section(4, 2022, 7, 104, [104]),
            Xray.Section(11, 2026, 7, 100, [100]), Xray.Section(12, 2026, 7, 101, [101]), Xray.Section(14, 2026, 7, 104, [104]),
            Xray.Section(21, 2022, 6, 100, [100]), Xray.Section(31, 2026, 5, 100, [100]),
        ]);
        repo.SectionVotes.AddRange([
            Xray.Votes(1, A22, 10), Xray.Votes(1, B22, 20),
            Xray.Votes(11, A26, 20), Xray.Votes(11, B26, 15),
            Xray.Votes(2, A22, 5), Xray.Votes(2, B22, 5), Xray.Votes(12, A26, 7), Xray.Votes(12, B26, 1),
            Xray.Votes(3, A22, 3),
            Xray.Votes(4, B22, 4), Xray.Votes(14, A26, 6), Xray.Votes(14, B26, 2), // A em 2022 na 104: zero real
            Xray.Votes(21, D22, 50), Xray.Votes(31, D26, 80),
        ]);
        return repo;
    }

    private static ComparisonService.Request Section(params Guid[] ids) => new(ids, "CE", "section", "99999", null);

    private static CompareTerritoryDto Territory(ElectoralComparisonResponse r, int section) =>
        r.Territories.Single(t => t.Section == section);

    private static CompareCellDto Cell(CompareTerritoryDto t, Guid id) => t.Cells.Single(c => c.CandidacyId == id);

    [Fact]
    public async Task Section_100_growth_decline_and_overtake()
    {
        var r = await new ComparisonService(Repo()).CompareAsync(Section(A22, B22, A26, B26), Ct);

        Assert.Equal(2, r.Subjects.Count);
        Assert.Equal([2022, 2026], r.Elections.Select(e => e.Year));
        var s100 = Territory(r, 100);
        Assert.Equal(TerritoryComparability.Comparable, s100.Comparability);
        Assert.Equal(10, Cell(s100, A22).Votes);
        Assert.Equal(15, Cell(s100, B26).Votes);

        var subjectA = r.Candidacies.Single(c => c.CandidacyId == A22).Subject;
        var subjectB = r.Candidacies.Single(c => c.CandidacyId == B22).Subject;
        var a = s100.Evolution.Single(e => e.Subject == subjectA);
        var b = s100.Evolution.Single(e => e.Subject == subjectB);
        Assert.Equal((10L, 100.0), (a.DeltaVotes!.Value, a.DeltaPercent!.Value));
        Assert.Equal((-5L, -25.0), (b.DeltaVotes!.Value, b.DeltaPercent!.Value));
        Assert.Equal(B22, s100.Leaders.Single(l => l.Election == 0).CandidacyId);
        Assert.Equal(A26, s100.Leaders.Single(l => l.Election == 1).CandidacyId);

        var overtake = Assert.Single(r.Overtakes);
        Assert.Equal((subjectA, subjectB, 0, 1), (overtake.Subject, overtake.OvertakenSubject, overtake.FromElection, overtake.ToElection));
        Assert.Contains(s100.Key, overtake.Keys);
        Assert.Contains(r.Insights, i => i.Code == "overtake" && i.Text.Contains("CANDIDATA A passou à frente de CANDIDATO B"));

        var growth = r.Extremes.Single(x => x.Kind == "growth" && x.Subject == subjectA);
        Assert.Equal((s100.Key, 10L), (growth.Key, growth.DeltaVotes));
        var decline = r.Extremes.Single(x => x.Kind == "decline" && x.Subject == subjectB);
        Assert.Equal((s100.Key, -5L), (decline.Key, decline.DeltaVotes));
    }

    [Fact]
    public async Task Aggregated_section_change_blocks_the_delta()
    {
        var r = await new ComparisonService(Repo()).CompareAsync(Section(A22, A26), Ct);
        var s101 = Territory(r, 101);
        Assert.Equal(TerritoryComparability.SectionCompositionChanged, s101.Comparability);
        var step = Assert.Single(s101.Evolution);
        Assert.Equal(TerritoryComparability.SectionCompositionChanged, step.Comparability);
        Assert.Null(step.DeltaVotes);
        Assert.Equal([101, 102], s101.MembersByElection![0]);
        Assert.Equal([101], s101.MembersByElection![1]);
    }

    [Fact]
    public async Task Missing_section_is_no_coverage_never_zero()
    {
        var r = await new ComparisonService(Repo()).CompareAsync(Section(A22, A26), Ct);
        var s103 = Territory(r, 103);
        Assert.Equal(TerritoryComparability.CoverageOrSectionMissing, s103.Comparability);
        var cell = Cell(s103, A26);
        Assert.Equal(CellState.NoCoverage, cell.State);
        Assert.Null(cell.Votes);
        Assert.Null(Assert.Single(s103.Evolution).DeltaVotes);
    }

    [Fact]
    public async Task Linked_candidacy_without_votes_in_existing_urn_is_a_real_zero()
    {
        var r = await new ComparisonService(Repo()).CompareAsync(Section(A22, A26), Ct);
        var s104 = Territory(r, 104);
        var zero = Cell(s104, A22);
        Assert.Equal(CellState.Zero, zero.State);
        Assert.Equal(0, zero.Votes);
        var step = Assert.Single(s104.Evolution);
        Assert.Equal(6, step.DeltaVotes);
        Assert.Null(step.DeltaPercent); // base zero: sem percentual
    }

    [Fact]
    public async Task Absent_candidacy_has_no_evolution()
    {
        var r = await new ComparisonService(Repo()).CompareAsync(Section(A22, A26, C26), Ct);
        var subjectC = r.Candidacies.Single(c => c.CandidacyId == C26).Subject;
        Assert.DoesNotContain(r.Territories.SelectMany(t => t.Evolution), e => e.Subject == subjectC);
        Assert.Equal(CellState.Zero, Cell(Territory(r, 100), C26).State); // estava na disputa, urna existe, sem voto
    }

    [Fact]
    public async Task Office_change_is_shown_side_by_side_without_delta()
    {
        var r = await new ComparisonService(Repo()).CompareAsync(Section(D22, D26), Ct);
        var step = Assert.Single(Territory(r, 100).Evolution);
        Assert.Equal(ContestComparability.DifferentOffice, step.Comparability);
        Assert.Null(step.DeltaVotes);
        Assert.Equal(ContestComparability.DifferentOffice, Assert.Single(r.Pairs).Comparability);
        Assert.Contains(r.Insights, i => i.Code == "contest_not_comparable");
    }

    [Fact]
    public async Task Unlinked_and_not_on_ballot_never_become_zero()
    {
        var r = await new ComparisonService(Repo()).CompareAsync(Section(A26, E26, F26), Ct);
        var s100 = Territory(r, 100);
        Assert.Equal((CellState.Unlinked, (long?)null), (Cell(s100, E26).State, Cell(s100, E26).Votes));
        Assert.Equal((CellState.NotOnBallot, (long?)null), (Cell(s100, F26).State, Cell(s100, F26).Votes));
    }

    [Fact]
    public async Task At_most_five_distinct_candidacies()
    {
        var service = new ComparisonService(Repo());
        await Assert.ThrowsAsync<ElectoralBadRequestException>(() =>
            service.CompareAsync(Section(A22, B22, A26, B26, C26, D22), Ct));
        await Assert.ThrowsAsync<ElectoralBadRequestException>(() => service.CompareAsync(Section(A22, A22), Ct));
        await Assert.ThrowsAsync<ElectoralBadRequestException>(() => service.CompareAsync(Section(), Ct));
        await Assert.ThrowsAsync<ElectoralBadRequestException>(() =>
            service.CompareAsync(new ComparisonService.Request([A22], "CE", "section", null, null), Ct));
        await Assert.ThrowsAsync<ElectoralNotFoundException>(() => service.CompareAsync(Section(Guid.NewGuid()), Ct));
        var five = await service.CompareAsync(Section(A22, B22, A26, B26, C26), Ct);
        Assert.Equal(5, five.Candidacies.Count);
    }

    [Fact]
    public async Task Zone_level_uses_coverage_and_outside_contest()
    {
        var repo = new FakeXrayRepository();
        var fortaleza = Guid.NewGuid();
        var caucaia = Guid.NewGuid();
        repo.Candidacies.AddRange([
            Xray.Candidacy(fortaleza, 2024, 13, "municipal", "11111", 12345, "VEREADORA DE M1", officeName: "Vereador"),
            Xray.Candidacy(caucaia, 2024, 13, "municipal", "22222", 12345, "VEREADOR DE M2", officeName: "Vereador"),
        ]);
        repo.Expected.AddRange([Xray.Zone(2024, "11111", 1, "M1"), Xray.Zone(2024, "22222", 2, "M2"), Xray.Zone(2024, "22222", 3, "M2")]);
        repo.Totals.AddRange([Xray.Totals(2024, 13, "11111", 1, 1000), Xray.Totals(2024, 13, "22222", 2, 500)]); // M2 zona 3 sem BU
        repo.ZoneVotes.AddRange([Xray.ZoneVotes(fortaleza, "11111", 1, 120), Xray.ZoneVotes(caucaia, "22222", 2, 80)]);

        var r = await new ComparisonService(repo).CompareAsync(new ComparisonService.Request([fortaleza, caucaia], "CE", "municipality", null, null), Ct);
        var m1 = r.Territories.Single(t => t.MunicipalityTseCode == "11111");
        Assert.Equal(CellState.Value, Cell(m1, fortaleza).State);
        Assert.Equal(CellState.OutsideContest, Cell(m1, caucaia).State); // mesmo número, outro município: nunca zero
        var m2 = r.Territories.Single(t => t.MunicipalityTseCode == "22222");
        Assert.Equal(CellState.PartialCoverage, Cell(m2, caucaia).State);
        Assert.Equal(TerritoryComparability.CoverageOrSectionMissing, m2.Comparability);
        Assert.Equal(ContestComparability.DifferentTerritorialScope, Assert.Single(r.Pairs).Comparability);
    }
}
