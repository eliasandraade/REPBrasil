using RepBrasil.Application.Interfaces;

namespace RepBrasil.Application.Electoral;

/// <summary>
/// Comparação descritiva de até 5 candidaturas — do mesmo pleito ou de eleições diferentes.
/// Candidaturas da mesma pessoa formam um "sujeito"; a evolução é calculada por sujeito entre
/// eleições consecutivas, e só com disputa comparável (mesmo cargo e unidade) e território
/// comparável (seção com a mesma composição). Ausência nunca vira zero.
/// </summary>
public class ComparisonService(IElectoralXrayRepository repo)
{
    public const int MaxCandidacies = 5;

    public static readonly IReadOnlyDictionary<string, string> Definitions = new Dictionary<string, string>
    {
        ["subject"] = "sujeito = pessoa/perfil: candidaturas da mesma identidade canônica são comparadas como evolução",
        ["sectionIdentity"] = "seção histórica = UF + município TSE + zona + número da seção; o número físico da urna nunca é identidade",
        ["comparable"] = "território comparável: coberto pelo BU em todas as eleições; em seção/local, o conjunto principal + agregadas é idêntico",
        ["section_composition_changed"] = "mesma seção, conjunto principal + agregadas diferente entre as eleições: sem delta direto",
        ["coverage_or_section_missing"] = "território sem BU ou inexistente em alguma eleição: sem delta, nunca zero",
        ["contestComparability"] = "comparable_contest = mesmo cargo e mesma unidade; different_office; different_territorial_scope; direct_comparison_unavailable (sem vínculo/cobertura)",
        ["overtake"] = "A passou à frente de B: A < B na eleição anterior e A > B na posterior, no mesmo território comparável",
        ["leader"] = "candidatura selecionada com mais votos no território, entre as da mesma disputa",
    };

    public sealed record Request(IReadOnlyList<Guid> CandidacyIds, string? Uf, string? Level, string? Municipality, int? Zone);

    private sealed record Cand(XrayCandidacyRow Row, ContestInfo Contest, int Subject, int Election);

    private sealed record TerritoryKey(
        string Key, string Uf, string? Municipality, string? MunicipalityName, int? Zone, int? Section, string? PlaceCode, string? PlaceName);

    public async Task<ElectoralComparisonResponse> CompareAsync(Request request, CancellationToken ct)
    {
        var ids = request.CandidacyIds.Distinct().ToList();
        if (ids.Count == 0 || ids.Count > MaxCandidacies)
            throw new ElectoralBadRequestException($"Selecione de 1 a {MaxCandidacies} candidaturas.");
        if (ids.Count != request.CandidacyIds.Count)
            throw new ElectoralBadRequestException("A mesma candidatura não pode ser selecionada mais de uma vez.");
        var level = TerritoryService.ParseLevel(request.Level, "municipality", "state", "zone", "section", "place");
        var uf = (request.Uf ?? "").Trim().ToUpperInvariant();
        if (uf.Length != 2) throw new ElectoralBadRequestException("UF inválida.");
        var municipality = string.IsNullOrWhiteSpace(request.Municipality) ? null : request.Municipality.Trim().PadLeft(5, '0');
        if (level is "section" or "place" && municipality is null)
            throw new ElectoralBadRequestException("Comparação por seção ou local de votação exige município.");
        if (request.Zone is not null && municipality is null)
            throw new ElectoralBadRequestException("Filtro por zona exige município.");

        var rows = await repo.CandidaciesAsync(ids, ct);
        var missing = ids.Except(rows.Select(r => r.Id)).ToList();
        if (missing.Count > 0) throw new ElectoralNotFoundException($"Candidatura {missing[0]} não encontrada.");

        // sujeitos (pessoa/perfil) e eleições
        var subjectKeys = new List<string>();
        var subjects = new List<CompareSubjectDto>();
        var elections = rows.Select(r => (Year: (int)r.Year, Round: (int)r.Round)).Distinct().OrderBy(e => e.Year).ThenBy(e => e.Round).ToList();
        var cands = new List<Cand>();
        foreach (var r in ids.Select(id => rows.First(x => x.Id == id)))
        {
            var key = r.PersonId is { } p ? $"person:{p}" : r.PoliticianId is { } pol ? $"politician:{pol}" : $"candidacy:{r.Id}";
            var subject = subjectKeys.IndexOf(key);
            if (subject < 0)
            {
                subjectKeys.Add(key);
                subject = subjectKeys.Count - 1;
                subjects.Add(new CompareSubjectDto(subject, r.PoliticianId, r.PersonId, r.PoliticianName ?? r.BallotName, []));
            }
            cands.Add(new Cand(r, ContestInfo.From(r), subject, elections.IndexOf(((int)r.Year, (int)r.Round))));
        }
        // nome do sujeito nos textos = nome de urna da sua candidatura mais recente (o mesmo dos cartões)
        subjects = subjects.Select(s =>
        {
            var own = cands.Where(c => c.Subject == s.Index).ToList();
            var latest = own.OrderByDescending(c => c.Row.Year).ThenByDescending(c => c.Row.Round).First();
            return s with { Name = Fmt.Name(latest.Row.BallotName), CandidacyIds = own.Select(c => c.Row.Id).ToList() };
        }).ToList();

        var keys = cands.Select(c => c.Contest.CoverageKey).Concat(cands.Select(c => c.Contest.Key)).Distinct().ToList();
        var electionKeys = elections.Select(e => (e.Year, e.Round)).ToList();
        IReadOnlyList<CompareTerritoryDto> territories;
        Dictionary<Guid, (long? Votes, double? Share, string State)> totals;
        if (level is "section" or "place")
            (territories, totals) = await SectionLevelAsync(cands, keys, electionKeys, level, uf, municipality!, request.Zone, ct);
        else
            (territories, totals) = await ZoneLevelAsync(cands, keys, electionKeys, level, uf, municipality, request.Zone, ct);

        var pairs = new List<ComparePairDto>();
        for (var i = 0; i < cands.Count; i++)
            for (var j = i + 1; j < cands.Count; j++)
                pairs.Add(new ComparePairDto(cands[i].Row.Id, cands[j].Row.Id,
                    Comparability.Contest(cands[i].Contest, cands[j].Contest, HasVotes(cands[i]), HasVotes(cands[j]))));

        var candidacyDtos = cands.Select(c => new CompareCandidacyDto(
            c.Row.Id, c.Subject, c.Election, c.Contest.ToDto(), c.Row.CandidateNumber, c.Row.BallotName,
            c.Row.PartyNumber is null && c.Row.PartyAcronym is null ? null : new PartyDto(c.Row.PartyNumber, c.Row.PartyAcronym, c.Row.PartyName),
            c.Row.CandidacyStatus, c.Row.RoundOutcome, c.Row.Elected,
            totals[c.Row.Id].Votes, totals[c.Row.Id].Share, totals[c.Row.Id].State)).ToList();

        var overtakes = Overtakes(cands, territories, elections.Count);
        var extremes = Extremes(cands, territories);
        var insights = Insights(level, cands, subjects, elections, pairs, territories, overtakes, extremes);
        return new ElectoralComparisonResponse(
            level, uf, municipality, request.Zone, subjects,
            elections.Select((e, i) => new CompareElectionDto(i, e.Year, e.Round)).ToList(),
            candidacyDtos, pairs, territories, overtakes, extremes, insights,
            XrayService.Freshness(await repo.FreshnessAsync(ct)), Definitions);
    }

    private static bool HasVotes(Cand c) =>
        c.Row.HasLink && !Comparability.IsTicketMember(c.Row.OfficeCode) && !Comparability.NotOnBallot(c.Row.InsertedInUrn);

    // ── estado / município / zona: agregados derivados ──────────────────────

    private async Task<(IReadOnlyList<CompareTerritoryDto>, Dictionary<Guid, (long?, double?, string)>)> ZoneLevelAsync(
        IReadOnlyList<Cand> cands, IReadOnlyList<ElectionOffice> keys, IReadOnlyList<(int Year, int Round)> elections,
        string level, string uf, string? municipality, int? zone, CancellationToken ct)
    {
        var index = new VoteIndex(
            await repo.ZoneVotesAsync(cands.Select(c => c.Row.Id).ToList(), uf, municipality, ct),
            await repo.ZoneTotalsAsync(keys, uf, municipality, ct),
            await repo.ExpectedZonesAsync(elections, uf, municipality, ct));
        var names = (await repo.MunicipalitiesAsync(uf, ct)).ToDictionary(m => m.TseCode);

        var zoneKeys = new HashSet<(string Mun, int Zone)>();
        foreach (var e in elections)
            foreach (var x in index.Expected(e.Year, e.Round)) zoneKeys.Add((x.MunicipalityTseCode, x.Zone));
        foreach (var k in keys)
            foreach (var t in index.Totals(k)) zoneKeys.Add((t.MunicipalityTseCode, t.Zone));
        // só territórios alcançados por alguma disputa selecionada
        var reachable = zoneKeys.Where(z => (zone is null || z.Zone == zone) && cands.Any(c => c.Contest.Contains(uf, z.Mun))).ToList();

        IEnumerable<TerritoryKey> territoryKeys = level switch
        {
            "state" => [new TerritoryKey(uf, uf, municipality, municipality is null ? null : names.GetValueOrDefault(municipality)?.Name, zone, null, null, null)],
            "municipality" => reachable.Select(z => z.Mun).Distinct().Select(m =>
                new TerritoryKey($"{uf}|{m}", uf, m, names.GetValueOrDefault(m)?.Name ?? m, null, null, null, null)),
            _ => reachable.Select(z => new TerritoryKey($"{uf}|{z.Mun}|{z.Zone}", uf, z.Mun, names.GetValueOrDefault(z.Mun)?.Name ?? z.Mun, z.Zone, null, null, null)),
        };

        var result = new List<CompareTerritoryDto>();
        foreach (var t in territoryKeys)
        {
            var filter = new TerritoryFilter(uf, t.Municipality, t.Zone);
            var cells = cands.Select(c =>
            {
                var agg = index.Aggregate(c.Row, filter);
                return (Cand: c, Cell: new CompareCellDto(c.Row.Id, agg.Votes, agg.ZonesCovered > 0 ? agg.ValidVotes : null, agg.Share, agg.State));
            }).ToList();
            // território comparável: nenhuma disputa que o alcança está sem cobertura
            var comparability = cells.Any(x => x.Cell.State is CellState.NoCoverage or CellState.PartialCoverage)
                ? TerritoryComparability.CoverageOrSectionMissing
                : TerritoryComparability.Comparable;
            result.Add(Territory(t, comparability, null, cells.Select(x => (x.Cand, x.Cell)).ToList(), cands));
        }

        var totals = cands.ToDictionary(c => c.Row.Id, c =>
        {
            var agg = index.Aggregate(c.Row, new TerritoryFilter(uf, municipality, zone));
            return (agg.Votes, agg.Share, agg.State);
        });
        var ordered = result.OrderBy(t => t.MunicipalityName, StringComparer.Ordinal).ThenBy(t => t.Zone).ToList();
        return (ordered, totals);
    }

    // ── seção / local de votação: fatos do BU ───────────────────────────────

    private async Task<(IReadOnlyList<CompareTerritoryDto>, Dictionary<Guid, (long?, double?, string)>)> SectionLevelAsync(
        IReadOnlyList<Cand> cands, IReadOnlyList<ElectionOffice> keys, IReadOnlyList<(int Year, int Round)> elections,
        string level, string uf, string municipality, int? zone, CancellationToken ct)
    {
        var results = await repo.SectionResultsAsync(keys, uf, municipality, zone, ct);
        var votes = await repo.SectionVotesAsync(cands.Select(c => c.Row.Id).ToList(), uf, municipality, zone, ct);
        var places = (await repo.PlacesAsync(elections, uf, municipality, zone, ct))
            .GroupBy(p => (p.Year, p.Round, p.Zone, p.Code)).ToDictionary(g => g.Key, g => g.First());
        var votesBy = votes.GroupBy(v => (v.ResultId, v.CandidacyId)).ToDictionary(g => g.Key, g => g.Sum(v => v.Votes));
        var munName = results.Select(r => r.MunicipalityName).FirstOrDefault(n => n is not null);
        var names = (await repo.MunicipalitiesAsync(uf, ct)).ToDictionary(m => m.TseCode);
        munName = names.GetValueOrDefault(municipality)?.Name ?? munName ?? municipality;

        // resultado por (eleição, cargo, chave territorial)
        string KeyOf(SectionResultRow r) => level == "section"
            ? $"{uf}|{municipality}|{r.Zone}|{r.Section}"
            : $"{uf}|{municipality}|{r.Zone}|{r.PollingPlaceCode}";
        var byKey = results.GroupBy(KeyOf).ToDictionary(g => g.Key, g => g.ToList());

        var territories = new List<CompareTerritoryDto>();
        foreach (var (key, group) in byKey)
        {
            var first = group[0];
            // composição por eleição (uma urna serve a todos os cargos da seção)
            var members = new Dictionary<int, IReadOnlyList<int>>();
            var membersList = new List<IReadOnlyCollection<int>?>();
            for (var e = 0; e < elections.Count; e++)
            {
                var inElection = group.Where(r => r.Year == elections[e].Year && r.Round == elections[e].Round).ToList();
                if (inElection.Count == 0) { membersList.Add(null); continue; }
                var set = level == "section"
                    ? inElection[0].SectionMembers.Distinct().OrderBy(x => x).ToList()
                    : inElection.GroupBy(r => r.Section).SelectMany(g => g.First().SectionMembers).Distinct().OrderBy(x => x).ToList();
                members[e] = set;
                membersList.Add(set);
            }
            var comparability = Comparability.SectionStatus(membersList);
            var cells = cands.Select(c =>
            {
                var inContest = c.Contest.Covers(uf, municipality);
                // vice/suplente: a urna do cargo do titular define a cobertura (votado na chapa)
                var forOffice = group.Where(r => r.Year == c.Contest.Year && r.Round == c.Contest.Round && r.OfficeCode == c.Contest.CoverageKey.OfficeCode).ToList();
                var count = forOffice.Sum(r => votesBy.GetValueOrDefault((r.ResultId, c.Row.Id)));
                var state = Comparability.Cell(
                    inContest, forOffice.Count == 0 ? Comparability.Coverage.None : Comparability.Coverage.Full,
                    Comparability.IsTicketMember(c.Row.OfficeCode), Comparability.NotOnBallot(c.Row.InsertedInUrn), c.Row.HasLink, count);
                var valid = forOffice.Sum(r => r.ValidVotes);
                long? n = Comparability.HasCount(state) ? count : null;
                return (Cand: c, Cell: new CompareCellDto(c.Row.Id, n, forOffice.Count > 0 ? valid : null, n is { } x ? Comparability.Pct(x, valid) : null, state));
            }).ToList();
            var place = first.PollingPlaceCode is null ? null
                : elections.Select(e => places.GetValueOrDefault(((short)e.Year, (short)e.Round, first.Zone, first.PollingPlaceCode))).FirstOrDefault(p => p is not null);
            var t = new TerritoryKey(key, uf, municipality, munName, first.Zone, level == "section" ? first.Section : null,
                first.PollingPlaceCode, place?.Name);
            territories.Add(Territory(t, comparability, members, cells, cands));
        }

        var totals = cands.ToDictionary(c => c.Row.Id, c =>
        {
            var counted = territories.Select(t => t.Cells.First(x => x.CandidacyId == c.Row.Id)).ToList();
            var withCount = counted.Where(x => Comparability.HasCount(x.State)).ToList();
            var state = withCount.Count > 0 ? (withCount.Sum(x => x.Votes ?? 0) > 0 ? CellState.Value : CellState.Zero)
                : counted.Select(x => x.State).FirstOrDefault() ?? CellState.NoCoverage;
            long? sum = withCount.Count > 0 ? withCount.Sum(x => x.Votes ?? 0) : null;
            long valid = withCount.Sum(x => x.ValidVotes ?? 0);
            return (sum, sum is { } s ? Comparability.Pct(s, valid) : null, state);
        });
        var ordered = territories.OrderBy(t => t.Zone).ThenBy(t => t.Section).ThenBy(t => t.PlaceCode, StringComparer.Ordinal).ToList();
        return (ordered, totals);
    }

    private static CompareTerritoryDto Territory(
        TerritoryKey t, string comparability, IReadOnlyDictionary<int, IReadOnlyList<int>>? members,
        IReadOnlyList<(Cand Cand, CompareCellDto Cell)> cells, IReadOnlyList<Cand> cands)
    {
        // evolução por sujeito: eleições consecutivas em que o sujeito tem candidatura
        var evolution = new List<CompareEvolutionDto>();
        foreach (var subject in cands.Select(c => c.Subject).Distinct())
        {
            var own = cells.Where(x => x.Cand.Subject == subject).OrderBy(x => x.Cand.Election).ThenBy(x => x.Cand.Contest.OfficeCode).ToList();
            for (var i = 1; i < own.Count; i++)
            {
                var (from, fromCell) = own[i - 1];
                var (to, toCell) = own[i];
                var contest = Comparability.Contest(from.Contest, to.Contest, HasVotes(from), HasVotes(to));
                var status = contest != ContestComparability.Comparable ? contest
                    : comparability != TerritoryComparability.Comparable ? comparability
                    : !Comparability.IsComplete(fromCell.State) || !Comparability.IsComplete(toCell.State) ? TerritoryComparability.CoverageOrSectionMissing
                    : ContestComparability.Comparable;
                var (delta, pct) = status == ContestComparability.Comparable ? Comparability.Delta(fromCell.Votes, toCell.Votes) : (null, null);
                evolution.Add(new CompareEvolutionDto(
                    subject, from.Row.Id, to.Row.Id, status, delta, pct,
                    status == ContestComparability.Comparable ? Comparability.DeltaPoints(fromCell.Share, toCell.Share) : null));
            }
        }

        // líder por eleição, entre candidaturas da mesma disputa com valor completo
        var leaders = new List<CompareLeaderDto>();
        foreach (var group in cells.GroupBy(x => x.Cand.Election))
        {
            var contests = group.Select(x => (x.Cand.Contest.OfficeCode, x.Cand.Contest.ElectoralUnit)).Distinct().Count();
            var complete = group.Where(x => Comparability.IsComplete(x.Cell.State)).ToList();
            if (group.Count() < 2 || contests != 1 || complete.Count != group.Count()) continue;
            var max = complete.Max(x => x.Cell.Votes ?? 0);
            var top = complete.Where(x => (x.Cell.Votes ?? 0) == max).ToList();
            leaders.Add(new CompareLeaderDto(group.Key, top.Count == 1 ? top[0].Cand.Row.Id : null, top.Count > 1));
        }

        return new CompareTerritoryDto(
            t.Key, t.Uf, t.Municipality, t.MunicipalityName, t.Zone, t.Section, t.PlaceCode, t.PlaceName, comparability, members,
            cells.Select(x => x.Cell).ToList(), evolution, leaders);
    }

    private static IReadOnlyList<OvertakeDto> Overtakes(IReadOnlyList<Cand> cands, IReadOnlyList<CompareTerritoryDto> territories, int electionCount)
    {
        var result = new List<OvertakeDto>();
        var subjects = cands.Select(c => c.Subject).Distinct().ToList();
        foreach (var a in subjects)
            foreach (var b in subjects.Where(b => b != a))
                for (var e1 = 0; e1 < electionCount; e1++)
                    for (var e2 = e1 + 1; e2 < electionCount; e2++)
                    {
                        var a1 = cands.FirstOrDefault(c => c.Subject == a && c.Election == e1);
                        var a2 = cands.FirstOrDefault(c => c.Subject == a && c.Election == e2);
                        var b1 = cands.FirstOrDefault(c => c.Subject == b && c.Election == e1);
                        var b2 = cands.FirstOrDefault(c => c.Subject == b && c.Election == e2);
                        if (a1 is null || a2 is null || b1 is null || b2 is null) continue;
                        if (Comparability.Contest(a1.Contest, b1.Contest, HasVotes(a1), HasVotes(b1)) != ContestComparability.Comparable) continue;
                        if (Comparability.Contest(a2.Contest, b2.Contest, HasVotes(a2), HasVotes(b2)) != ContestComparability.Comparable) continue;
                        if (Comparability.Contest(a1.Contest, a2.Contest, HasVotes(a1), HasVotes(a2)) != ContestComparability.Comparable) continue;
                        var keys = new List<string>();
                        foreach (var t in territories.Where(t => t.Comparability == TerritoryComparability.Comparable))
                        {
                            var cells = new[] { a1, b1, a2, b2 }.Select(c => t.Cells.First(x => x.CandidacyId == c.Row.Id)).ToArray();
                            if (!cells.All(x => Comparability.IsComplete(x.State))) continue;
                            if (Comparability.Overtook(cells[0].Votes!.Value, cells[1].Votes!.Value, cells[2].Votes!.Value, cells[3].Votes!.Value))
                                keys.Add(t.Key);
                        }
                        if (keys.Count > 0) result.Add(new OvertakeDto(a, b, e1, e2, keys.Count, keys.Take(50).ToList()));
                    }
        return result;
    }

    private static IReadOnlyList<ExtremeDto> Extremes(IReadOnlyList<Cand> cands, IReadOnlyList<CompareTerritoryDto> territories)
    {
        var result = new List<ExtremeDto>();
        var steps = territories.SelectMany(t => t.Evolution.Select(e => (Territory: t, Step: e)))
            .Where(x => x.Step.Comparability == ContestComparability.Comparable && x.Step.DeltaVotes is not null)
            .GroupBy(x => (x.Step.Subject, x.Step.FromCandidacyId, x.Step.ToCandidacyId));
        foreach (var g in steps)
        {
            var growth = g.OrderByDescending(x => x.Step.DeltaVotes).First();
            var decline = g.OrderBy(x => x.Step.DeltaVotes).First();
            if (growth.Step.DeltaVotes > 0)
                result.Add(new ExtremeDto(g.Key.Subject, g.Key.FromCandidacyId, g.Key.ToCandidacyId, "growth", growth.Territory.Key,
                    Label(growth.Territory), growth.Step.DeltaVotes!.Value, growth.Step.DeltaPercent));
            if (decline.Step.DeltaVotes < 0)
                result.Add(new ExtremeDto(g.Key.Subject, g.Key.FromCandidacyId, g.Key.ToCandidacyId, "decline", decline.Territory.Key,
                    Label(decline.Territory), decline.Step.DeltaVotes!.Value, decline.Step.DeltaPercent));
        }
        return result;
    }

    private static string Label(CompareTerritoryDto t) =>
        t.Section is not null ? $"{t.MunicipalityName} · zona {t.Zone} · seção {t.Section}"
        : t.PlaceCode is not null ? $"{t.PlaceName ?? $"local {t.PlaceCode}"} (zona {t.Zone})"
        : t.Zone is not null ? $"{t.MunicipalityName} · zona {t.Zone}"
        : t.MunicipalityName ?? t.Uf;

    private static IReadOnlyList<InsightDto> Insights(
        string level, IReadOnlyList<Cand> cands, IReadOnlyList<CompareSubjectDto> subjects, IReadOnlyList<(int Year, int Round)> elections,
        IReadOnlyList<ComparePairDto> pairs, IReadOnlyList<CompareTerritoryDto> territories, IReadOnlyList<OvertakeDto> overtakes,
        IReadOnlyList<ExtremeDto> extremes)
    {
        var insights = new List<InsightDto>();
        string E(int i) => Fmt.Election(elections[i].Year, elections[i].Round);
        foreach (var o in overtakes)
            insights.Add(InsightEngine.Overtake(level, subjects[o.Subject].Name, subjects[o.OvertakenSubject].Name, E(o.FromElection), E(o.ToElection), o.Territories));
        foreach (var x in extremes)
        {
            var from = cands.First(c => c.Row.Id == x.FromCandidacyId);
            var to = cands.First(c => c.Row.Id == x.ToCandidacyId);
            insights.Add(InsightEngine.Extreme(x.Kind, subjects[x.Subject].Name, level, x.Label, x.DeltaVotes, x.DeltaPercent, E(from.Election), E(to.Election)));
        }
        // liderança territorial por eleição
        for (var e = 0; e < elections.Count; e++)
        {
            var withLeader = territories.Select(t => t.Leaders.FirstOrDefault(l => l.Election == e)).Where(l => l is not null).ToList();
            if (withLeader.Count == 0) continue;
            foreach (var g in withLeader.Where(l => l!.CandidacyId is not null).GroupBy(l => l!.CandidacyId!.Value))
            {
                var c = cands.First(x => x.Row.Id == g.Key);
                insights.Add(InsightEngine.Leadership(level, subjects[c.Subject].Name, E(e), g.Count(), withLeader.Count));
            }
        }
        foreach (var p in pairs.Where(p => p.Comparability is ContestComparability.DifferentOffice or ContestComparability.DifferentTerritorialScope))
        {
            var a = cands.First(c => c.Row.Id == p.First);
            var b = cands.First(c => c.Row.Id == p.Second);
            if (a.Subject == b.Subject || a.Election == b.Election)
                insights.Add(InsightEngine.NotComparable($"{Fmt.Name(a.Row.BallotName)} ({Fmt.Name(a.Contest.OfficeName)} {E(a.Election)})",
                    $"{Fmt.Name(b.Row.BallotName)} ({Fmt.Name(b.Contest.OfficeName)} {E(b.Election)})", p.Comparability));
        }
        return insights;
    }
}
