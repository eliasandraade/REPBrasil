using RepBrasil.Application.Electoral;

namespace RepBrasil.Tests.Electoral;

/// <summary>Base Eleitoral: fórmula versionada (pura) e serviço sobre o repositório em memória. Dados fictícios.</summary>
public class ElectoralBaseTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    // ── Fórmula ──────────────────────────────────────────────────────────────

    [Fact]
    public void Position_rewards_the_lead_and_scales_by_the_number_of_contestants()
    {
        Assert.Equal(1, ElectoralBaseFormula.Position(1, 2));
        Assert.Equal(0, ElectoralBaseFormula.Position(2, 2)); // perder uma disputa de dois = 0
        Assert.Equal(0.75, ElectoralBaseFormula.Position(2, 5), 4);
        Assert.Equal(0, ElectoralBaseFormula.Position(10, 300)); // 10º ou além numa proporcional
        Assert.Equal(1 - 4 / 9.0, ElectoralBaseFormula.Position(5, 300), 4);
    }

    [Fact]
    public void Percent_rank_uses_midrank_for_ties()
    {
        double[] values = [10, 20, 20, 40];
        Assert.Equal(0.125, ElectoralBaseFormula.PercentRank(values, 10));
        Assert.Equal(0.5, ElectoralBaseFormula.PercentRank(values, 20));
        Assert.Equal(0.875, ElectoralBaseFormula.PercentRank(values, 40));
    }

    [Fact]
    public void Score_is_the_weighted_sum_of_its_components_and_the_weights_add_up_to_one()
    {
        var (score, parts) = ElectoralBaseFormula.Score(0.9, 1, 1, 0.8);
        Assert.Equal(1, parts.Sum(p => p.Weight), 3);
        Assert.Equal(parts.Sum(p => p.Contribution), score, 3);
        Assert.Equal("stronghold", ElectoralBaseFormula.ClassOf(score));
        Assert.Equal(["share_percentile", "position", "leader_ratio", "volume_percentile"], parts.Select(p => p.Key));
    }

    [Fact]
    public void Without_enough_territories_percentiles_are_left_out_and_weights_rescaled()
    {
        var (score, parts) = ElectoralBaseFormula.Score(null, 1, 0.5, null);
        Assert.Equal(["position", "leader_ratio"], parts.Select(p => p.Key));
        Assert.Equal(1, parts.Sum(p => p.Weight), 3);
        Assert.Equal(0.75, score, 3);
    }

    [Theory]
    [InlineData(0.80, "stronghold")]
    [InlineData(0.7999, "strong")]
    [InlineData(0.60, "strong")]
    [InlineData(0.40, "competitive")]
    [InlineData(0.20, "weak")]
    [InlineData(0.0, "very_weak")]
    public void Classes_follow_the_published_thresholds(double score, string expected) =>
        Assert.Equal(expected, ElectoralBaseFormula.ClassOf(score));

    [Fact]
    public void Margin_is_lead_over_the_runner_up_or_gap_to_the_leader()
    {
        Assert.Equal(10, ElectoralBaseFormula.MarginPoints(60, 60, 50, 100)); // lidera por 10 p.p.
        Assert.Equal(-20, ElectoralBaseFormula.MarginPoints(30, 50, 50, 100)); // 20 p.p. atrás do 1º
        Assert.Null(ElectoralBaseFormula.MarginPoints(30, 50, 50, null)); // sem válidos, sem margem (nunca 0)
    }

    // ── Regressão conceitual: General Sampaio, Prefeito 2024 ───────────────

    private static readonly Guid Mayor = Guid.Parse("00000000-0000-0000-0000-00000000a024");
    private static readonly Guid Mayor20 = Guid.Parse("00000000-0000-0000-0000-00000000a020");
    private const string GeneralSampaio = "13935";

    /// <summary>
    /// Forma do caso real que detectou o bug do lake (Raio X territorial depois do archive): 30 seções principais,
    /// duas com agregadas, 4.078 votos no total; seções conhecidas 27 = 151, 29 (+ agregada) = 169, 30 (+ agregada) = 166,
    /// 226 = 195 e 206 = 175. As demais 25 seções completam o total (valores fictícios).
    /// </summary>
    private static (FakeXrayRepository Repo, Dictionary<int, long> Votes) GeneralSampaioScenario()
    {
        var repo = new FakeXrayRepository();
        repo.Municipalities.Add(new MunicipalityRefRow { Uf = "CE", TseCode = GeneralSampaio, Name = "General Sampaio", Slug = "general-sampaio", IbgeCode = 2304657 });
        repo.Candidacies.Add(Xray.Candidacy(Mayor, 2024, 11, "municipal", GeneralSampaio, 15, "CANDIDATO FICTÍCIO", officeName: "Prefeito", outcome: "ELEITO", elected: true));
        var votes = new Dictionary<int, long> { [27] = 151, [29] = 169, [30] = 166, [226] = 195, [206] = 175 };
        var others = Enumerable.Range(1, 25).ToList();
        var remaining = 4078 - votes.Values.Sum(); // 3.222
        foreach (var (section, i) in others.Select((s, i) => (s, i)))
            votes[section] = remaining / others.Count + (i < remaining % others.Count ? 1 : 0);
        var resultId = 1000L;
        foreach (var (section, v) in votes.OrderBy(kv => kv.Key))
        {
            int[] members = section switch { 29 => [29, 231], 30 => [30, 232], _ => [section] };
            repo.Sections.Add(Xray.Section(++resultId, 2024, 11, section, members, place: section < 15 ? "1066" : "1090",
                valid: v * 2, zone: 50, municipality: GeneralSampaio));
            repo.SectionVotes.Add(Xray.Votes(resultId, Mayor, v));
            repo.ContestStats.Add((Mayor, "section", new ContestStatsRow
            {
                MunicipalityTseCode = GeneralSampaio,
                Zone = 50,
                Section = section,
                LeaderVotes = v,
                BestOtherVotes = v - 10,
                Contestants = 3,
                Ahead = 0,
                TargetVotes = v,
            }));
        }
        return (repo, votes);
    }

    [Fact]
    public async Task General_sampaio_mayor_2024_keeps_every_section_and_the_official_total()
    {
        var (repo, _) = GeneralSampaioScenario();
        var service = new ElectoralBaseService(repo, new TerritoryService(repo));

        var result = await service.BuildAsync(Mayor, "section", null, null, null, null, Ct);

        Assert.Equal(4078, result.Summary.Votes);
        Assert.Equal(30, result.Summary.Territories); // 30/30 seções
        Assert.Equal(30, result.Summary.TerritoriesWithVotes);
        Assert.Equal(100, result.Summary.Capillarity);
        long VotesOf(int section) => result.Territories.Single(t => t.Territory.Section == section).Territory.Votes!.Value;
        Assert.Equal(151, VotesOf(27));
        Assert.Equal(169, VotesOf(29));
        Assert.Equal(166, VotesOf(30));
        Assert.Equal(195, VotesOf(226));
        Assert.Equal(175, VotesOf(206));
        Assert.Equal([29, 231], result.Territories.Single(t => t.Territory.Section == 29).Territory.SectionMembers);
        Assert.Equal([30, 232], result.Territories.Single(t => t.Territory.Section == 30).Territory.SectionMembers);
        Assert.All(result.Territories, t => Assert.Equal(1, t.Rank));
        Assert.Equal(30, result.Summary.Leading);
    }

    [Fact]
    public async Task Missing_section_votes_are_never_zero_and_never_classified()
    {
        var (repo, _) = GeneralSampaioScenario();
        repo.SectionVotes.RemoveAll(v => v.ResultId == repo.Sections.Single(s => s.Section == 27).ResultId);
        repo.ContestStats.RemoveAll(s => s.Row.Section == 27);
        var result = await new ElectoralBaseService(repo, new TerritoryService(repo)).BuildAsync(Mayor, "section", null, null, null, null, Ct);
        var s27 = result.Territories.Single(t => t.Territory.Section == 27);
        // sem linha de voto na urna com vínculo auditado o fato é zero; sem estatística da disputa, não há classe
        Assert.Null(s27.Class);
        Assert.Null(s27.Score);
        Assert.Empty(s27.Components);
    }

    [Fact]
    public async Task Classification_carries_its_decomposition_and_formula_version()
    {
        var (repo, _) = GeneralSampaioScenario();
        var result = await new ElectoralBaseService(repo, new TerritoryService(repo)).BuildAsync(Mayor, "section", null, null, null, null, Ct);
        Assert.Equal("electoral-base/v1", result.Formula.Version);
        foreach (var t in result.Territories.Where(t => t.Score is not null))
        {
            Assert.InRange(Math.Abs(t.Score!.Value - t.Components.Sum(c => c.Contribution)), 0, 0.001);
            Assert.Equal(ElectoralBaseFormula.ClassOf(t.Score.Value), t.Class);
        }
        Assert.Equal(result.Territories.Count(t => t.Class is not null), result.Summary.ClassCounts.Values.Sum());
    }

    /// <summary>A mesma pessoa em 2020: seção 29 sem a agregada, seção 27 com 100 votos e todas as seções no local 1066.</summary>
    private static (FakeXrayRepository Repo, Dictionary<int, long> Votes) WithMayor2020()
    {
        var (repo, votes) = GeneralSampaioScenario();
        var person = Guid.NewGuid();
        repo.Candidacies[0] = Xray.Candidacy(Mayor, 2024, 11, "municipal", GeneralSampaio, 15, "CANDIDATO FICTÍCIO", person, officeName: "Prefeito");
        repo.Candidacies.Add(Xray.Candidacy(Mayor20, 2020, 11, "municipal", GeneralSampaio, 15, "CANDIDATO FICTÍCIO", person, officeName: "Prefeito"));
        var resultId = 5000L;
        foreach (var (section, v) in votes)
        {
            int[] members = section switch { 30 => [30, 232], _ => [section] };
            var before = section == 27 ? 100 : v;
            repo.Sections.Add(Xray.Section(++resultId, 2020, 11, section, members, place: "1066", valid: before * 2, zone: 50, municipality: GeneralSampaio));
            repo.SectionVotes.Add(Xray.Votes(resultId, Mayor20, before));
            repo.ContestStats.Add((Mayor20, "section", new ContestStatsRow
            {
                MunicipalityTseCode = GeneralSampaio,
                Zone = 50,
                Section = section,
                LeaderVotes = before + 5,
                BestOtherVotes = before + 5,
                Contestants = 2,
                Ahead = 1,
                TargetVotes = before,
            }));
        }
        return (repo, votes);
    }

    [Fact]
    public async Task Change_compares_only_with_the_same_contest_and_flags_recomposed_sections()
    {
        var (repo, _) = WithMayor2020();
        var result = await new ElectoralBaseService(repo, new TerritoryService(repo)).BuildAsync(Mayor, "section", null, null, null, null, Ct);

        Assert.Equal(Mayor20, result.ComparedWith!.CandidacyId);
        Assert.Equal(ContestComparability.Comparable, result.ComparedWith.Comparability);
        var s27 = result.Territories.Single(t => t.Territory.Section == 27).Change!;
        Assert.Equal((51L, 51.0), (s27.DeltaVotes!.Value, s27.DeltaPercent!.Value));
        Assert.Equal(1, s27.RankChange); // 2º → 1º
        var s29 = result.Territories.Single(t => t.Territory.Section == 29).Change!;
        Assert.Equal(TerritoryComparability.SectionCompositionChanged, s29.Comparability);
        Assert.Null(s29.DeltaVotes); // seção recomposta: nunca afirma variação
        Assert.Equal([$"{GeneralSampaio}|50|27"], result.Highlights.Growth);
        Assert.Contains($"{GeneralSampaio}|50|27", result.Highlights.GainedPosition);
    }

    [Fact]
    public async Task Polling_places_whose_sections_changed_between_elections_carry_no_delta()
    {
        // 2024: seções < 15 no local 1066 e as demais no 1090; 2020: todas no 1066 — eleitorados diferentes
        var (repo, _) = WithMayor2020();
        var result = await new ElectoralBaseService(repo, new TerritoryService(repo)).BuildAsync(Mayor, "place", null, null, null, null, Ct);
        Assert.NotEmpty(result.Territories);
        Assert.All(result.Territories, t =>
        {
            Assert.NotEqual(TerritoryComparability.Comparable, t.Change!.Comparability);
            Assert.Null(t.Change.DeltaVotes);
        });
        Assert.Empty(result.Highlights.Growth);
        Assert.Empty(result.Highlights.Decline);
    }

    [Fact]
    public async Task Ticket_members_are_redirected_to_the_head_candidacy()
    {
        var repo = new FakeXrayRepository();
        var vice = Guid.NewGuid();
        repo.Candidacies.Add(Xray.Candidacy(vice, 2024, 12, "municipal", GeneralSampaio, 15, "VICE FICTÍCIO", officeName: "Vice-Prefeito"));
        var service = new ElectoralBaseService(repo, new TerritoryService(repo));
        var error = await Assert.ThrowsAsync<ElectoralBadRequestException>(() => service.BuildAsync(vice, "section", null, null, null, null, Ct));
        Assert.Contains("titular", error.Message);
    }
}
