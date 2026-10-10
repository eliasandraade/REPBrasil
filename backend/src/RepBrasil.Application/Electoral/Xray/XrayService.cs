using System.Globalization;
using System.Text;
using System.Text.Json;
using RepBrasil.Application.Interfaces;

namespace RepBrasil.Application.Electoral;

/// <summary>
/// Raio X eleitoral de um perfil: todas as candidaturas oficiais da pessoa (identidade canônica),
/// votação com cobertura e estado explícitos, chapa de vices/suplentes, bens, prestação de contas,
/// registros complementares, histórico oficial do TSE, evolução e insights determinísticos.
/// </summary>
public class XrayService(IElectoralXrayRepository repo)
{
    public static readonly IReadOnlyDictionary<string, string> Definitions = new Dictionary<string, string>
    {
        ["candidacy"] = "candidatura = registro oficial do TSE numa eleição (SQ_CANDIDATO por disputa); número, partido e nome de urna NÃO são identidade permanente",
        ["person"] = "pessoa = identidade canônica: CPF do TSE (só HMAC) ou vínculo oficial entre SQ_CANDIDATO (histórico de candidaturas do TSE); nunca por nome",
        ["votes"] = "fato: soma dos votos da candidatura nos Boletins de Urna vigentes da unidade da disputa (vínculo auditado votável → candidatura)",
        ["shareOfValidVotes"] = "métrica derivada: votos ÷ votos válidos (nominais + legenda) do mesmo cargo na unidade da disputa",
        ["rank"] = "posição entre os números votados da disputa na unidade inteira; só calculada com cobertura completa",
        ["coverage"] = "zonas da unidade da disputa com Boletim de Urna importado ÷ zonas esperadas pelo cadastro oficial da eleição",
        ["state"] = "value/zero = número afirmado (zero real só com BU do cargo e vínculo auditado); no_coverage, unlinked, not_on_ballot, ticket_member, outside_contest e partial_coverage nunca viram zero",
        ["ticket"] = "vice e suplentes são votados na chapa do titular (mesma eleição, unidade e número): os votos mostrados são da chapa",
        ["evolution"] = "cada candidatura comparada à anterior da mesma disputa (cargo + unidade), ou à imediatamente anterior quando não há; delta só quando a disputa é comparável (mesmo cargo e mesma unidade) e as duas votações têm cobertura completa",
        ["assets"] = "bens declarados ao TSE pertencem à candidatura de cada eleição; a variação é descritiva e não indica irregularidade",
    };

    public static DerivedFreshnessDto Freshness(FreshnessRow? row)
    {
        if (row is null)
            return new DerivedFreshnessDto(true, null, "Agregados derivados ainda não calculados: execute o refresh após importar o BU.");
        var stale = row.StoredRuns != row.CurrentRuns || row.StoredLastFinishedAt != row.CurrentLastFinishedAt;
        return new DerivedFreshnessDto(
            stale, row.RefreshedAt,
            stale
                ? "Há lotes do BU importados depois do último cálculo dos agregados: números por zona/município podem estar defasados até o próximo refresh."
                : "Agregados derivados calculados sobre todos os lotes vigentes do BU.");
    }

    public static string TicketRole(int officeCode) => officeCode switch
    {
        9 => "first_substitute",
        10 => "second_substitute",
        _ => "vice",
    };

    internal static string NormalizeDescription(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return string.Empty;
        var decomposed = text.Normalize(NormalizationForm.FormKD);
        var sb = new StringBuilder(decomposed.Length);
        foreach (var ch in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark) continue;
            sb.Append(char.IsLetterOrDigit(ch) ? char.ToUpperInvariant(ch) : ' ');
        }
        return string.Join(' ', sb.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    /// <summary>
    /// Diferença entre dois conjuntos de bens: pareia itens pelo tipo + descrição normalizada (multiconjunto).
    /// Itens sem par são "apenas na anterior"/"apenas na posterior" — fato descritivo, nunca juízo.
    /// </summary>
    public static (int Added, int Removed, int Kept, IReadOnlyList<AssetDiffItemDto> Items) DiffAssets(
        IReadOnlyList<AssetRow> from, IReadOnlyList<AssetRow> to)
    {
        var pool = from.GroupBy(a => (a.TypeCode, NormalizeDescription(a.Description)))
            .ToDictionary(g => g.Key, g => new Queue<AssetRow>(g.OrderBy(x => x.Value)));
        var items = new List<AssetDiffItemDto>();
        var kept = 0;
        var added = 0;
        foreach (var item in to.OrderBy(x => x.TypeCode).ThenBy(x => x.Description, StringComparer.Ordinal))
        {
            var key = (item.TypeCode, NormalizeDescription(item.Description));
            if (pool.TryGetValue(key, out var queue) && queue.Count > 0)
            {
                var previous = queue.Dequeue();
                kept++;
                items.Add(new AssetDiffItemDto("kept", item.TypeCode, item.Type, item.Description, previous.Value, item.Value));
            }
            else
            {
                added++;
                items.Add(new AssetDiffItemDto("added", item.TypeCode, item.Type, item.Description, null, item.Value));
            }
        }
        var removed = 0;
        foreach (var queue in pool.Values)
        {
            while (queue.Count > 0)
            {
                var previous = queue.Dequeue();
                removed++;
                items.Add(new AssetDiffItemDto("removed", previous.TypeCode, previous.Type, previous.Description, previous.Value, null));
            }
        }
        return (added, removed, kept, items);
    }

    internal static Dictionary<string, object?> Payload(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var dict = new Dictionary<string, object?>();
        foreach (var p in doc.RootElement.EnumerateObject())
        {
            dict[p.Name] = p.Value.ValueKind switch
            {
                JsonValueKind.Null => null,
                JsonValueKind.Number => p.Value.TryGetInt64(out var l) ? l : p.Value.GetDouble(),
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                _ => p.Value.ToString(),
            };
        }
        return dict;
    }

    public static CandidacyRecordsDto Records(IEnumerable<SourceRecordRow> rows)
    {
        var social = new List<(long Order, string Url)>();
        Dictionary<string, object?>? complement = null;
        foreach (var r in rows)
        {
            var payload = Payload(r.PayloadJson);
            if (r.Kind == "social_network" && payload.GetValueOrDefault("url") is string url)
                social.Add((payload.GetValueOrDefault("order") is long o ? o : long.MaxValue, url));
            else if (r.Kind == "complement")
                complement = payload;
        }
        return new CandidacyRecordsDto(social.OrderBy(s => s.Order).ThenBy(s => s.Url, StringComparer.Ordinal).Select(s => s.Url).Distinct().ToList(), complement);
    }

    private static PartyDto? Party(XrayCandidacyRow c) =>
        c.PartyNumber is null && c.PartyAcronym is null ? null : new PartyDto(c.PartyNumber, c.PartyAcronym, c.PartyName);

    public async Task<XrayResponse> BuildAsync(Guid politicianId, CancellationToken ct)
    {
        var politician = await repo.PoliticianAsync(politicianId, ct)
            ?? throw new ElectoralNotFoundException($"Político {politicianId} não encontrado.");
        var rows = await repo.SubjectCandidaciesAsync(politicianId, politician.PersonId, ct);
        var freshness = Freshness(await repo.FreshnessAsync(ct));
        if (rows.Count == 0)
            return new XrayResponse(politicianId, politician.PersonId, politician.Name, [], [], [], [], [], freshness, Definitions);

        var ids = rows.Select(r => r.Id).ToList();
        var tickets = (await repo.TicketsAsync(ids, ct)).GroupBy(t => t.CandidacyId).ToDictionary(g => g.Key, g => g.First());
        var headIds = tickets.Values.Select(t => t.HeadCandidacyId).Where(h => !ids.Contains(h)).Distinct().ToList();
        var heads = headIds.Count > 0 ? await repo.CandidaciesAsync(headIds, ct) : [];
        var all = rows.Concat(heads).ToList();
        var allIds = all.Select(r => r.Id).ToList();
        var keys = all.Select(r => ContestInfo.From(r).CoverageKey).Distinct().ToList();
        var elections = all.Select(r => ((int)r.Year, (int)r.Round)).Distinct().ToList();

        var index = new VoteIndex(
            await repo.ZoneVotesAsync(allIds, null, null, ct),
            await repo.ZoneTotalsAsync(keys, null, null, ct),
            await repo.ExpectedZonesAsync(elections, null, null, ct));
        var ranks = (await repo.RanksAsync(ids, ct)).ToDictionary(r => r.CandidacyId);
        var assets = (await repo.AssetsAsync(ids, ct)).GroupBy(a => a.CandidacyId).ToDictionary(g => g.Key, g => (IReadOnlyList<AssetRow>)g.ToList());
        var records = (await repo.RecordsAsync(ids, ct)).GroupBy(r => r.CandidacyId).ToDictionary(g => g.Key, g => Records(g));
        var finance = (await repo.FinanceTotalsAsync(ids, ct)).GroupBy(f => f.CandidacyId).ToDictionary(g => g.Key, g => g.ToList());
        var priors = await repo.PriorsAsync(ids, ct);
        var byId = all.ToDictionary(r => r.Id);

        var aggregates = all.ToDictionary(r => r.Id, r => index.Aggregate(r, new TerritoryFilter(null)));
        var ordered = rows
            .OrderByDescending(r => r.Year).ThenByDescending(r => r.Round).ThenBy(r => r.OfficeCode).ThenBy(r => r.TseCandidateId)
            .ToList();

        var candidacies = new List<XrayCandidacyDto>(ordered.Count);
        foreach (var c in ordered)
        {
            var contest = ContestInfo.From(c);
            var agg = aggregates[c.Id];
            var rank = ranks.GetValueOrDefault(c.Id);
            var coverageComplete = Comparability.IsComplete(agg.State) && contest.Scope != "federal";
            var coverageNote = contest.Scope == "federal"
                ? $"Disputa nacional: votos somados apenas nas UFs importadas ({agg.ZonesCovered} zonas); outras UFs e exterior não importados."
                : agg.ZonesExpected == 0
                    ? "Sem cadastro eleitoral importado para a unidade da disputa."
                    : agg.ZonesCovered == agg.ZonesExpected
                        ? "Todas as zonas da unidade da disputa têm Boletim de Urna importado."
                        : $"Cobertura parcial: {agg.ZonesCovered} de {agg.ZonesExpected} zonas com Boletim de Urna importado.";
            var totals = new CandidacyTotalsDto(
                agg.Votes, agg.ValidVotes > 0 ? agg.ValidVotes : null, agg.Share,
                coverageComplete && Comparability.IsComplete(agg.State) ? rank?.Rank : null,
                coverageComplete ? rank?.CandidatesWithVotes : null,
                agg.State, new CoverageSummaryDto(coverageComplete, agg.ZonesCovered, agg.ZonesExpected, coverageNote));

            TicketDto? ticket = null;
            if (Comparability.IsTicketMember(c.OfficeCode))
            {
                if (tickets.TryGetValue(c.Id, out var t) && byId.TryGetValue(t.HeadCandidacyId, out var head))
                {
                    var headAgg = aggregates[head.Id];
                    ticket = new TicketDto(
                        TicketRole(c.OfficeCode), head.Id, head.BallotName, head.OfficeCode, headAgg.Votes, headAgg.Share,
                        $"Votado(a) na chapa de {head.BallotName} ({head.OfficeName}): os votos são da chapa.");
                }
                else
                {
                    ticket = new TicketDto(TicketRole(c.OfficeCode), null, null, null, null, null,
                        "Titular da chapa não encontrado entre as candidaturas importadas.");
                }
            }

            var assetRows = assets.GetValueOrDefault(c.Id);
            var financeRows = finance.GetValueOrDefault(c.Id);
            candidacies.Add(new XrayCandidacyDto(
                c.Id, c.TseCandidateId, contest.ToDto(), c.CandidateNumber, c.BallotName, Party(c), c.FederationAcronym,
                c.CoalitionName, c.CandidacyStatus, c.RoundOutcome, c.Elected, c.IdentityStatus, c.IdentityMethod, ticket, totals,
                assetRows is null ? null : new AssetsSummaryDto(assetRows.Count, assetRows.Sum(a => a.Value)),
                financeRows is null ? null : new FinanceSummaryDto(
                    Sum(financeRows, "revenue"), Sum(financeRows, "expense_contracted"), Sum(financeRows, "expense_paid"),
                    financeRows.Sum(f => f.Records), financeRows.Select(f => f.AccountsType).FirstOrDefault(a => a is not null)),
                records.GetValueOrDefault(c.Id) ?? new CandidacyRecordsDto([], null),
                new CandidacySourceDto("Tribunal Superior Eleitoral · Dados Abertos (Candidatos)", c.SourceUrl, c.SourceZipSha256,
                    c.SourceMember, c.SourceLine)));
        }

        // Evolução: candidaturas próprias (não vice/suplente) em ordem cronológica. Cada uma é comparada à anterior
        // da MESMA disputa (cargo + unidade) quando existe — Dep. Federal 2022 → 2026 com uma prefeitura em 2024 no
        // meio —; senão à imediatamente anterior, que aparece sem delta (cargo ou unidade diferente).
        var chronological = rows.Where(r => !Comparability.IsTicketMember(r.OfficeCode))
            .OrderBy(r => r.Year).ThenBy(r => r.Round).ThenBy(r => r.OfficeCode).ToList();
        var evolution = new List<EvolutionStepDto>();
        for (var i = 1; i < chronological.Count; i++)
        {
            var to = chronological[i];
            var from = chronological.Take(i).LastOrDefault(p => SameContest(p, to)) ?? chronological[i - 1];
            var a = aggregates[from.Id];
            var b = aggregates[to.Id];
            var comparability = Comparability.Contest(
                ContestInfo.From(from), ContestInfo.From(to), Comparability.IsComplete(a.State), Comparability.IsComplete(b.State));
            var comparable = comparability == ContestComparability.Comparable;
            var (delta, pct) = comparable ? Comparability.Delta(a.Votes, b.Votes) : (null, null);
            evolution.Add(new EvolutionStepDto(
                from.Id, to.Id, comparability, a.Votes, b.Votes, delta, pct, a.Share, b.Share,
                comparable ? Comparability.DeltaPoints(a.Share, b.Share) : null));
        }

        // Evolução de bens: candidaturas com bens declarados, em ordem cronológica.
        var withAssets = rows.Where(r => assets.ContainsKey(r.Id)).OrderBy(r => r.Year).ThenBy(r => r.Round).ToList();
        var assetsEvolution = new List<AssetsStepDto>();
        for (var i = 1; i < withAssets.Count; i++)
        {
            var from = assets[withAssets[i - 1].Id];
            var to = assets[withAssets[i].Id];
            var (added, removed, kept, _) = DiffAssets(from, to);
            var fromTotal = from.Sum(a => a.Value);
            var toTotal = to.Sum(a => a.Value);
            assetsEvolution.Add(new AssetsStepDto(
                withAssets[i - 1].Id, withAssets[i].Id, fromTotal, toTotal, toTotal - fromTotal,
                fromTotal > 0 ? Math.Round((double)((toTotal - fromTotal) * 100 / fromTotal), 2, MidpointRounding.AwayFromZero) : null,
                added, removed, kept));
        }

        var insights = await InsightsAsync(rows, aggregates, ranks, evolution, assetsEvolution, byId, ct);
        var history = OfficialHistory(priors, rows);
        return new XrayResponse(
            politicianId, politician.PersonId, politician.Name, candidacies, history, evolution, assetsEvolution, insights,
            freshness, Definitions);
    }

    private static bool SameContest(XrayCandidacyRow a, XrayCandidacyRow b) =>
        a.OfficeCode == b.OfficeCode && a.Scope == b.Scope && a.ElectoralUnit == b.ElectoralUnit;

    private static decimal? Sum(List<FinanceTotalsRow> rows, string kind)
    {
        var matching = rows.Where(r => r.RecordKind == kind).ToList();
        return matching.Count == 0 ? null : matching.Sum(r => r.Amount);
    }

    private static IReadOnlyList<PriorCandidacyDto> OfficialHistory(IReadOnlyList<PriorRow> priors, IReadOnlyList<XrayCandidacyRow> rows)
    {
        var own = rows.Select(r => (r.Year, r.TseCandidateId)).ToHashSet();
        return priors
            .GroupBy(p => (p.PriorYear, p.PriorTurn, p.PriorTseCandidateId))
            .Select(g => g.First())
            .OrderByDescending(p => p.PriorYear).ThenByDescending(p => p.PriorTurn)
            .Select(p => new PriorCandidacyDto(
                p.PriorYear, p.PriorTurn, p.PriorTseCandidateId, p.PriorOfficeCode, p.PriorOfficeName, p.PriorElectoralUnit,
                p.PriorUnitName, p.PriorCandidateNumber, p.PriorBallotName, p.PriorPartyAcronym, p.PriorRoundOutcome,
                own.Contains((p.PriorYear, p.PriorTseCandidateId)) || p.ImportedCandidacyId is not null, p.ImportedCandidacyId))
            .ToList();
    }

    private async Task<IReadOnlyList<InsightDto>> InsightsAsync(
        IReadOnlyList<XrayCandidacyRow> rows,
        IReadOnlyDictionary<Guid, TerritoryAggregate> aggregates,
        IReadOnlyDictionary<Guid, ContestRankRow> ranks,
        IReadOnlyList<EvolutionStepDto> evolution,
        IReadOnlyList<AssetsStepDto> assetsEvolution,
        IReadOnlyDictionary<Guid, XrayCandidacyRow> byId,
        CancellationToken ct)
    {
        var insights = new List<InsightDto>();
        var latest = rows.Where(r => !Comparability.IsTicketMember(r.OfficeCode) && Comparability.HasCount(aggregates[r.Id].State))
            .OrderByDescending(r => r.Year).ThenByDescending(r => r.Round).FirstOrDefault();
        if (latest is not null)
        {
            var contest = ContestInfo.From(latest);
            var agg = aggregates[latest.Id];
            if (agg.State == CellState.PartialCoverage)
                insights.Add(InsightEngine.PartialCoverage(agg.ZonesCovered, agg.ZonesExpected));
            if (ranks.TryGetValue(latest.Id, out var rank) && rank.Rank is { } r && Comparability.IsComplete(agg.State)
                && contest.Scope != "federal")
                insights.Add(InsightEngine.Rank(contest, r, rank.CandidatesWithVotes, agg.Votes ?? 0));
            if (!string.IsNullOrWhiteSpace(latest.RoundOutcome))
                insights.Add(InsightEngine.Outcome(contest, latest.RoundOutcome!));

            // Distribuição por município da candidatura mais recente (mesmos agregados da API territorial).
            var uf = contest.Uf;
            var distribution = await DistributionByMunicipalityAsync(latest, uf, ct);
            var counted = distribution.Where(d => Comparability.HasCount(d.Aggregate.State)).ToList();
            var total = counted.Sum(d => d.Aggregate.Votes ?? 0);
            if (total > 0)
            {
                // disputa nacional (só as UFs importadas) ou cobertura parcial: o total não é a votação inteira
                var of = contest.Scope == "federal" || agg.State == CellState.PartialCoverage
                    ? DistributionBase.Imported
                    : DistributionBase.Candidacy;
                var top = counted.OrderByDescending(d => d.Aggregate.Votes).First();
                insights.Add(InsightEngine.TopTerritory("municipality", top.Name, top.Aggregate.Votes ?? 0, total, of));
                if (counted.Count > 5)
                {
                    var top5 = counted.OrderByDescending(d => d.Aggregate.Votes).Take(5).Sum(d => d.Aggregate.Votes ?? 0);
                    insights.Add(InsightEngine.Concentration("municipality", 5, Comparability.Pct(top5, total) ?? 0, of));
                }
                insights.Add(InsightEngine.Reach("municipality", counted.Count(d => d.Aggregate.Votes > 0), counted.Count));
            }
        }

        if (evolution.Count > 0)
        {
            var step = evolution[^1];
            insights.Add(InsightEngine.Evolution(ContestInfo.From(byId[step.FromCandidacyId]), ContestInfo.From(byId[step.ToCandidacyId]), step));
        }
        if (assetsEvolution.Count > 0)
        {
            var step = assetsEvolution[^1];
            insights.Add(InsightEngine.Assets(step, byId[step.FromCandidacyId].Year, byId[step.ToCandidacyId].Year));
        }
        return insights;
    }

    internal sealed record NamedAggregate(string Uf, string MunicipalityTseCode, string Name, int? IbgeCode, TerritoryAggregate Aggregate);

    /// <summary>Agregados por município de uma candidatura (unidade da disputa; UF opcional para disputas nacionais).</summary>
    internal async Task<IReadOnlyList<NamedAggregate>> DistributionByMunicipalityAsync(
        XrayCandidacyRow candidacy, string? uf, CancellationToken ct)
    {
        var contest = ContestInfo.From(candidacy);
        var municipality = contest.Scope == "municipal" ? contest.ElectoralUnit : null;
        var index = new VoteIndex(
            await repo.ZoneVotesAsync([candidacy.Id], uf, municipality, ct),
            await repo.ZoneTotalsAsync([contest.CoverageKey], uf, municipality, ct),
            await repo.ExpectedZonesAsync([(contest.Year, contest.Round)], uf, municipality, ct));
        var names = new Dictionary<(string, string), (string Name, int? Ibge)>();
        foreach (var e in index.Expected(contest.Year, contest.Round))
            names.TryAdd((e.Uf, e.MunicipalityTseCode), (e.MunicipalityName, e.IbgeCode));
        foreach (var t in index.Totals(contest.CoverageKey))
            names.TryAdd((t.Uf, t.MunicipalityTseCode), (t.MunicipalityName ?? t.MunicipalityTseCode, null));
        return names
            .Where(n => contest.Contains(n.Key.Item1, n.Key.Item2))
            .Select(n => new NamedAggregate(n.Key.Item1, n.Key.Item2, n.Value.Name, n.Value.Ibge,
                index.Aggregate(candidacy, new TerritoryFilter(n.Key.Item1, n.Key.Item2))))
            .ToList();
    }
}
