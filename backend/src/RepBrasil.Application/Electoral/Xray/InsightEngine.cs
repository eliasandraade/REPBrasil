namespace RepBrasil.Application.Electoral;

/// <summary>
/// Insights determinísticos: dados → métrica → template textual. Cada insight devolve os valores
/// estruturados usados no texto; nada aqui é opinião, previsão ou causalidade.
/// </summary>
public static class InsightEngine
{
    public const string AssetsDisclaimer = "Variação de bens declarados ao TSE não indica irregularidade.";

    public static string LevelLabel(string level, long count) => level switch
    {
        "state" => count == 1 ? "estado" : "estados",
        "municipality" => count == 1 ? "município" : "municípios",
        "zone" => count == 1 ? "zona" : "zonas",
        "section" => count == 1 ? "seção" : "seções",
        "place" => count == 1 ? "local de votação" : "locais de votação",
        _ => count == 1 ? "território" : "territórios",
    };

    private static InsightDto Make(string code, string text, params (string Key, object? Value)[] values) =>
        new(code, values.ToDictionary(v => v.Key, v => v.Value), text);

    public static InsightDto Rank(ContestInfo contest, int rank, int candidates, long votes) => Make(
        "rank_in_contest",
        $"{rank}º lugar entre {candidates} números votados para {contest.OfficeName} ({contest.UnitName ?? contest.ElectoralUnit}) em {Fmt.Election(contest.Year, contest.Round)}, com {Fmt.Int(votes)} votos.",
        ("year", contest.Year), ("round", contest.Round), ("officeCode", contest.OfficeCode), ("unit", contest.ElectoralUnit),
        ("rank", rank), ("candidatesWithVotes", candidates), ("votes", votes));

    public static InsightDto Outcome(ContestInfo contest, string outcome) => Make(
        "official_outcome",
        $"Resultado oficial do TSE em {Fmt.Election(contest.Year, contest.Round)} ({contest.OfficeName}): {outcome}.",
        ("year", contest.Year), ("round", contest.Round), ("officeCode", contest.OfficeCode), ("outcome", outcome));

    public static InsightDto Evolution(ContestInfo from, ContestInfo to, EvolutionStepDto step)
    {
        if (step.Comparability != ContestComparability.Comparable || step.DeltaVotes is null)
        {
            var reason = step.Comparability switch
            {
                ContestComparability.DifferentOffice => $"cargos diferentes ({from.OfficeName} e {to.OfficeName})",
                ContestComparability.DifferentTerritorialScope => $"unidades eleitorais diferentes ({from.UnitName ?? from.ElectoralUnit} e {to.UnitName ?? to.ElectoralUnit})",
                _ => "votação sem vínculo ou sem cobertura em uma das eleições",
            };
            return Make(
                "evolution_not_comparable",
                $"{Fmt.Election(from.Year, from.Round)} → {Fmt.Election(to.Year, to.Round)}: sem comparação direta de votos — {reason}.",
                ("fromCandidacyId", step.FromCandidacyId), ("toCandidacyId", step.ToCandidacyId), ("comparability", step.Comparability));
        }

        var pct = step.DeltaPercent is { } p ? $" ({Fmt.SignedPct(p)})" : "";
        return Make(
            "evolution_votes",
            $"{to.OfficeName}: {Fmt.Signed(step.DeltaVotes.Value)} votos{pct} de {Fmt.Election(from.Year, from.Round)} para {Fmt.Election(to.Year, to.Round)} ({Fmt.Int(step.FromVotes ?? 0)} → {Fmt.Int(step.ToVotes ?? 0)}).",
            ("fromCandidacyId", step.FromCandidacyId), ("toCandidacyId", step.ToCandidacyId),
            ("fromVotes", step.FromVotes), ("toVotes", step.ToVotes), ("deltaVotes", step.DeltaVotes),
            ("deltaPercent", step.DeltaPercent), ("deltaSharePoints", step.DeltaSharePoints));
    }

    public static InsightDto TopTerritory(string level, string label, long votes, long candidacyVotes) => Make(
        "top_territory",
        $"Maior votação: {label}, com {Fmt.Int(votes)} votos" + (Comparability.Pct(votes, candidacyVotes) is { } p ? $" ({Fmt.Pct(p)} da votação da candidatura)." : "."),
        ("level", level), ("territory", label), ("votes", votes), ("shareOfCandidacyVotes", Comparability.Pct(votes, candidacyVotes)));

    public static InsightDto BestShare(string level, string label, double share) => Make(
        "best_share_territory",
        $"Maior participação nos votos válidos: {label}, com {Fmt.Pct(share)}.",
        ("level", level), ("territory", label), ("share", share));

    public static InsightDto Concentration(string level, int top, double pct) => Make(
        "concentration_top",
        $"Os {top} {LevelLabel(level, top)} com mais votos somam {Fmt.Pct(pct)} da votação da candidatura.",
        ("level", level), ("top", top), ("share", pct));

    public static InsightDto Reach(string level, int withVotes, int covered) => Make(
        "territories_with_votes",
        $"Votos em {withVotes} de {covered} {LevelLabel(level, covered)} com Boletim de Urna da disputa.",
        ("level", level), ("territoriesWithVotes", withVotes), ("territoriesCovered", covered));

    public static InsightDto PartialCoverage(int imported, int expected) => Make(
        "coverage_partial",
        $"Votação parcial: {imported} de {expected} zonas da disputa têm Boletim de Urna importado.",
        ("zonesImported", imported), ("zonesExpected", expected));

    public static InsightDto Assets(AssetsStepDto step, int fromYear, int toYear)
    {
        var pct = step.DeltaPercent is { } p ? $"; {Fmt.SignedPct(p)}" : "";
        return Make(
            "assets_change",
            $"Bens declarados ao TSE: {Fmt.Money(step.FromTotal)} em {fromYear} → {Fmt.Money(step.ToTotal)} em {toYear} ({Fmt.SignedMoney(step.Delta)}{pct}). {AssetsDisclaimer}",
            ("fromCandidacyId", step.FromCandidacyId), ("toCandidacyId", step.ToCandidacyId), ("fromYear", fromYear),
            ("toYear", toYear), ("fromTotal", step.FromTotal), ("toTotal", step.ToTotal), ("delta", step.Delta),
            ("deltaPercent", step.DeltaPercent), ("added", step.Added), ("removed", step.Removed), ("kept", step.Kept));
    }

    public static InsightDto Overtake(string level, string a, string b, string fromElection, string toElection, int territories) => Make(
        "overtake",
        $"{a} passou à frente de {b} em {territories} {LevelLabel(level, territories)} de {fromElection} para {toElection}.",
        ("level", level), ("subject", a), ("overtakenSubject", b), ("fromElection", fromElection), ("toElection", toElection),
        ("territories", territories));

    public static InsightDto Extreme(string kind, string subject, string level, string label, long delta, double? pct,
        string fromElection, string toElection) => Make(
        kind == "growth" ? "largest_growth" : "largest_decline",
        $"{(kind == "growth" ? "Maior crescimento" : "Maior queda")} de {subject} de {fromElection} para {toElection}: {label} ({Fmt.Signed(delta)} votos{(pct is { } p ? $", {Fmt.SignedPct(p)}" : "")}).",
        ("subject", subject), ("level", level), ("territory", label), ("deltaVotes", delta), ("deltaPercent", pct),
        ("fromElection", fromElection), ("toElection", toElection));

    public static InsightDto Leadership(string level, string subject, string election, int led, int compared) => Make(
        "territorial_leadership",
        $"Em {election}, {subject} teve mais votos que as demais candidaturas selecionadas em {led} de {compared} {LevelLabel(level, compared)}.",
        ("level", level), ("subject", subject), ("election", election), ("led", led), ("compared", compared));

    public static InsightDto NotComparable(string a, string b, string comparability) => Make(
        "contest_not_comparable",
        comparability switch
        {
            ContestComparability.DifferentOffice => $"{a} e {b} disputaram cargos diferentes: votos lado a lado, sem comparação direta.",
            ContestComparability.DifferentTerritorialScope => $"{a} e {b} disputaram unidades eleitorais diferentes: votos lado a lado, sem comparação direta.",
            _ => $"{a} e {b}: comparação direta indisponível (sem vínculo auditado ou sem cobertura do BU).",
        },
        ("first", a), ("second", b), ("comparability", comparability));
}
