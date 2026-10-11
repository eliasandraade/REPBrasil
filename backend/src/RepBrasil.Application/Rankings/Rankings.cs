using System.Globalization;
using RepBrasil.Application.Electoral;
using RepBrasil.Application.Interfaces;

namespace RepBrasil.Application.Rankings;

// ── Linhas do repositório ───────────────────────────────────────────────────

/// <summary>Filtros obrigatórios de um ranking: eleição (ano, turno), cargo e UF; município e partido opcionais.</summary>
public sealed record RankingFilter(int Year, int Round, int? Office, string Uf, string? MunicipalityTseCode, string? Party);

/// <summary>Métricas de uma candidatura no recorte (votos e totais vêm dos agregados derivados híbridos do BU).</summary>
public sealed class RankingCandidacyRow
{
    public Guid CandidacyId { get; init; }
    public Guid? PoliticianId { get; init; }
    public string? Slug { get; init; }
    public string BallotName { get; init; } = string.Empty;
    public string? PartyAcronym { get; init; }
    public int? PartyNumber { get; init; }
    public bool? Elected { get; init; }
    public string? RoundOutcome { get; init; }
    public int OfficeCode { get; init; }
    public string OfficeName { get; init; } = string.Empty;
    public string Scope { get; init; } = string.Empty;
    public string ElectoralUnit { get; init; } = string.Empty;
    public string? UnitName { get; init; }
    public bool HasLink { get; init; }
    /// <summary>Votos no recorte (null = sem vínculo auditado com o BU).</summary>
    public long? Votes { get; init; }
    /// <summary>Votos válidos do cargo na unidade da disputa ∩ recorte.</summary>
    public long? ValidVotes { get; init; }
    public int MunicipalitiesWithVotes { get; init; }
    public int MunicipalitiesCovered { get; init; }
    public int MunicipalitiesLed { get; init; }
    public double? Hhi { get; init; }
    public decimal? Assets { get; init; }
    public decimal? Revenue { get; init; }
    public decimal? ExpenseContracted { get; init; }
    public decimal? ExpensePaid { get; init; }
    public Guid? PreviousCandidacyId { get; init; }
    public short? PreviousYear { get; init; }
    public short? PreviousRound { get; init; }
    public long? PreviousVotes { get; init; }
    public decimal? PreviousAssets { get; init; }
    public short? PreviousAssetsYear { get; init; }
}

/// <summary>Cobertura do BU de um cargo por município e eleição: zonas com BU ÷ zonas do cadastro.</summary>
public sealed class RankingCoverageRow
{
    public short Year { get; init; }
    public short Round { get; init; }
    public string MunicipalityTseCode { get; init; } = string.Empty;
    public int ZonesExpected { get; init; }
    public int ZonesCovered { get; init; }
}

public sealed class RankingPartyRow
{
    public int PartyNumber { get; init; }
    public string? PartyAcronym { get; init; }
    public long NominalVotes { get; init; }
    public long LegendVotes { get; init; }
    public long ValidVotes { get; init; }
    public int Candidacies { get; init; }
    public int Elected { get; init; }
    public int MunicipalitiesWithVotes { get; init; }
}

public sealed class RankingRecurrenceRow
{
    public Guid SubjectId { get; init; }
    public Guid? PoliticianId { get; init; }
    public string? Slug { get; init; }
    public string Name { get; init; } = string.Empty;
    public int Candidacies { get; init; }
    public int ElectedCount { get; init; }
    public short FirstYear { get; init; }
    public short LastYear { get; init; }
    public string Offices { get; init; } = string.Empty;
}

public interface IRankingRepository
{
    Task<IReadOnlyList<RankingCandidacyRow>> CandidaciesAsync(RankingFilter filter, CancellationToken ct);

    /// <summary>Cobertura do cargo em todas as eleições importadas, por município do recorte.</summary>
    Task<IReadOnlyList<RankingCoverageRow>> CoverageAsync(int office, string uf, string? municipalityTseCode, CancellationToken ct);

    Task<IReadOnlyList<RankingPartyRow>> PartiesAsync(RankingFilter filter, bool includeLegend, CancellationToken ct);

    Task<IReadOnlyList<RankingRecurrenceRow>> RecurrenceAsync(string uf, int? office, CancellationToken ct);
}

// ── Contrato da API ─────────────────────────────────────────────────────────

public record RankingKindDto(
    string Key, string Label, string Unit, string Definition, IReadOnlyList<string> Requires, string Comparability, string Source);

public record RankingItemDto(
    int Position, string EntityKind, Guid? CandidacyId, Guid? PoliticianId, string? Slug, string Name, string? Party,
    string? Unit, bool? Elected, double Value, string ValueText, IReadOnlyDictionary<string, object?> Details);

public record RankingCoverageDto(int ZonesCovered, int ZonesExpected, bool Complete, string Note);

public record RankingResponse(
    RankingKindDto Kind, RankingFilterDto Filters, IReadOnlyList<RankingItemDto> Items, int Total, int Excluded,
    string ExcludedNote, int Page, int PageSize, RankingCoverageDto? Coverage, string Methodology, DerivedFreshnessDto? Freshness);

public record RankingFilterDto(int? Year, int? Round, int? Office, string Uf, string? Municipality, string? Party);

// ── Serviço ─────────────────────────────────────────────────────────────────

/// <summary>
/// Rankings determinísticos. Cada tipo declara o que mede, os filtros obrigatórios e a regra de comparabilidade;
/// o serviço recusa (400) recortes que comparariam disputas incompatíveis. Métrica ausente nunca vira zero: a
/// candidatura fica fora do ranking e entra na contagem de excluídas, com o motivo.
/// </summary>
public class RankingService(IRankingRepository repo, IElectoralXrayRepository xray)
{
    public const int MaxPageSize = 100;

    /// <summary>Cargos com voto de legenda (eleição proporcional): força partidária soma nominais + legenda.</summary>
    public static readonly IReadOnlySet<int> ProportionalOffices = new HashSet<int> { 6, 7, 8, 13 };

    private const string Bu = "TSE — Boletins de Urna (agregados por zona × cargo)";
    private const string Candidates = "TSE — Candidatos (consulta_cand)";

    public static readonly IReadOnlyList<RankingKindDto> Kinds =
    [
        new("votes", "Mais votados", "votos", "votos nominais da candidatura no recorte (UF ou município)",
            ["year", "round", "office", "uf"], "mesma disputa: cargos municipais exigem o município (cada município é uma disputa)", Bu),
        new("share", "Maior participação", "% dos válidos", "votos ÷ votos válidos do cargo na unidade da própria disputa, dentro do recorte",
            ["year", "round", "office", "uf"], "percentual da própria disputa: comparável entre municípios do mesmo cargo", Bu),
        new("growth", "Maior crescimento", "votos", "votos atuais − votos da candidatura anterior da mesma pessoa na MESMA disputa (cargo + unidade), no mesmo recorte",
            ["year", "round", "office", "uf"], "só disputas iguais com cobertura completa nas duas eleições; cargos municipais sem município ordenam pela variação %", Bu),
        new("decline", "Maior queda", "votos", "votos atuais − votos da candidatura anterior da mesma pessoa na MESMA disputa, no mesmo recorte",
            ["year", "round", "office", "uf"], "mesma regra do crescimento", Bu),
        new("capillarity", "Capilaridade", "% dos municípios", "municípios com pelo menos um voto ÷ municípios com BU do cargo no recorte",
            ["year", "round", "office", "uf"], "só cargos estaduais e federais (disputa com vários municípios)", Bu),
        new("concentration", "Concentração", "HHI", "índice de Herfindahl-Hirschman da votação entre municípios (0–10.000; maior = mais concentrada)",
            ["year", "round", "office", "uf"], "só cargos estaduais e federais", Bu),
        new("territorial_strength", "Força territorial", "municípios", "municípios do recorte em que a candidatura foi a mais votada da disputa",
            ["year", "round", "office", "uf"], "só cargos estaduais e federais", Bu),
        new("assets", "Patrimônio declarado", "R$", "soma dos bens declarados ao TSE na candidatura (valor declarado, não avaliado)",
            ["year", "round", "uf"], "valor declarado; não é avaliação patrimonial nem indício de irregularidade", "TSE — Bens de candidatos"),
        new("asset_growth", "Crescimento patrimonial declarado", "R$", "bens declarados atuais − bens declarados na candidatura anterior da mesma pessoa (qualquer cargo)",
            ["year", "round", "uf"], "valores nominais (sem correção monetária); declarações de anos diferentes", "TSE — Bens de candidatos"),
        new("revenue", "Arrecadação", "R$", "receitas da prestação de contas da candidatura",
            ["year", "round", "uf"], "contas parciais da eleição em curso podem mudar", "TSE — Prestação de Contas Eleitorais"),
        new("spending", "Gastos", "R$", "despesas contratadas da prestação de contas da candidatura",
            ["year", "round", "uf"], "contas parciais da eleição em curso podem mudar", "TSE — Prestação de Contas Eleitorais"),
        new("votes_per_real", "Votos por real gasto", "votos/R$", "votos no recorte ÷ despesas contratadas (só candidaturas com despesa > 0)",
            ["year", "round", "office", "uf"], "mesma disputa: cargos municipais exigem o município; razão descritiva, não mede eficiência nem legalidade",
            Bu + " + Prestação de Contas"),
        new("parties", "Partidos mais votados", "votos", "votos do partido no cargo: nominais + legenda (proporcional) ou nominais (majoritário)",
            ["year", "round", "office", "uf"], "um cargo por vez; cargos municipais sem município somam as disputas municipais do mesmo cargo na UF", Bu),
        new("recurrence", "Recorrência", "candidaturas", "candidaturas da mesma pessoa (ou perfil) nas eleições importadas da UF",
            ["uf"], "conta só eleições importadas; sem pessoa ou perfil vinculado a candidatura conta isolada", Candidates),
    ];

    public static RankingKindDto Kind(string key) =>
        Kinds.FirstOrDefault(k => k.Key == (key ?? "").Trim().ToLowerInvariant())
        ?? throw new ElectoralBadRequestException($"kind deve ser um de: {string.Join(", ", Kinds.Select(k => k.Key))}.");

    private static string Uf(string? uf)
    {
        var value = (uf ?? "").Trim().ToUpperInvariant();
        if (value.Length != 2 || !value.All(char.IsAsciiLetter)) throw new ElectoralBadRequestException("uf é obrigatória (duas letras).");
        return value;
    }

    private static string? Municipality(string? code)
    {
        if (string.IsNullOrWhiteSpace(code)) return null;
        var value = code.Trim();
        if (value.Length > 5 || !value.All(char.IsAsciiDigit))
            throw new ElectoralBadRequestException("municipality deve ser o código TSE (até 5 dígitos).");
        return value.PadLeft(5, '0');
    }

    private static bool IsMunicipalOffice(int office) => office is 11 or 12 or 13;

    public async Task<RankingResponse> RankAsync(
        string kind, int? year, int? round, int? office, string? uf, string? municipality, string? party, int page, int pageSize,
        CancellationToken ct)
    {
        var k = Kind(kind);
        var ufCode = Uf(uf);
        var mun = Municipality(municipality);
        var p = string.IsNullOrWhiteSpace(party) ? null : party.Trim();
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize <= 0 ? 50 : pageSize, 1, MaxPageSize);
        if (page > 10_000) throw new ElectoralBadRequestException("page fora do intervalo.");
        var filters = new RankingFilterDto(year, round, office, ufCode, mun, p);

        if (k.Key == "recurrence")
        {
            var recurrence = await repo.RecurrenceAsync(ufCode, office, ct);
            var items = recurrence
                .Select(r => (Row: r, Value: (double)r.Candidacies))
                .OrderByDescending(x => x.Value).ThenByDescending(x => x.Row.ElectedCount).ThenBy(x => x.Row.Name, StringComparer.Ordinal)
                .ToList();
            var ranked = Positions(items.Select(x => x.Value).ToList());
            var pageItems = items.Select((x, i) => (x, i)).Skip((page - 1) * pageSize).Take(pageSize)
                .Select(t => new RankingItemDto(
                    ranked[t.i], "person", null, t.x.Row.PoliticianId, t.x.Row.Slug, Fmt.Name(t.x.Row.Name), null, null, null, t.x.Value,
                    $"{t.x.Row.Candidacies} candidatura{(t.x.Row.Candidacies == 1 ? "" : "s")}",
                    new Dictionary<string, object?>
                    {
                        ["electedCount"] = t.x.Row.ElectedCount,
                        ["firstYear"] = t.x.Row.FirstYear,
                        ["lastYear"] = t.x.Row.LastYear,
                        ["offices"] = t.x.Row.Offices,
                    }))
                .ToList();
            return new RankingResponse(k, filters, pageItems, items.Count, 0, "", page, pageSize, null, Methodology(k), null);
        }

        if (year is null || round is null) throw new ElectoralBadRequestException("year e round são obrigatórios.");
        if (k.Requires.Contains("office") && office is null) throw new ElectoralBadRequestException("office (código do cargo) é obrigatório neste ranking.");
        if (office is { } o && Comparability.IsTicketMember(o))
            throw new ElectoralBadRequestException("Vice e suplente são votados na chapa: escolha o cargo do titular.");
        if (office is { } mo && IsMunicipalOffice(mo) && mun is null && k.Key is "votes" or "votes_per_real")
            throw new ElectoralBadRequestException(
                "Cargos municipais são disputas diferentes em cada município: informe o município (municipality) ou use o ranking de participação (share).");
        if (office is { } so && IsMunicipalOffice(so) && k.Key is "capillarity" or "concentration" or "territorial_strength")
            throw new ElectoralBadRequestException("Capilaridade, concentração e força territorial medem a distribuição entre municípios: só cargos estaduais e federais.");

        var freshness = XrayService.Freshness(await xray.FreshnessAsync(ct));
        RankingCoverageDto? coverage = null;
        Dictionary<(int Year, int Round, string Mun), RankingCoverageRow> coverageByMun = [];
        if (office is { } co)
        {
            coverageByMun = (await repo.CoverageAsync(co, ufCode, mun, ct)).ToDictionary(c => ((int)c.Year, (int)c.Round, c.MunicipalityTseCode));
            var current = coverageByMun.Values.Where(c => c.Year == year && c.Round == round).ToList();
            var expected = current.Sum(c => c.ZonesExpected);
            var covered = current.Sum(c => c.ZonesCovered);
            var complete = expected > 0 && covered >= expected;
            coverage = new RankingCoverageDto(covered, expected, complete,
                covered == 0
                    ? "Sem Boletim de Urna importado para este cargo no recorte."
                    : complete ? "Cobertura completa do Boletim de Urna no recorte."
                    : $"Cobertura parcial: {covered} de {expected} zonas com Boletim de Urna. Valores de votação são parciais.");
            if (covered == 0 && k.Source.StartsWith(Bu, StringComparison.Ordinal))
                return new RankingResponse(k, filters, [], 0, 0, coverage.Note, page, pageSize, coverage, Methodology(k), freshness);
        }

        if (k.Key == "parties")
        {
            var parties = await repo.PartiesAsync(
                new RankingFilter(year.Value, round.Value, office, ufCode, mun, p), ProportionalOffices.Contains(office!.Value), ct);
            var list = parties.Where(r => r.NominalVotes + r.LegendVotes > 0)
                .Select(r => (Row: r, Value: (double)(r.NominalVotes + r.LegendVotes)))
                .OrderByDescending(x => x.Value).ThenBy(x => x.Row.PartyNumber).ToList();
            var positions = Positions(list.Select(x => x.Value).ToList());
            var items = list.Select((x, i) => (x, i)).Skip((page - 1) * pageSize).Take(pageSize)
                .Select(t => new RankingItemDto(
                    positions[t.i], "party", null, null, null, t.x.Row.PartyAcronym ?? t.x.Row.PartyNumber.ToString(CultureInfo.InvariantCulture),
                    t.x.Row.PartyAcronym, null, null, t.x.Value, $"{Fmt.Int((long)t.x.Value)} votos",
                    new Dictionary<string, object?>
                    {
                        ["partyNumber"] = t.x.Row.PartyNumber,
                        ["nominalVotes"] = t.x.Row.NominalVotes,
                        ["legendVotes"] = ProportionalOffices.Contains(office!.Value) ? t.x.Row.LegendVotes : null,
                        ["share"] = Comparability.Pct((long)t.x.Value, t.x.Row.ValidVotes),
                        ["candidacies"] = t.x.Row.Candidacies,
                        ["elected"] = t.x.Row.Elected,
                        ["municipalitiesWithVotes"] = t.x.Row.MunicipalitiesWithVotes,
                    }))
                .ToList();
            return new RankingResponse(k, filters, items, list.Count, 0, "", page, pageSize, coverage, Methodology(k), freshness);
        }

        var rows = (await repo.CandidaciesAsync(new RankingFilter(year.Value, round.Value, office, ufCode, mun, p), ct))
            .Where(r => !Comparability.IsTicketMember(r.OfficeCode))
            .ToList();
        var useGrowthPercent = office is { } go && IsMunicipalOffice(go) && mun is null;
        // Variação só com cobertura completa nas DUAS eleições, no território da própria disputa.
        bool Complete(RankingCandidacyRow r, int y, int rd)
        {
            var muns = coverageByMun.Values
                .Where(c => c.Year == y && c.Round == rd && (r.Scope != "municipal" || c.MunicipalityTseCode == r.ElectoralUnit))
                .ToList();
            return muns.Count > 0 && muns.All(c => c.ZonesExpected > 0 && c.ZonesCovered >= c.ZonesExpected);
        }
        var metric = rows.Select(r =>
        {
            var comparable = r.PreviousYear is { } py && r.PreviousRound is { } pr && Complete(r, py, pr) && Complete(r, year.Value, round.Value);
            return (Row: r, Metric: Metric(k.Key, r, useGrowthPercent, comparable));
        }).ToList();
        var included = metric.Where(x => x.Metric is not null).Select(x => (x.Row, Value: x.Metric!.Value)).ToList();
        var excluded = metric.Count - included.Count;
        var ordered = included.OrderByDescending(x => x.Value)
            .ThenByDescending(x => x.Row.Votes ?? -1).ThenBy(x => x.Row.BallotName, StringComparer.Ordinal).ThenBy(x => x.Row.CandidacyId)
            .ToList();
        var pos = Positions(ordered.Select(x => x.Value).ToList());
        var pageRows = ordered.Select((x, i) => (x, i)).Skip((page - 1) * pageSize).Take(pageSize)
            .Select(t => Item(k.Key, pos[t.i], t.x.Row, t.x.Value, useGrowthPercent))
            .ToList();
        return new RankingResponse(
            k, filters, pageRows, ordered.Count, excluded, ExcludedNote(k.Key, excluded), page, pageSize, coverage, Methodology(k), freshness);
    }

    /// <summary>Posição de competição: empates dividem a posição (1, 2, 2, 4).</summary>
    public static IReadOnlyList<int> Positions(IReadOnlyList<double> sortedValues)
    {
        var positions = new int[sortedValues.Count];
        for (var i = 0; i < sortedValues.Count; i++)
            positions[i] = i > 0 && sortedValues[i] == sortedValues[i - 1] ? positions[i - 1] : i + 1;
        return positions;
    }

    /// <summary>Valor do ranking; null = fora do ranking (nunca zero por ausência).</summary>
    public static double? Metric(string kind, RankingCandidacyRow r, bool growthPercent, bool previousComparable = false)
    {
        bool StateWide() => r.Scope is "state" or "federal";
        switch (kind)
        {
            case "votes":
                return r.HasLink && r.Votes is { } v ? v : null;
            case "share":
                return r.HasLink && r.Votes is { } sv && Comparability.Pct(sv, r.ValidVotes) is { } share ? share : null;
            case "growth" or "decline":
                {
                    if (!r.HasLink || r.Votes is not { } now || r.PreviousVotes is not { } before || !previousComparable) return null;
                    var delta = now - before;
                    if (kind == "growth" && delta <= 0) return null;
                    if (kind == "decline" && delta >= 0) return null;
                    if (growthPercent) return before > 0 ? Math.Round(delta * 100.0 / before, 2, MidpointRounding.AwayFromZero) : null;
                    return kind == "decline" ? -delta : delta;
                }
            case "capillarity":
                return StateWide() && r.HasLink && r.MunicipalitiesCovered > 0 && r.Votes is not null
                    ? Comparability.Pct(r.MunicipalitiesWithVotes, r.MunicipalitiesCovered)
                    : null;
            case "concentration":
                return StateWide() && r.HasLink && r.Votes is > 0 ? r.Hhi : null;
            case "territorial_strength":
                return StateWide() && r.HasLink && r.Votes is > 0 && r.MunicipalitiesLed > 0 ? r.MunicipalitiesLed : null;
            case "assets":
                return r.Assets is { } a ? (double)a : null;
            case "asset_growth":
                return r.Assets is { } now2 && r.PreviousAssets is { } before2 ? (double)(now2 - before2) : null;
            case "revenue":
                return r.Revenue is { } rev ? (double)rev : null;
            case "spending":
                return r.ExpenseContracted is { } exp ? (double)exp : null;
            case "votes_per_real":
                return r.HasLink && r.Votes is { } vv && r.ExpenseContracted is > 0 ? Math.Round(vv / (double)r.ExpenseContracted.Value, 4) : null;
            default:
                throw new ElectoralBadRequestException($"ranking {kind} não se aplica a candidaturas.");
        }
    }

    private static RankingItemDto Item(string kind, int position, RankingCandidacyRow r, double value, bool growthPercent)
    {
        var details = new Dictionary<string, object?>
        {
            ["office"] = r.OfficeName,
            ["votes"] = r.HasLink ? r.Votes : null,
            ["share"] = r.HasLink && r.Votes is { } v ? Comparability.Pct(v, r.ValidVotes) : null,
            ["outcome"] = r.RoundOutcome is null ? null : Fmt.Outcome(r.RoundOutcome),
        };
        string text;
        switch (kind)
        {
            case "votes":
                text = $"{Fmt.Int((long)value)} votos";
                break;
            case "share":
                text = Fmt.Pct(value);
                break;
            case "growth" or "decline":
                details["previousCandidacyId"] = r.PreviousCandidacyId;
                details["previousYear"] = r.PreviousYear;
                details["previousVotes"] = r.PreviousVotes;
                details["deltaVotes"] = r.Votes - r.PreviousVotes;
                text = growthPercent
                    ? Fmt.SignedPct(value)
                    : $"{Fmt.Signed(kind == "decline" ? -(long)value : (long)value)} votos desde {r.PreviousYear}";
                break;
            case "capillarity":
                details["municipalitiesWithVotes"] = r.MunicipalitiesWithVotes;
                details["municipalitiesCovered"] = r.MunicipalitiesCovered;
                text = $"{Fmt.Pct(value)} ({r.MunicipalitiesWithVotes} de {r.MunicipalitiesCovered} municípios)";
                break;
            case "concentration":
                text = $"HHI {value.ToString("N0", CultureInfo.GetCultureInfo("pt-BR"))}";
                break;
            case "territorial_strength":
                details["municipalitiesCovered"] = r.MunicipalitiesCovered;
                text = $"mais votada em {(int)value} município{((int)value == 1 ? "" : "s")}";
                break;
            case "assets":
                text = Fmt.Money((decimal)value);
                break;
            case "asset_growth":
                details["previousAssets"] = r.PreviousAssets;
                details["previousAssetsYear"] = r.PreviousAssetsYear;
                text = $"{Fmt.SignedMoney((decimal)value)} desde {r.PreviousAssetsYear}";
                break;
            case "revenue" or "spending":
                details["expensePaid"] = r.ExpensePaid;
                text = Fmt.Money((decimal)value);
                break;
            default: // votes_per_real
                details["expenseContracted"] = r.ExpenseContracted;
                text = $"{value.ToString("0.####", CultureInfo.GetCultureInfo("pt-BR"))} votos por real";
                break;
        }

        return new RankingItemDto(
            position, "candidacy", r.CandidacyId, r.PoliticianId, r.Slug, r.BallotName, r.PartyAcronym, r.UnitName, r.Elected, value,
            text, details);
    }

    private static string ExcludedNote(string kind, int excluded) => excluded == 0 ? "" : kind switch
    {
        "votes" or "share" or "votes_per_real" => $"{excluded} candidatura(s) fora do ranking: sem vínculo auditado com o Boletim de Urna ou sem despesa declarada (nunca contadas como zero).",
        "growth" or "decline" => $"{excluded} candidatura(s) fora: sem candidatura anterior na mesma disputa, sem cobertura completa nas duas eleições ou variação no outro sentido.",
        "assets" or "asset_growth" => $"{excluded} candidatura(s) fora: sem bens declarados (ou sem declaração anterior para comparar).",
        "revenue" or "spending" => $"{excluded} candidatura(s) fora: prestação de contas não importada ou sem lançamentos.",
        _ => $"{excluded} candidatura(s) fora do ranking por falta do dado (nunca contadas como zero).",
    };

    private static string Methodology(RankingKindDto k) =>
        $"{k.Label}: {k.Definition}. Comparabilidade: {k.Comparability}. Fonte: {k.Source}. Empates dividem a posição. "
        + "Ranking descreve dados oficiais; não é avaliação, recomendação ou previsão.";
}
