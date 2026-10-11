using RepBrasil.Application.Interfaces;

namespace RepBrasil.Application.Electoral;

// ── Contrato ────────────────────────────────────────────────────────────────

public record BaseComponentDto(string Key, double Value, double Weight, double Contribution);

public record BaseChangeDto(
    Guid FromCandidacyId, int FromYear, int FromRound, string Comparability, long? FromVotes, double? FromShare, int? FromRank,
    long? DeltaVotes, double? DeltaPercent, double? DeltaSharePoints, int? RankChange);

/// <summary>Um território da Base Eleitoral: fato (votos), métricas derivadas, classificação e a decomposição dela.</summary>
public record TerritoryBaseDto(
    string Key, TerritoryValueDto Territory, int? Rank, int? Contestants, long? LeaderVotes, double? MarginPoints,
    double? SharePercentile, double? VolumePercentile, double? Score, string? Class, IReadOnlyList<BaseComponentDto> Components,
    BaseChangeDto? Change);

public record FormulaComponentDto(string Key, string Label, double Weight, string Definition);

public record FormulaClassDto(string Key, string Label, double MinScore);

public record BaseFormulaDto(
    string Version, IReadOnlyList<FormulaComponentDto> Components, IReadOnlyList<FormulaClassDto> Classes,
    int MinTerritoriesForPercentiles, string Note);

public record ElectoralBaseSummaryDto(
    long? Votes, int Territories, int TerritoriesWithVotes, double? Capillarity, double? Hhi, double? TopFiveConcentration,
    IReadOnlyDictionary<string, int> ClassCounts, int Leading, int Competitive, int Critical);

/// <summary>Destaques: chaves de território (<see cref="TerritoryBaseDto.Key"/>), do mais ao menos relevante.</summary>
public record ElectoralBaseHighlightsDto(
    IReadOnlyList<string> Strongest, IReadOnlyList<string> Weakest, IReadOnlyList<string> Competitive,
    IReadOnlyList<string> HighestShare, IReadOnlyList<string> HighestVolume, IReadOnlyList<string> Growth,
    IReadOnlyList<string> Decline, IReadOnlyList<string> GainedPosition, IReadOnlyList<string> LostPosition,
    IReadOnlyList<string> Critical);

public record BaseComparisonDto(Guid CandidacyId, int Year, int Round, string Comparability, string Note);

public record ElectoralBaseResponse(
    Guid CandidacyId, ContestRefDto Contest, string Level, string? MunicipalityTseCode, int? Zone, BaseFormulaDto Formula,
    ElectoralBaseSummaryDto Summary, IReadOnlyList<TerritoryBaseDto> Territories, ElectoralBaseHighlightsDto Highlights,
    BaseComparisonDto? ComparedWith, IReadOnlyList<InsightDto> Insights, DerivedFreshnessDto Freshness,
    IReadOnlyDictionary<string, string> Definitions);

// ── Fórmula (versionada, explicável, sem caixa-preta) ───────────────────────

/// <summary>
/// Classificação territorial da Base Eleitoral. Funções puras: a mesma entrada dá sempre a mesma saída, e cada
/// classificação devolve a decomposição (componente × peso) que a produziu. Mudar pesos, limiares ou componentes
/// exige nova <see cref="Version"/>.
/// </summary>
public static class ElectoralBaseFormula
{
    public const string Version = "electoral-base/v1";

    /// <summary>Percentis só fazem sentido com territórios suficientes; abaixo disso, os pesos são redistribuídos.</summary>
    public const int MinTerritoriesForPercentiles = 5;

    /// <summary>Margem (pontos percentuais dos válidos) até a qual a disputa no território é considerada apertada.</summary>
    public const double CompetitiveMarginPoints = 5.0;

    /// <summary>Queda mínima (%) em relação à candidatura comparável anterior para um território ser crítico.</summary>
    public const double CriticalDeclinePercent = -10.0;

    public static readonly IReadOnlyList<FormulaComponentDto> Components =
    [
        new("share_percentile", "Participação relativa", 0.35,
            "percentil da % dos votos válidos da candidatura neste território, entre os territórios do recorte"),
        new("position", "Posição", 0.25,
            "1 − (posição − 1) ÷ min(concorrentes votados − 1, 9): 1º lugar = 1; 10º lugar ou além (ou último numa disputa pequena) = 0"),
        new("leader_ratio", "Distância do primeiro", 0.25,
            "votos da candidatura ÷ votos do mais votado no território (1 = lidera)"),
        new("volume_percentile", "Volume", 0.15,
            "percentil dos votos absolutos da candidatura neste território, entre os territórios do recorte"),
    ];

    public static readonly IReadOnlyList<FormulaClassDto> Classes =
    [
        new("stronghold", "Fortaleza eleitoral", 0.80),
        new("strong", "Forte", 0.60),
        new("competitive", "Competitivo", 0.40),
        new("weak", "Fraco", 0.20),
        new("very_weak", "Muito fraco", 0.0),
    ];

    public static BaseFormulaDto Describe() => new(
        Version, Components, Classes, MinTerritoriesForPercentiles,
        "Pontuação = Σ (componente × peso), de 0 a 1. Com menos de " + MinTerritoriesForPercentiles
        + " territórios os percentis ficam de fora e os pesos de posição e distância do primeiro são reescalados. "
        + "Território sem cobertura, fora da disputa ou sem vínculo auditado não é classificado (nunca vira \"muito fraco\"). "
        + "A classificação descreve a votação no território — não avalia, recomenda nem prevê nada.");

    public static double Position(int rank, int contestants)
    {
        if (rank <= 1) return 1;
        var scale = Math.Min(Math.Max(contestants - 1, 1), 9);
        return Math.Clamp(1 - (rank - 1) / (double)scale, 0, 1);
    }

    /// <summary>Percentil por posto médio em [0, 1]: (abaixo + ½ empates) ÷ n.</summary>
    public static double PercentRank(IReadOnlyList<double> values, double value)
    {
        if (values.Count == 0) return 0;
        var below = values.Count(v => v < value);
        var equal = values.Count(v => v == value);
        return Math.Round((below + 0.5 * equal) / values.Count, 4, MidpointRounding.AwayFromZero);
    }

    public static string ClassOf(double score) =>
        Classes.First(c => score >= c.MinScore).Key;

    public static string ClassLabel(string key) => Classes.FirstOrDefault(c => c.Key == key)?.Label ?? key;

    /// <summary>Pontuação e decomposição. Percentis nulos (poucos territórios) ⇒ pesos reescalados entre os demais.</summary>
    public static (double Score, IReadOnlyList<BaseComponentDto> Components) Score(
        double? sharePercentile, double position, double leaderRatio, double? volumePercentile)
    {
        var values = new Dictionary<string, double?>
        {
            ["share_percentile"] = sharePercentile,
            ["position"] = position,
            ["leader_ratio"] = leaderRatio,
            ["volume_percentile"] = volumePercentile,
        };
        var active = Components.Where(c => values[c.Key] is not null).ToList();
        var totalWeight = active.Sum(c => c.Weight);
        var parts = active
            .Select(c =>
            {
                var weight = Math.Round(c.Weight / totalWeight, 4, MidpointRounding.AwayFromZero);
                var value = Math.Round(values[c.Key]!.Value, 4, MidpointRounding.AwayFromZero);
                return new BaseComponentDto(c.Key, value, weight, Math.Round(value * weight, 4, MidpointRounding.AwayFromZero));
            })
            .ToList();
        var score = Math.Round(Math.Clamp(parts.Sum(p => p.Contribution), 0, 1), 4, MidpointRounding.AwayFromZero);
        return (score, parts);
    }

    /// <summary>
    /// Margem em pontos percentuais dos válidos: positiva = vantagem sobre o 2º (lidera); negativa = distância até o 1º.
    /// </summary>
    public static double? MarginPoints(long target, long leader, long? bestOther, long? validVotes)
    {
        if (validVotes is not > 0) return null;
        var reference = target >= leader ? bestOther ?? 0 : leader;
        return Math.Round((target - reference) * 100.0 / validVotes.Value, 2, MidpointRounding.AwayFromZero);
    }
}

// ── Serviço ─────────────────────────────────────────────────────────────────

/// <summary>
/// Base Eleitoral de uma candidatura: onde é forte, fraca, competitiva; capilaridade, concentração, crescimento e
/// queda em relação à candidatura comparável anterior; zonas, seções e locais críticos. Fatos do BU; métricas e
/// classificação derivadas, sempre com a decomposição.
/// </summary>
public class ElectoralBaseService(IElectoralXrayRepository repo, TerritoryService territory)
{
    public static readonly IReadOnlyDictionary<string, string> Definitions = new Dictionary<string, string>
    {
        ["votes"] = "fato: votos da candidatura nos Boletins de Urna vigentes do território",
        ["share"] = "métrica derivada: votos ÷ votos válidos do cargo no território",
        ["rank"] = "posição entre todos os números de candidatura votados da disputa no território (vinculados ou não a um perfil)",
        ["marginPoints"] = "pontos percentuais dos válidos: vantagem sobre o 2º quando lidera; distância até o 1º quando não lidera",
        ["capillarity"] = "territórios com pelo menos um voto ÷ territórios com Boletim de Urna do recorte",
        ["hhi"] = "concentração de Herfindahl-Hirschman da votação entre os territórios (0–10.000)",
        ["competitive"] = $"disputa apertada: |margem| ≤ {ElectoralBaseFormula.CompetitiveMarginPoints:0} p.p. com pelo menos 2 concorrentes votados",
        ["critical"] = "território que, somado aos de mais votos, forma metade da votação da candidatura E está em disputa apertada ou caiu "
            + $"{-ElectoralBaseFormula.CriticalDeclinePercent:0}% ou mais em relação à candidatura comparável anterior",
        ["change"] = "comparação com a candidatura anterior da mesma pessoa/perfil na MESMA disputa (cargo + unidade eleitoral); "
            + "sem disputa comparável ou com seções recompostas, não há delta",
        ["class"] = "classificação descritiva da votação no território (versão da fórmula em formula.version) — não é avaliação do político",
    };

    private async Task<XrayCandidacyRow> CandidacyAsync(Guid id, CancellationToken ct) =>
        (await repo.CandidaciesAsync([id], ct)).FirstOrDefault()
        ?? throw new ElectoralNotFoundException($"Candidatura {id} não encontrada.");

    public static string KeyOf(TerritoryValueDto t, string level) => level switch
    {
        "zone" => $"{t.MunicipalityTseCode}|{t.Zone}",
        "section" => $"{t.MunicipalityTseCode}|{t.Zone}|{t.Section}",
        "place" => $"{t.MunicipalityTseCode}|{t.Zone}|p{t.PlaceCode}",
        _ => t.MunicipalityTseCode ?? t.Uf,
    };

    private static string StatsKey(ContestStatsRow r, string level) => level switch
    {
        "zone" => $"{r.MunicipalityTseCode}|{r.Zone}",
        "section" => $"{r.MunicipalityTseCode}|{r.Zone}|{r.Section}",
        "place" => $"{r.MunicipalityTseCode}|{r.Zone}|p{r.PlaceCode}",
        _ => r.MunicipalityTseCode,
    };

    public async Task<ElectoralBaseResponse> BuildAsync(
        Guid candidacyId, string? level, string? uf, string? municipality, int? zone, Guid? compareTo, CancellationToken ct)
    {
        var lvl = TerritoryService.ParseLevel(level, "municipality", "zone", "section", "place");
        var c = await CandidacyAsync(candidacyId, ct);
        if (Comparability.IsTicketMember(c.OfficeCode))
            throw new ElectoralBadRequestException(
                "Vice e suplente não recebem votos próprios (são votados na chapa): consulte a Base Eleitoral da candidatura titular.");
        var contest = ContestInfo.From(c);
        var scope = TerritoryService.Scope(contest, lvl, uf, municipality);

        var territories = await territory.TerritoriesAsync(c, contest, lvl, scope.Uf, scope.Municipality, zone, ct);
        var stats = await StatsAsync(c, contest, lvl, scope.Uf, scope.Municipality, zone, ct);

        // Candidatura comparável anterior (mesma pessoa/perfil, mesma disputa) — ou a pedida.
        var (previous, comparison) = await PreviousAsync(c, contest, compareTo, ct);
        Dictionary<string, (TerritoryValueDto Value, int? Rank)> before = [];
        if (previous is not null && comparison?.Comparability == ContestComparability.Comparable)
        {
            var prevContest = ContestInfo.From(previous);
            var prevTerritories = await territory.TerritoriesAsync(previous, prevContest, lvl, scope.Uf, scope.Municipality, zone, ct);
            var prevStats = await StatsAsync(previous, prevContest, lvl, scope.Uf, scope.Municipality, zone, ct);
            foreach (var t in prevTerritories)
                before[KeyOf(t, lvl)] = (t, RankOf(t, prevStats, lvl));
        }

        var items = Classify(territories, stats, lvl, before, previous);
        var summary = Summarize(territories, items);
        var highlights = Highlights(items);
        var insights = Insights(lvl, items, summary, highlights, previous);
        return new ElectoralBaseResponse(
            c.Id, contest.ToDto(), lvl, scope.Municipality, zone, ElectoralBaseFormula.Describe(), summary, items, highlights,
            comparison, insights, XrayService.Freshness(await repo.FreshnessAsync(ct)), Definitions);
    }

    /// <summary>
    /// Camada "base" do mapa: classe da Base Eleitoral por município (UF) ou local de votação (município escolhido).
    /// Valor = pontuação; categoria = classe; território sem classificação fica sem cor (nunca "muito fraco").
    /// </summary>
    public async Task<MapLayerResponse> MapAsync(MapQuery q, CancellationToken ct)
    {
        var id = q.Candidacy ?? throw new ElectoralBadRequestException("layer base exige candidacy.");
        var level = string.IsNullOrWhiteSpace(q.Municipality) ? "municipality" : "place";
        var result = await BuildAsync(id, level, q.Uf, q.Municipality, null, null, ct);
        var uf = q.Uf.Trim().ToUpperInvariant();
        var ibge = (await repo.MunicipalitiesAsync(uf, ct)).ToDictionary(m => m.TseCode, m => (int?)m.IbgeCode);
        var features = result.Territories.Select(t =>
        {
            var v = t.Territory;
            return new MapFeatureDto(
                v.PlaceCode is null ? $"{v.Uf}|{v.MunicipalityTseCode}" : $"{v.Uf}|{v.MunicipalityTseCode}|{v.Zone}|{v.PlaceCode}",
                v.MunicipalityTseCode, v.MunicipalityTseCode is null ? null : ibge.GetValueOrDefault(v.MunicipalityTseCode),
                v.PlaceName ?? v.MunicipalityName ?? v.MunicipalityTseCode ?? v.Uf, v.Zone, v.PlaceCode, v.Latitude, v.Longitude,
                t.Score, t.Class, t.Class is null ? null : ElectoralBaseFormula.ClassLabel(t.Class), v.State,
                new Dictionary<string, object?>
                {
                    ["votes"] = v.Votes,
                    ["share"] = v.Share,
                    ["rank"] = t.Rank,
                    ["contestants"] = t.Contestants,
                    ["marginPoints"] = t.MarginPoints,
                    ["score"] = t.Score,
                });
        }).ToList();
        var legend = ElectoralBaseFormula.Classes.Select((c, i) => new MapLegendItemDto(c.Key, c.Label, i + 1)).ToList();
        var scores = features.Where(f => f.Value is not null).Select(f => f.Value!.Value).ToList();
        return new MapLayerResponse(
            q.Year, q.Round, uf, result.MunicipalityTseCode, "base", level, result.Contest.OfficeCode, features, legend,
            scores.Count > 0 ? scores.Min() : null, scores.Count > 0 ? scores.Max() : null, null,
            $"Base Eleitoral ({ElectoralBaseFormula.Version}): classe descritiva da votação em cada território, com a decomposição no painel da candidatura.",
            result.Freshness);
    }

    private async Task<Dictionary<string, ContestStatsRow>> StatsAsync(
        XrayCandidacyRow c, ContestInfo contest, string level, string? uf, string? mun, int? zone, CancellationToken ct)
    {
        var ufCode = uf ?? contest.Uf ?? throw new ElectoralBadRequestException("Disputa nacional: informe a UF (uf=).");
        var rows = await repo.ContestStatsAsync(
            new ContestStatsQuery(c.Id, c.Year, c.Round, contest.ElectionCode, contest.OfficeCode, ufCode, mun, zone, level), ct);
        return rows.ToDictionary(r => StatsKey(r, level));
    }

    private static int? RankOf(TerritoryValueDto t, Dictionary<string, ContestStatsRow> stats, string level) =>
        Lookup(t, stats, level) is { } s && Comparability.HasCount(t.State) ? s.Ahead + 1 : null;

    private static ContestStatsRow? Lookup(TerritoryValueDto t, Dictionary<string, ContestStatsRow> stats, string level) =>
        stats.GetValueOrDefault(KeyOf(t, level));

    private async Task<(XrayCandidacyRow? Previous, BaseComparisonDto? Comparison)> PreviousAsync(
        XrayCandidacyRow c, ContestInfo contest, Guid? compareTo, CancellationToken ct)
    {
        XrayCandidacyRow? previous;
        if (compareTo is { } otherId)
        {
            previous = await CandidacyAsync(otherId, ct);
        }
        else
        {
            if (c.PoliticianId is null && c.PersonId is null) return (null, null);
            var subject = await repo.SubjectCandidaciesAsync(c.PoliticianId ?? Guid.Empty, c.PersonId, ct);
            previous = subject
                .Where(s => s.Id != c.Id && (s.Year < c.Year || (s.Year == c.Year && s.Round < c.Round)))
                .Where(s => s.OfficeCode == c.OfficeCode && s.Scope == c.Scope && s.ElectoralUnit.Trim() == c.ElectoralUnit.Trim())
                .OrderByDescending(s => s.Year).ThenByDescending(s => s.Round)
                .FirstOrDefault();
            if (previous is null) return (null, null);
        }

        var comparability = Comparability.Contest(ContestInfo.From(previous), contest, previous.HasLink, c.HasLink);
        var note = comparability switch
        {
            ContestComparability.Comparable => "Mesma disputa (cargo e unidade eleitoral): variação por território quando o território é comparável.",
            ContestComparability.DifferentOffice => "Cargos diferentes: sem variação por território.",
            ContestComparability.DifferentTerritorialScope => "Unidades eleitorais diferentes: sem variação por território.",
            _ => "Sem votação apurada para comparar.",
        };
        return (previous, new BaseComparisonDto(previous.Id, previous.Year, previous.Round, comparability, note));
    }

    private static IReadOnlyList<TerritoryBaseDto> Classify(
        IReadOnlyList<TerritoryValueDto> territories, Dictionary<string, ContestStatsRow> stats, string level,
        Dictionary<string, (TerritoryValueDto Value, int? Rank)> before, XrayCandidacyRow? previous)
    {
        var counted = territories.Where(t => Comparability.HasCount(t.State) && t.Votes is not null).ToList();
        var usePercentiles = counted.Count >= ElectoralBaseFormula.MinTerritoriesForPercentiles;
        var shares = counted.Where(t => t.Share is not null).Select(t => t.Share!.Value).ToList();
        var volumes = counted.Select(t => (double)t.Votes!.Value).ToList();

        return territories.Select(t =>
        {
            var key = KeyOf(t, level);
            var s = Lookup(t, stats, level);
            var change = Change(t, key, level, before, previous);
            if (!Comparability.HasCount(t.State) || t.Votes is null || s is null)
                return new TerritoryBaseDto(key, t, null, s?.Contestants, s?.LeaderVotes, null, null, null, null, null, [], change);

            var rank = s.Ahead + 1;
            if (change?.FromRank is { } fromRank) change = change with { RankChange = fromRank - rank };
            var sharePct = usePercentiles && t.Share is { } share ? ElectoralBaseFormula.PercentRank(shares, share) : (double?)null;
            var volumePct = usePercentiles ? ElectoralBaseFormula.PercentRank(volumes, t.Votes.Value) : (double?)null;
            var leaderRatio = s.LeaderVotes > 0 ? Math.Min(1, t.Votes.Value / (double)s.LeaderVotes) : 0;
            var (score, components) = ElectoralBaseFormula.Score(
                sharePct, ElectoralBaseFormula.Position(rank, s.Contestants), leaderRatio, volumePct);
            var margin = ElectoralBaseFormula.MarginPoints(t.Votes.Value, s.LeaderVotes, s.BestOtherVotes, t.ValidVotes);
            return new TerritoryBaseDto(
                key, t, rank, s.Contestants, s.LeaderVotes, margin, sharePct, volumePct, score,
                ElectoralBaseFormula.ClassOf(score), components, change);
        }).ToList();
    }

    private static BaseChangeDto? Change(
        TerritoryValueDto t, string key, string level, Dictionary<string, (TerritoryValueDto Value, int? Rank)> before,
        XrayCandidacyRow? previous)
    {
        if (previous is null || before.Count == 0) return null;
        if (!before.TryGetValue(key, out var prior))
            return new BaseChangeDto(previous.Id, previous.Year, previous.Round, TerritoryComparability.CoverageOrSectionMissing,
                null, null, null, null, null, null, null);

        var comparability = level == "section"
            ? Comparability.SectionStatus([prior.Value.SectionMembers, t.SectionMembers])
            : Comparability.IsComplete(prior.Value.State) && Comparability.IsComplete(t.State)
                ? TerritoryComparability.Comparable
                : TerritoryComparability.CoverageOrSectionMissing;
        var comparable = comparability == TerritoryComparability.Comparable;
        var (delta, pct) = comparable ? Comparability.Delta(prior.Value.Votes, t.Votes) : (null, null);
        // a variação de posição (RankChange) é preenchida depois, com a posição atual
        return new BaseChangeDto(
            previous.Id, previous.Year, previous.Round, comparability, prior.Value.Votes, prior.Value.Share, prior.Rank,
            delta, pct, comparable ? Comparability.DeltaPoints(prior.Value.Share, t.Share) : null, null);
    }

    private static ElectoralBaseSummaryDto Summarize(IReadOnlyList<TerritoryValueDto> territories, IReadOnlyList<TerritoryBaseDto> items)
    {
        var summary = TerritoryService.Summarize(territories);
        var classes = ElectoralBaseFormula.Classes.ToDictionary(
            c => c.Key, c => items.Count(i => i.Class == c.Key));
        double? capillarity = summary.TerritoriesCovered > 0
            ? Comparability.Pct(summary.TerritoriesWithVotes, summary.TerritoriesCovered)
            : null;
        return new ElectoralBaseSummaryDto(
            summary.Votes, summary.TerritoriesCovered, summary.TerritoriesWithVotes, capillarity, summary.Hhi,
            summary.TopFiveConcentration, classes, items.Count(i => i.Rank == 1),
            items.Count(IsCompetitive), Critical(items).Count);
    }

    private static bool IsCompetitive(TerritoryBaseDto i) =>
        i.MarginPoints is { } m && Math.Abs(m) <= ElectoralBaseFormula.CompetitiveMarginPoints && i.Contestants >= 2;

    /// <summary>Territórios que sustentam metade da votação E estão apertados ou em queda relevante.</summary>
    private static List<TerritoryBaseDto> Critical(IReadOnlyList<TerritoryBaseDto> items)
    {
        var withVotes = items.Where(i => i.Territory.Votes > 0).OrderByDescending(i => i.Territory.Votes).ToList();
        var total = withVotes.Sum(i => i.Territory.Votes!.Value);
        if (total == 0) return [];
        var core = new List<TerritoryBaseDto>();
        long running = 0;
        foreach (var i in withVotes)
        {
            core.Add(i);
            running += i.Territory.Votes!.Value;
            if (running * 2 >= total) break;
        }
        return core
            .Where(i => IsCompetitive(i) || i.Change is { DeltaPercent: { } d } && d <= ElectoralBaseFormula.CriticalDeclinePercent)
            .ToList();
    }

    private static ElectoralBaseHighlightsDto Highlights(IReadOnlyList<TerritoryBaseDto> items)
    {
        const int top = 5;
        var scored = items.Where(i => i.Score is not null).ToList();
        IReadOnlyList<string> Keys(IEnumerable<TerritoryBaseDto> seq) => seq.Take(top).Select(i => i.Key).ToList();
        var changes = items.Where(i => i.Change?.DeltaVotes is not null).ToList();
        return new ElectoralBaseHighlightsDto(
            Keys(scored.OrderByDescending(i => i.Score).ThenByDescending(i => i.Territory.Votes)),
            Keys(scored.OrderBy(i => i.Score).ThenBy(i => i.Territory.Votes)),
            Keys(items.Where(IsCompetitive).OrderBy(i => Math.Abs(i.MarginPoints!.Value)).ThenByDescending(i => i.Territory.Votes)),
            Keys(scored.Where(i => i.Territory.Share is not null).OrderByDescending(i => i.Territory.Share)),
            Keys(scored.OrderByDescending(i => i.Territory.Votes)),
            Keys(changes.Where(i => i.Change!.DeltaVotes > 0).OrderByDescending(i => i.Change!.DeltaVotes)),
            Keys(changes.Where(i => i.Change!.DeltaVotes < 0).OrderBy(i => i.Change!.DeltaVotes)),
            Keys(items.Where(i => i.Rank is not null && i.Change?.FromRank is not null && i.Rank < i.Change.FromRank)
                .OrderByDescending(i => i.Change!.FromRank!.Value - i.Rank!.Value)),
            Keys(items.Where(i => i.Rank is not null && i.Change?.FromRank is not null && i.Rank > i.Change.FromRank)
                .OrderByDescending(i => i.Rank!.Value - i.Change!.FromRank!.Value)),
            Keys(Critical(items).OrderByDescending(i => i.Territory.Votes)));
    }

    private static IReadOnlyList<InsightDto> Insights(
        string level, IReadOnlyList<TerritoryBaseDto> items, ElectoralBaseSummaryDto summary, ElectoralBaseHighlightsDto h,
        XrayCandidacyRow? previous)
    {
        var insights = new List<InsightDto>();
        var byKey = items.ToDictionary(i => i.Key);
        string Label(string key) => TerritoryService.Label(byKey[key].Territory, level);
        var scored = items.Count(i => i.Score is not null);
        if (scored == 0) return insights;

        var strongholds = summary.ClassCounts.GetValueOrDefault("stronghold");
        insights.Add(new InsightDto("base_strongholds",
            new Dictionary<string, object?> { ["strongholds"] = strongholds, ["territories"] = scored, ["level"] = level },
            $"{strongholds} de {scored} {InsightEngine.LevelLabel(level, scored)} classificados como fortaleza eleitoral (fórmula {ElectoralBaseFormula.Version})."));
        insights.Add(new InsightDto("base_leading",
            new Dictionary<string, object?> { ["leading"] = summary.Leading, ["territories"] = scored },
            $"Mais votada em {summary.Leading} de {scored} {InsightEngine.LevelLabel(level, scored)}."));
        if (h.Competitive.Count > 0 && byKey[h.Competitive[0]].MarginPoints is { } margin)
            insights.Add(new InsightDto("base_tightest",
                new Dictionary<string, object?> { ["territory"] = Label(h.Competitive[0]), ["marginPoints"] = margin },
                $"Disputa mais apertada: {Label(h.Competitive[0])} ({(margin >= 0 ? "vantagem" : "desvantagem")} de {Fmt.Pct(Math.Abs(margin)).Replace("%", " p.p.", StringComparison.Ordinal)})."));
        if (previous is not null && h.Growth.Count > 0 && byKey[h.Growth[0]].Change?.DeltaVotes is { } up)
            insights.Add(new InsightDto("base_growth",
                new Dictionary<string, object?> { ["territory"] = Label(h.Growth[0]), ["deltaVotes"] = up, ["fromYear"] = previous.Year },
                $"Maior crescimento desde {Fmt.Election(previous.Year, previous.Round)}: {Label(h.Growth[0])} ({Fmt.Signed(up)} votos)."));
        if (previous is not null && h.Decline.Count > 0 && byKey[h.Decline[0]].Change?.DeltaVotes is { } down)
            insights.Add(new InsightDto("base_decline",
                new Dictionary<string, object?> { ["territory"] = Label(h.Decline[0]), ["deltaVotes"] = down, ["fromYear"] = previous.Year },
                $"Maior queda desde {Fmt.Election(previous.Year, previous.Round)}: {Label(h.Decline[0])} ({Fmt.Signed(down)} votos)."));
        if (summary.Critical > 0)
            insights.Add(new InsightDto("base_critical",
                new Dictionary<string, object?> { ["critical"] = summary.Critical },
                $"{summary.Critical} {InsightEngine.LevelLabel(level, summary.Critical)} entre os que formam metade da votação estão em disputa apertada ou em queda."));
        return insights;
    }
}
