using RepBrasil.Application.Interfaces;

namespace RepBrasil.Application.Electoral;

public sealed record CandidatesQuery(
    int Year, int Round, string Uf, string? Municipality, int? Zone, int? Office, string? Party, string? Q,
    string? Status, bool? Elected, long? MinVotes, string? Sort, string? Dir, int Page, int PageSize);

public sealed record MapQuery(
    int Year, int Round, string Uf, string Layer, int? Office, Guid? Candidacy, Guid? Base, Guid? A, Guid? B,
    string? Municipality);

/// <summary>
/// Leituras territoriais: distribuição de uma candidatura, bens, contas, lista de candidaturas
/// de um território e camadas temáticas do mapa. Valores sempre vêm dos fatos/agregados oficiais;
/// cores e paletas ficam no frontend (sem cor de partido).
/// </summary>
public class TerritoryService(IElectoralXrayRepository repo)
{
    public const int MaxPageSize = 200;

    public static readonly IReadOnlyDictionary<string, string> Definitions = new Dictionary<string, string>
    {
        ["votes"] = "fato: votos da candidatura nos Boletins de Urna vigentes do território",
        ["validVotes"] = "votos válidos (nominais + legenda) do mesmo cargo no território",
        ["share"] = "métrica derivada: votos ÷ votos válidos do cargo no território",
        ["topFiveConcentration"] = "parte da votação da candidatura nos 5 territórios com mais votos",
        ["hhi"] = "índice de concentração de Herfindahl-Hirschman da votação da candidatura entre territórios (0–10.000)",
        ["section"] = "seção = UF + município + zona + número; urnas agregadas carregam a seção principal e as agregadas (sectionMembers)",
        ["state"] = "zero só é afirmado com BU do cargo no território e vínculo auditado; ausência de cobertura, fora da disputa ou fora da urna nunca viram zero",
    };

    public static string ParseLevel(string? level, params string[] allowed)
    {
        var value = (level ?? allowed[0]).Trim().ToLowerInvariant() switch
        {
            "estado" or "uf" or "state" => "state",
            "municipio" or "município" or "municipality" => "municipality",
            "zona" or "zone" => "zone",
            "secao" or "seção" or "section" or "urna" => "section",
            "local" or "place" or "polling_place" => "place",
            var other => other,
        };
        if (!allowed.Contains(value))
            throw new ElectoralBadRequestException($"level deve ser um de: {string.Join(", ", allowed)}.");
        return value;
    }

    private static string Uf(string uf)
    {
        var value = uf.Trim().ToUpperInvariant();
        if (value.Length != 2 || !value.All(char.IsLetter)) throw new ElectoralBadRequestException("UF inválida.");
        return value;
    }

    private static string? Municipality(string? code)
    {
        if (string.IsNullOrWhiteSpace(code)) return null;
        var value = code.Trim();
        if (value.Length > 5 || !value.All(char.IsDigit))
            throw new ElectoralBadRequestException("município deve ser o código TSE (até 5 dígitos).");
        return value.PadLeft(5, '0');
    }

    private async Task<XrayCandidacyRow> CandidacyAsync(Guid id, CancellationToken ct) =>
        (await repo.CandidaciesAsync([id], ct)).FirstOrDefault()
        ?? throw new ElectoralNotFoundException($"Candidatura {id} não encontrada.");

    // ── Distribuição ─────────────────────────────────────────────────────────

    public async Task<CandidacyTerritoryResponse> DistributionAsync(
        Guid candidacyId, string? level, string? uf, string? municipality, int? zone, CancellationToken ct)
    {
        var lvl = ParseLevel(level, "municipality", "zone", "section", "place");
        var c = await CandidacyAsync(candidacyId, ct);
        var contest = ContestInfo.From(c);
        var mun = Municipality(municipality) ?? (contest.Scope == "municipal" ? contest.ElectoralUnit : null);
        var ufCode = uf is null ? contest.Uf : Uf(uf);
        if (lvl is "section" or "place" && (mun is null || ufCode is null))
            throw new ElectoralBadRequestException("Seção e local de votação exigem UF e município.");

        var territories = lvl is "section" or "place"
            ? await SectionTerritoriesAsync(c, contest, lvl, ufCode!, mun!, zone, ct)
            : await ZoneTerritoriesAsync(c, contest, lvl, ufCode, mun, zone, ct);
        var summary = Summarize(territories);
        var insights = DistributionInsights(lvl, territories, summary, BaseOf(contest, mun, zone, territories));
        return new CandidacyTerritoryResponse(
            c.Id, contest.ToDto(), lvl, mun, zone, territories, summary, insights,
            XrayService.Freshness(await repo.FreshnessAsync(ct)), Definitions);
    }

    private async Task<IReadOnlyList<TerritoryValueDto>> ZoneTerritoriesAsync(
        XrayCandidacyRow c, ContestInfo contest, string level, string? uf, string? mun, int? zone, CancellationToken ct)
    {
        var index = new VoteIndex(
            await repo.ZoneVotesAsync([c.Id], uf, mun, ct),
            await repo.ZoneTotalsAsync([contest.CoverageKey], uf, mun, ct),
            await repo.ExpectedZonesAsync([(contest.Year, contest.Round)], uf, mun, ct));
        var names = await NamesAsync(index, contest, ct);
        var keys = new HashSet<(string Uf, string Mun, int Zone)>();
        foreach (var e in index.Expected(contest.Year, contest.Round)) keys.Add((e.Uf, e.MunicipalityTseCode, e.Zone));
        foreach (var t in index.Totals(contest.CoverageKey)) keys.Add((t.Uf, t.MunicipalityTseCode, t.Zone));
        var scoped = keys.Where(k => contest.Contains(k.Uf, k.Mun) && (zone is null || k.Zone == zone));
        var grouped = level == "zone"
            ? scoped.Select(k => (k.Uf, k.Mun, (int?)k.Zone)).Distinct()
            : scoped.Select(k => (k.Uf, k.Mun, (int?)null)).Distinct();
        return grouped
            .Select(k =>
            {
                var agg = index.Aggregate(c, new TerritoryFilter(k.Uf, k.Mun, k.Item3 ?? zone));
                var name = names.GetValueOrDefault((k.Uf, k.Mun));
                return new TerritoryValueDto(
                    k.Uf, k.Mun, name?.Name ?? k.Mun, k.Item3, null, null, null, null, null, null,
                    agg.Votes, agg.ZonesCovered > 0 ? agg.ValidVotes : null, agg.Share, agg.Eligible, agg.Turnout, agg.Urns,
                    agg.State);
            })
            .OrderByDescending(t => t.Votes ?? -1).ThenBy(t => t.MunicipalityName).ThenBy(t => t.Zone)
            .ToList();
    }

    private async Task<Dictionary<(string, string), MunicipalityRefRow>> NamesAsync(VoteIndex index, ContestInfo contest, CancellationToken ct)
    {
        var ufs = index.Expected(contest.Year, contest.Round).Select(e => e.Uf)
            .Concat(index.Totals(contest.CoverageKey).Select(t => t.Uf)).Distinct().ToList();
        var names = new Dictionary<(string, string), MunicipalityRefRow>();
        foreach (var u in ufs)
            foreach (var m in await repo.MunicipalitiesAsync(u, ct))
                names[(m.Uf, m.TseCode)] = m;
        return names;
    }

    private async Task<IReadOnlyList<TerritoryValueDto>> SectionTerritoriesAsync(
        XrayCandidacyRow c, ContestInfo contest, string level, string uf, string mun, int? zone, CancellationToken ct)
    {
        var inContest = contest.Covers(uf, mun);
        var results = inContest ? await repo.SectionResultsAsync([contest.CoverageKey], uf, mun, zone, ct) : [];
        var votes = inContest ? await repo.SectionVotesAsync([c.Id], uf, mun, zone, ct) : [];
        var byResult = votes.GroupBy(v => v.ResultId).ToDictionary(g => g.Key, g => g.Sum(v => v.Votes));
        var places = (await repo.PlacesAsync([(contest.Year, contest.Round)], uf, mun, zone, ct))
            .ToDictionary(p => (p.Zone, p.Code));
        // nome de referência do município (o BU publica em caixa alta), como na comparação
        var munName = (await repo.MunicipalitiesAsync(uf, ct)).FirstOrDefault(m => m.TseCode == mun)?.Name;
        var ticket = Comparability.IsTicketMember(c.OfficeCode);
        var notOnBallot = Comparability.NotOnBallot(c.InsertedInUrn);

        string State(long v) => Comparability.Cell(inContest, Comparability.Coverage.Full, ticket, notOnBallot, c.HasLink, v);

        if (level == "section")
        {
            return results
                .Select(r =>
                {
                    var v = byResult.GetValueOrDefault(r.ResultId);
                    var state = State(v);
                    var place = r.PollingPlaceCode is null ? null : places.GetValueOrDefault((r.Zone, r.PollingPlaceCode));
                    long? count = Comparability.HasCount(state) ? v : null;
                    return new TerritoryValueDto(
                        r.Uf, r.MunicipalityTseCode, munName ?? r.MunicipalityName, r.Zone, r.Section, r.SectionMembers.OrderBy(x => x).ToList(),
                        r.PollingPlaceCode, place?.Name, place?.Latitude, place?.Longitude, count, r.ValidVotes,
                        count is { } n ? Comparability.Pct(n, r.ValidVotes) : null, r.Eligible, r.Turnout, 1, state);
                })
                .OrderByDescending(t => t.Votes ?? -1).ThenBy(t => t.Zone).ThenBy(t => t.Section)
                .ToList();
        }

        return results
            .GroupBy(r => (r.Uf, r.MunicipalityTseCode, r.MunicipalityName, r.Zone, r.PollingPlaceCode))
            .Select(g =>
            {
                var v = g.Sum(r => byResult.GetValueOrDefault(r.ResultId));
                var state = State(v);
                var valid = g.Sum(r => r.ValidVotes);
                var place = g.Key.PollingPlaceCode is null ? null : places.GetValueOrDefault((g.Key.Zone, g.Key.PollingPlaceCode));
                long? count = Comparability.HasCount(state) ? v : null;
                long? eligible = g.All(r => r.Eligible is not null) ? g.Sum(r => (long)r.Eligible!.Value) : null;
                long? turnout = g.All(r => r.Turnout is not null) ? g.Sum(r => (long)r.Turnout!.Value) : null;
                return new TerritoryValueDto(
                    g.Key.Uf, g.Key.MunicipalityTseCode, munName ?? g.Key.MunicipalityName, g.Key.Zone, null,
                    g.SelectMany(r => r.SectionMembers).Distinct().OrderBy(x => x).ToList(), g.Key.PollingPlaceCode, place?.Name,
                    place?.Latitude, place?.Longitude, count, valid, count is { } n ? Comparability.Pct(n, valid) : null,
                    eligible, turnout, g.Count(), state);
            })
            .OrderByDescending(t => t.Votes ?? -1).ThenBy(t => t.Zone).ThenBy(t => t.PlaceCode)
            .ToList();
    }

    public static DistributionSummaryDto Summarize(IReadOnlyList<TerritoryValueDto> territories)
    {
        var counted = territories.Where(t => Comparability.HasCount(t.State) && t.Votes is not null).ToList();
        var total = counted.Sum(t => t.Votes!.Value);
        if (counted.Count == 0)
            return new DistributionSummaryDto(null, 0, 0, null, null, null, null, null);
        var ordered = counted.OrderByDescending(t => t.Votes).ToList();
        double? top5 = total > 0 ? Comparability.Pct(ordered.Take(5).Sum(t => t.Votes!.Value), total) : null;
        double? hhi = total > 0
            ? Math.Round(counted.Sum(t => Math.Pow(t.Votes!.Value * 100.0 / total, 2)), 2, MidpointRounding.AwayFromZero)
            : null;
        var complete = counted.Where(t => Comparability.IsComplete(t.State)).ToList();
        return new DistributionSummaryDto(
            total, counted.Count(t => t.Votes > 0), counted.Count, top5, hhi, ordered[0],
            complete.Count > 0 ? complete.OrderBy(t => t.Votes).ThenBy(t => t.MunicipalityName).First() : null,
            counted.Where(t => t.Share is not null).OrderByDescending(t => t.Share).FirstOrDefault());
    }

    private static string Label(TerritoryValueDto t, string level) => level switch
    {
        "zone" => $"{t.MunicipalityName} · zona {t.Zone}",
        "section" => $"{t.MunicipalityName} · zona {t.Zone} · seção {t.Section}",
        "place" => $"{t.PlaceName ?? $"local {t.PlaceCode}"} (zona {t.Zone})",
        _ => t.MunicipalityName ?? t.MunicipalityTseCode ?? t.Uf,
    };

    /// <summary>
    /// Base dos percentuais: a votação inteira só quando o recorte é a disputa toda, com cobertura completa;
    /// um município ou zona escolhidos são o recorte; disputa nacional ou território sem BU, os votos importados.
    /// </summary>
    private static DistributionBase BaseOf(ContestInfo contest, string? mun, int? zone, IReadOnlyList<TerritoryValueDto> territories)
    {
        var whole = zone is null && (contest.Scope == "municipal" ? mun == contest.ElectoralUnit : mun is null);
        if (!whole) return DistributionBase.Shown;
        if (contest.Scope == "federal" || territories.Any(t => t.State is CellState.PartialCoverage or CellState.NoCoverage))
            return DistributionBase.Imported;
        return DistributionBase.Candidacy;
    }

    private static IReadOnlyList<InsightDto> DistributionInsights(
        string level, IReadOnlyList<TerritoryValueDto> territories, DistributionSummaryDto summary, DistributionBase of)
    {
        var insights = new List<InsightDto>();
        if (summary.Votes is not > 0) return insights;
        if (summary.Best is { Votes: > 0 } best)
            insights.Add(InsightEngine.TopTerritory(level, Label(best, level), best.Votes!.Value, summary.Votes.Value, of));
        if (summary.BestShare is { Share: { } share } bestShare)
            insights.Add(InsightEngine.BestShare(level, Label(bestShare, level), share));
        if (summary.TerritoriesCovered > 5 && summary.TopFiveConcentration is { } top5)
            insights.Add(InsightEngine.Concentration(level, 5, top5, of));
        insights.Add(InsightEngine.Reach(level, summary.TerritoriesWithVotes, summary.TerritoriesCovered));
        if (territories.Any(t => t.State == CellState.PartialCoverage))
            insights.Add(new InsightDto("coverage_partial_territories",
                new Dictionary<string, object?> { ["territories"] = territories.Count(t => t.State == CellState.PartialCoverage) },
                $"{territories.Count(t => t.State == CellState.PartialCoverage)} {InsightEngine.LevelLabel(level, territories.Count(t => t.State == CellState.PartialCoverage))} com cobertura parcial do Boletim de Urna."));
        return insights;
    }

    // ── Bens ─────────────────────────────────────────────────────────────────

    public async Task<CandidacyAssetsResponse> AssetsAsync(Guid candidacyId, Guid? compareTo, CancellationToken ct)
    {
        var c = await CandidacyAsync(candidacyId, ct);
        var items = await repo.AssetsAsync([c.Id], ct);
        XrayCandidacyRow? other = null;
        if (compareTo is { } otherId)
        {
            other = await CandidacyAsync(otherId, ct);
        }
        else if (c.PoliticianId is not null || c.PersonId is not null)
        {
            // padrão: candidatura anterior mais recente do mesmo perfil/pessoa com bens declarados
            var subject = await repo.SubjectCandidaciesAsync(c.PoliticianId ?? Guid.Empty, c.PersonId, ct);
            var earlier = subject.Where(s => s.Id != c.Id && (s.Year < c.Year || (s.Year == c.Year && s.Round < c.Round))).ToList();
            if (earlier.Count > 0)
            {
                var earlierAssets = await repo.AssetsAsync(earlier.Select(e => e.Id).ToList(), ct);
                var withAssets = earlierAssets.Select(a => a.CandidacyId).ToHashSet();
                other = earlier.Where(e => withAssets.Contains(e.Id)).OrderByDescending(e => e.Year).ThenByDescending(e => e.Round).FirstOrDefault();
            }
        }

        var otherItems = other is null ? [] : await repo.AssetsAsync([other.Id], ct);
        var total = items.Sum(a => a.Value);
        decimal? otherTotal = other is null ? null : otherItems.Sum(a => a.Value);
        var diff = other is null ? [] : XrayService.DiffAssets(otherItems, items).Items;
        var byType = items.Concat(otherItems).Select(a => (a.TypeCode, a.Type)).Distinct()
            .Select(t => new AssetTypeTotalDto(
                t.TypeCode, t.Type,
                items.Where(a => a.TypeCode == t.TypeCode).Sum(a => a.Value),
                items.Count(a => a.TypeCode == t.TypeCode),
                other is null ? null : otherItems.Where(a => a.TypeCode == t.TypeCode).Sum(a => a.Value)))
            .OrderByDescending(t => t.Total).ToList();
        return new CandidacyAssetsResponse(
            c.Id, c.Year,
            items.OrderByDescending(a => a.Value).Select(a => new AssetItemDto(a.TypeCode, a.Type, a.Description, a.Value)).ToList(),
            total, other?.Id, other?.Year, otherTotal,
            otherTotal is null ? null : total - otherTotal,
            otherTotal is > 0 ? Math.Round((double)((total - otherTotal.Value) * 100 / otherTotal.Value), 2, MidpointRounding.AwayFromZero) : null,
            diff, byType,
            (items.Count == 0 ? "Nenhum bem declarado ao TSE nesta candidatura (ou arquivo de bens não importado). " : "")
            + InsightEngine.AssetsDisclaimer);
    }

    // ── Prestação de contas ─────────────────────────────────────────────────

    public async Task<CandidacyFinanceResponse> FinanceAsync(Guid candidacyId, CancellationToken ct)
    {
        var c = await CandidacyAsync(candidacyId, ct);
        var totals = await repo.FinanceTotalsAsync([c.Id], ct);
        var categories = await repo.FinanceCategoriesAsync(c.Id, ct);
        var donors = await repo.FinanceCounterpartiesAsync(c.Id, "revenue", 15, ct);
        var suppliers = await repo.FinanceCounterpartiesAsync(c.Id, "expense_contracted", 15, ct);
        decimal? Sum(string kind) => totals.Any(t => t.RecordKind == kind) ? totals.Where(t => t.RecordKind == kind).Sum(t => t.Amount) : null;
        static FinanceCounterpartyDto View(FinanceCounterpartyRow r) =>
            new(r.RecordKind, r.Name, r.CounterpartyKind, r.Cnpj, r.Amount, r.Records);
        return new CandidacyFinanceResponse(
            c.Id, Sum("revenue"), Sum("expense_contracted"), Sum("expense_paid"),
            categories.Select(x => new FinanceCategoryDto(x.RecordKind, x.Category, x.Amount, x.Records)).ToList(),
            donors.Select(View).ToList(), suppliers.Select(View).ToList(),
            totals.Select(t => t.AccountsType).FirstOrDefault(a => a is not null),
            totals.Count == 0
                ? "Prestação de contas desta candidatura não importada (fonte: TSE, Prestação de Contas Eleitorais)."
                : "Fonte: TSE, Prestação de Contas Eleitorais. CPF de doadores e fornecedores pessoa física nunca é exibido.");
    }

    // ── Território → candidaturas ───────────────────────────────────────────

    public async Task<TerritoryCandidatesResponse> CandidatesAsync(CandidatesQuery q, CancellationToken ct)
    {
        var uf = Uf(q.Uf);
        var mun = Municipality(q.Municipality);
        if (q.Zone is not null && mun is null) throw new ElectoralBadRequestException("Filtro por zona exige município.");
        var page = Math.Max(1, q.Page);
        var pageSize = Math.Clamp(q.PageSize <= 0 ? 50 : q.PageSize, 1, MaxPageSize);

        var rows = await repo.ElectionCandidaciesAsync(q.Year, q.Round, uf, mun, ct);
        var keys = rows.Select(r => ContestInfo.From(r).CoverageKey).Distinct().ToList();
        var index = new VoteIndex(
            rows.Count == 0 ? [] : await repo.ZoneVotesAsync(rows.Where(r => r.HasLink).Select(r => r.Id).ToList(), uf, mun, ct),
            keys.Count == 0 ? [] : await repo.ZoneTotalsAsync(keys, uf, mun, ct),
            await repo.ExpectedZonesAsync([(q.Year, q.Round)], uf, mun, ct));
        var filter = new TerritoryFilter(uf, mun, q.Zone);

        var all = rows.Select(r =>
        {
            var agg = index.Aggregate(r, filter);
            return (Row: r, Contest: ContestInfo.From(r), Agg: agg);
        }).ToList();

        // posição dentro da disputa, no território
        var ranks = all.Where(x => Comparability.HasCount(x.Agg.State))
            .GroupBy(x => (x.Contest.ElectionCode, x.Contest.OfficeCode, x.Contest.ElectoralUnit))
            .SelectMany(g => g.OrderByDescending(x => x.Agg.Votes).Select((x, i) => (x.Row.Id, Rank: i + 1)))
            .ToDictionary(x => x.Id, x => x.Rank);

        var offices = all.GroupBy(x => (x.Row.OfficeCode, x.Row.OfficeName))
            .Select(g => new FacetDto(g.Key.OfficeCode.ToString(System.Globalization.CultureInfo.InvariantCulture), g.Key.OfficeName, g.Count()))
            .OrderBy(f => int.Parse(f.Value, System.Globalization.CultureInfo.InvariantCulture)).ToList();
        var parties = all.Where(x => x.Row.PartyAcronym is not null).GroupBy(x => x.Row.PartyAcronym!)
            .Select(g => new FacetDto(g.Key, g.Key, g.Count())).OrderBy(f => f.Label, StringComparer.Ordinal).ToList();
        var statuses = all.Where(x => x.Row.CandidacyStatus is not null).GroupBy(x => x.Row.CandidacyStatus!)
            .Select(g => new FacetDto(g.Key, g.Key, g.Count())).OrderByDescending(f => f.Count).ToList();

        IEnumerable<(XrayCandidacyRow Row, ContestInfo Contest, TerritoryAggregate Agg)> filtered = all;
        if (q.Office is { } office) filtered = filtered.Where(x => x.Row.OfficeCode == office);
        if (!string.IsNullOrWhiteSpace(q.Party))
        {
            var party = q.Party.Trim();
            filtered = int.TryParse(party, out var number)
                ? filtered.Where(x => x.Row.PartyNumber == number)
                : filtered.Where(x => string.Equals(x.Row.PartyAcronym, party, StringComparison.OrdinalIgnoreCase));
        }
        if (!string.IsNullOrWhiteSpace(q.Status))
            filtered = filtered.Where(x => string.Equals(x.Row.CandidacyStatus, q.Status.Trim(), StringComparison.OrdinalIgnoreCase));
        if (q.Elected is { } elected) filtered = filtered.Where(x => x.Row.Elected == elected);
        if (q.MinVotes is { } min) filtered = filtered.Where(x => (x.Agg.Votes ?? -1) >= min);
        if (!string.IsNullOrWhiteSpace(q.Q))
        {
            var term = XrayService.NormalizeDescription(q.Q);
            filtered = int.TryParse(q.Q.Trim(), out var n)
                ? filtered.Where(x => x.Row.CandidateNumber == n)
                : filtered.Where(x => XrayService.NormalizeDescription(x.Row.BallotName).Contains(term, StringComparison.Ordinal)
                    || XrayService.NormalizeDescription(x.Row.PoliticianName).Contains(term, StringComparison.Ordinal));
        }

        var desc = !string.Equals(q.Dir, "asc", StringComparison.OrdinalIgnoreCase);
        var list = filtered.ToList();
        IOrderedEnumerable<(XrayCandidacyRow Row, ContestInfo Contest, TerritoryAggregate Agg)> sorted = (q.Sort ?? "votes").ToLowerInvariant() switch
        {
            "name" => desc ? list.OrderByDescending(x => x.Row.BallotName, StringComparer.Ordinal) : list.OrderBy(x => x.Row.BallotName, StringComparer.Ordinal),
            "number" => desc ? list.OrderByDescending(x => x.Row.CandidateNumber) : list.OrderBy(x => x.Row.CandidateNumber),
            "party" => desc ? list.OrderByDescending(x => x.Row.PartyAcronym, StringComparer.Ordinal) : list.OrderBy(x => x.Row.PartyAcronym, StringComparer.Ordinal),
            "share" => desc ? list.OrderByDescending(x => x.Agg.Share ?? -1) : list.OrderBy(x => x.Agg.Share ?? double.MaxValue),
            "office" => desc ? list.OrderByDescending(x => x.Row.OfficeCode) : list.OrderBy(x => x.Row.OfficeCode),
            "votes" => desc ? list.OrderByDescending(x => x.Agg.Votes ?? -1) : list.OrderBy(x => x.Agg.Votes ?? long.MaxValue),
            _ => throw new ElectoralBadRequestException("sort deve ser votes, share, name, number, party ou office."),
        };
        var items = sorted.ThenBy(x => x.Row.BallotName, StringComparer.Ordinal).ThenBy(x => x.Row.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(x => new TerritoryCandidateDto(
                x.Row.Id, x.Row.PoliticianId, x.Contest.ToDto(), x.Row.CandidateNumber, x.Row.BallotName,
                x.Row.PartyNumber is null && x.Row.PartyAcronym is null ? null : new PartyDto(x.Row.PartyNumber, x.Row.PartyAcronym, x.Row.PartyName),
                x.Row.FederationAcronym, x.Row.CandidacyStatus, x.Row.RoundOutcome, x.Row.Elected,
                x.Agg.Votes, x.Agg.Share, ranks.TryGetValue(x.Row.Id, out var rank) ? rank : null, x.Agg.State))
            .ToList();

        var name = mun is null ? null : (await repo.MunicipalitiesAsync(uf, ct)).FirstOrDefault(m => m.TseCode == mun)?.Name;
        return new TerritoryCandidatesResponse(
            q.Year, q.Round, uf, mun, name, q.Zone, items, list.Count, page, pageSize, offices, parties, statuses,
            XrayService.Freshness(await repo.FreshnessAsync(ct)));
    }

    // ── Camadas do mapa ─────────────────────────────────────────────────────

    public static readonly string[] Layers = ["intensity", "share", "winner", "growth", "decline", "ab"];

    public async Task<MapLayerResponse> MapAsync(MapQuery q, CancellationToken ct)
    {
        var uf = Uf(q.Uf);
        var mun = Municipality(q.Municipality);
        var layer = (q.Layer ?? "").Trim().ToLowerInvariant();
        if (!Layers.Contains(layer)) throw new ElectoralBadRequestException($"layer deve ser um de: {string.Join(", ", Layers)}.");
        var level = mun is null ? "municipality" : "place";
        var freshness = XrayService.Freshness(await repo.FreshnessAsync(ct));

        switch (layer)
        {
            case "intensity" or "share":
                {
                    var id = q.Candidacy ?? throw new ElectoralBadRequestException($"layer {layer} exige candidacy.");
                    var c = await CandidacyAsync(id, ct);
                    var values = await ValuesAsync(c, uf, mun, ct);
                    var features = values.Select(v => Feature(v.Territory, layer == "share" ? v.Territory.Share : v.Territory.Votes, null, null,
                        new Dictionary<string, object?> { ["votes"] = v.Territory.Votes, ["share"] = v.Territory.Share, ["validVotes"] = v.Territory.ValidVotes },
                        ibge: v.IbgeCode)).ToList();
                    return Response(q, uf, mun, layer, level, c.OfficeCode, features, [], null,
                        layer == "share" ? "Participação da candidatura nos votos válidos do cargo." : "Votos da candidatura.", freshness);
                }
            case "growth" or "decline":
                {
                    var id = q.Candidacy ?? throw new ElectoralBadRequestException($"layer {layer} exige candidacy e base.");
                    var baseId = q.Base ?? throw new ElectoralBadRequestException($"layer {layer} exige candidacy e base.");
                    var to = await CandidacyAsync(id, ct);
                    var from = await CandidacyAsync(baseId, ct);
                    var toValues = (await ValuesAsync(to, uf, mun, ct)).ToDictionary(v => v.Key);
                    var fromValues = (await ValuesAsync(from, uf, mun, ct)).ToDictionary(v => v.Key);
                    var comparability = Comparability.Contest(ContestInfo.From(from), ContestInfo.From(to), from.HasLink, to.HasLink);
                    var features = toValues.Values.Select(t =>
                    {
                        fromValues.TryGetValue(t.Key, out var f);
                        var complete = f is not null && Comparability.IsComplete(f.Territory.State) && Comparability.IsComplete(t.Territory.State)
                            && (level == "municipality" || SameMembers(f.Territory, t.Territory));
                        var (delta, pct) = complete && comparability == ContestComparability.Comparable
                            ? Comparability.Delta(f!.Territory.Votes, t.Territory.Votes) : (null, null);
                        var state = f is null ? TerritoryComparability.CoverageOrSectionMissing
                            : !complete ? (level == "place" && f is not null && !SameMembers(f.Territory, t.Territory)
                                ? TerritoryComparability.SectionCompositionChanged : TerritoryComparability.CoverageOrSectionMissing)
                            : TerritoryComparability.Comparable;
                        double? value = delta is { } d ? (layer == "growth" ? Math.Max(d, 0) : Math.Min(d, 0)) : null;
                        return Feature(t.Territory, value, null, null, new Dictionary<string, object?>
                        {
                            ["fromVotes"] = f?.Territory.Votes,
                            ["toVotes"] = t.Territory.Votes,
                            ["deltaVotes"] = delta,
                            ["deltaPercent"] = pct,
                            ["comparability"] = state,
                        }, state, t.IbgeCode);
                    }).ToList();
                    return Response(q, uf, mun, layer, level, to.OfficeCode, features, [], comparability,
                        ContestNote(comparability, "Variação de votos entre as duas candidaturas, só em territórios comparáveis."), freshness);
                }
            case "ab":
                {
                    var aId = q.A ?? throw new ElectoralBadRequestException("layer ab exige a e b.");
                    var bId = q.B ?? throw new ElectoralBadRequestException("layer ab exige a e b.");
                    var a = await CandidacyAsync(aId, ct);
                    var b = await CandidacyAsync(bId, ct);
                    var aValues = (await ValuesAsync(a, uf, mun, ct)).ToDictionary(v => v.Key);
                    var bValues = (await ValuesAsync(b, uf, mun, ct)).ToDictionary(v => v.Key);
                    var comparability = Comparability.Contest(ContestInfo.From(a), ContestInfo.From(b), a.HasLink, b.HasLink);
                    var keys = aValues.Keys.Union(bValues.Keys);
                    var features = keys.Select(k =>
                    {
                        aValues.TryGetValue(k, out var av);
                        bValues.TryGetValue(k, out var bv);
                        var keyed = (av ?? bv)!;
                        var territory = keyed.Territory;
                        var both = av is not null && bv is not null;
                        // local de votação de eleições diferentes: só com o mesmo conjunto de seções
                        var sameMembers = level == "municipality" || (both && SameMembers(av!.Territory, bv!.Territory));
                        var complete = both && sameMembers && Comparability.IsComplete(av!.Territory.State)
                            && Comparability.IsComplete(bv!.Territory.State);
                        // diferença só entre disputas comparáveis (mesmo cargo e mesma unidade); senão, votos lado a lado
                        long? diff = complete && comparability == ContestComparability.Comparable
                            ? av!.Territory.Votes - bv!.Territory.Votes : null;
                        var category = diff is null ? null : diff > 0 ? "a" : diff < 0 ? "b" : "tie";
                        return Feature(territory, diff, category, category switch { "a" => a.BallotName, "b" => b.BallotName, "tie" => "Empate", _ => null },
                            new Dictionary<string, object?>
                            {
                                ["aVotes"] = av?.Territory.Votes,
                                ["bVotes"] = bv?.Territory.Votes,
                                ["aState"] = av?.Territory.State,
                                ["bState"] = bv?.Territory.State,
                                ["aShare"] = av?.Territory.Share,
                                ["bShare"] = bv?.Territory.Share,
                            }, AbState(complete, both, sameMembers), keyed.IbgeCode);
                    }).ToList();
                    return Response(q, uf, mun, layer, level, a.OfficeCode, features,
                        [new MapLegendItemDto("a", a.BallotName, 1), new MapLegendItemDto("b", b.BallotName, 2), new MapLegendItemDto("tie", "Empate", 3)],
                        comparability, ContestNote(comparability, "Diferença de votos A − B por território (só onde as duas votações estão completas)."),
                        freshness);
                }
            default: // winner
                {
                    var office = q.Office ?? throw new ElectoralBadRequestException("layer winner exige office.");
                    var rows = (await repo.ElectionCandidaciesAsync(q.Year, q.Round, uf, mun, ct))
                        .Where(r => r.OfficeCode == office && r.HasLink).ToList();
                    if (rows.Count == 0)
                        return Response(q, uf, mun, layer, level, office, [], [], null, "Sem candidaturas com vínculo ao BU para o cargo.", freshness);
                    var perCandidacy = new Dictionary<Guid, Dictionary<string, KeyedValue>>();
                    if (level == "municipality")
                    {
                        var keys = rows.Select(r => ContestInfo.From(r).CoverageKey).Distinct().ToList();
                        var index = new VoteIndex(
                            await repo.ZoneVotesAsync(rows.Select(r => r.Id).ToList(), uf, null, ct),
                            await repo.ZoneTotalsAsync(keys, uf, null, ct),
                            await repo.ExpectedZonesAsync([(q.Year, q.Round)], uf, null, ct));
                        var names = (await repo.MunicipalitiesAsync(uf, ct)).ToDictionary(m => m.TseCode);
                        var munKeys = index.Expected(q.Year, q.Round).Select(e => e.MunicipalityTseCode)
                            .Concat(keys.SelectMany(k => index.Totals(k)).Select(t => t.MunicipalityTseCode)).Distinct().ToList();
                        foreach (var r in rows)
                        {
                            var contest = ContestInfo.From(r);
                            perCandidacy[r.Id] = munKeys.Where(m => contest.Contains(uf, m)).ToDictionary(m => m, m =>
                            {
                                var agg = index.Aggregate(r, new TerritoryFilter(uf, m));
                                names.TryGetValue(m, out var n);
                                return new KeyedValue(m, new TerritoryValueDto(uf, m, n?.Name ?? m, null, null, null, null, null, null, null,
                                    agg.Votes, agg.ZonesCovered > 0 ? agg.ValidVotes : null, agg.Share, agg.Eligible, agg.Turnout, agg.Urns, agg.State), n?.IbgeCode);
                            });
                        }
                    }
                    else
                    {
                        foreach (var r in rows)
                            perCandidacy[r.Id] = (await ValuesAsync(r, uf, mun, ct)).ToDictionary(v => v.Key);
                    }

                    var byId = rows.ToDictionary(r => r.Id);
                    var territoryKeys = perCandidacy.Values.SelectMany(d => d.Keys).Distinct().ToList();
                    var wins = new Dictionary<Guid, int>();
                    var features = new List<MapFeatureDto>();
                    foreach (var key in territoryKeys)
                    {
                        var entries = perCandidacy.Where(p => p.Value.ContainsKey(key)).Select(p => (Id: p.Key, Value: p.Value[key])).ToList();
                        var counted = entries.Where(e => Comparability.IsComplete(e.Value.Territory.State)).OrderByDescending(e => e.Value.Territory.Votes).ToList();
                        var territory = entries[0].Value;
                        if (counted.Count == 0 || counted[0].Value.Territory.Votes is not > 0)
                        {
                            features.Add(Feature(territory.Territory with { Votes = null, Share = null }, null, null, null,
                                new Dictionary<string, object?>(), TerritoryComparability.CoverageOrSectionMissing, territory.IbgeCode));
                            continue;
                        }
                        var leader = counted[0];
                        var second = counted.Count > 1 ? counted[1] : default;
                        var tie = counted.Count > 1 && second.Value.Territory.Votes == leader.Value.Territory.Votes;
                        if (!tie) wins[leader.Id] = wins.GetValueOrDefault(leader.Id) + 1;
                        features.Add(Feature(leader.Value.Territory, leader.Value.Territory.Share,
                            tie ? "tie" : leader.Id.ToString(), tie ? "Empate" : byId[leader.Id].BallotName,
                            new Dictionary<string, object?>
                            {
                                ["leaderCandidacyId"] = tie ? null : leader.Id,
                                ["leaderVotes"] = leader.Value.Territory.Votes,
                                ["secondCandidacyId"] = second.Id == Guid.Empty ? null : second.Id,
                                ["secondVotes"] = second.Id == Guid.Empty ? null : second.Value.Territory.Votes,
                                ["marginVotes"] = second.Id == Guid.Empty ? null : leader.Value.Territory.Votes - second.Value.Territory.Votes,
                            }, TerritoryComparability.Comparable, territory.IbgeCode));
                    }
                    var legend = wins.OrderByDescending(w => w.Value).ThenBy(w => byId[w.Key].BallotName, StringComparer.Ordinal)
                        .Select((w, i) => new MapLegendItemDto(w.Key.ToString(), byId[w.Key].BallotName, i + 1)).ToList();
                    return Response(q, uf, mun, layer, level, office, features, legend, null,
                        "Candidatura com mais votos em cada território (sem cor partidária; paleta neutra por ordem da legenda).", freshness);
                }
        }
    }

    /// <summary>Nota das camadas entre duas candidaturas: por que não há diferença quando as disputas não se comparam.</summary>
    private static string ContestNote(string comparability, string comparableNote) => comparability switch
    {
        ContestComparability.Comparable => comparableNote,
        ContestComparability.Unavailable =>
            "Comparação direta indisponível: uma das candidaturas não tem vínculo auditado com o Boletim de Urna; votos lado a lado, sem diferença.",
        _ => "Disputas não comparáveis diretamente (cargo ou unidade diferente): votos lado a lado nos detalhes, sem diferença.",
    };

    private static string AbState(bool complete, bool both, bool sameMembers)
    {
        if (complete) return TerritoryComparability.Comparable;
        return both && !sameMembers ? TerritoryComparability.SectionCompositionChanged : TerritoryComparability.CoverageOrSectionMissing;
    }

    private static bool SameMembers(TerritoryValueDto a, TerritoryValueDto b) =>
        (a.SectionMembers ?? []).OrderBy(x => x).SequenceEqual((b.SectionMembers ?? []).OrderBy(x => x));

    internal sealed record KeyedValue(string Key, TerritoryValueDto Territory, int? IbgeCode);

    /// <summary>Valores de uma candidatura por município (sem município) ou por local de votação (com município).</summary>
    private async Task<IReadOnlyList<KeyedValue>> ValuesAsync(XrayCandidacyRow c, string uf, string? mun, CancellationToken ct)
    {
        var contest = ContestInfo.From(c);
        if (mun is null)
        {
            var names = (await repo.MunicipalitiesAsync(uf, ct)).ToDictionary(m => m.TseCode);
            var territories = await ZoneTerritoriesAsync(c, contest, "municipality", uf, null, null, ct);
            return territories.Select(t => new KeyedValue(t.MunicipalityTseCode!, t,
                names.TryGetValue(t.MunicipalityTseCode!, out var n) ? n.IbgeCode : null)).ToList();
        }
        var places = await SectionTerritoriesAsync(c, contest, "place", uf, mun, null, ct);
        return places.Select(t => new KeyedValue($"{t.Zone}|{t.PlaceCode}", t, null)).ToList();
    }

    private static MapFeatureDto Feature(
        TerritoryValueDto t, double? value, string? category, string? categoryLabel, IReadOnlyDictionary<string, object?> details,
        string? state = null, int? ibge = null) =>
        new(t.PlaceCode is null ? $"{t.Uf}|{t.MunicipalityTseCode}" : $"{t.Uf}|{t.MunicipalityTseCode}|{t.Zone}|{t.PlaceCode}",
            t.MunicipalityTseCode, ibge, t.PlaceName ?? t.MunicipalityName ?? t.MunicipalityTseCode ?? t.Uf, t.Zone, t.PlaceCode,
            t.Latitude, t.Longitude, value, category, categoryLabel, state ?? t.State, details);

    private static MapLayerResponse Response(
        MapQuery q, string uf, string? mun, string layer, string level, int? office, List<MapFeatureDto> features,
        IReadOnlyList<MapLegendItemDto> legend, string? comparability, string note, DerivedFreshnessDto freshness)
    {
        var values = features.Where(f => f.Value is not null).Select(f => f.Value!.Value).ToList();
        return new MapLayerResponse(
            q.Year, q.Round, uf, mun, layer, level, office, features, legend,
            values.Count > 0 ? values.Min() : null, values.Count > 0 ? values.Max() : null, comparability, note, freshness);
    }
}
