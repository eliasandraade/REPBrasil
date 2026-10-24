namespace RepBrasil.Application.LiveElection;

/// <summary>Estados visuais da apuração (máquina de estados única; nada de booleanos espalhados).</summary>
public enum LivePhase
{
    PRE_ELECTION,
    WAITING_FOR_RELEASE,
    LIVE,
    LIVE_STALE,
    MATHEMATICALLY_DEFINED,
    FINALIZING,
    FINAL,
    SOURCE_ERROR,
}

public sealed record PhaseInput(
    TerritorySnapshot? National,
    bool SourceStale,
    bool SourceFailing,
    DateTimeOffset Now,
    DateTimeOffset? TotalizationStartsAt);

public static class LivePhases
{
    /// <summary>
    /// Precedência: sem snapshot → erro de fonte (se falhando) ou pré-eleição; tf = s → FINAL; md = e (com tf = n) →
    /// MATHEMATICALLY_DEFINED; and = n → pré-eleição antes das 17h ou aguardando liberação depois; dv = n → aguardando
    /// liberação; 100% das seções sem totalização final → FINALIZING; fonte defasada → LIVE_STALE; senão LIVE.
    /// "Matematicamente definido" e "totalização final" são estados distintos: md = e pode conviver com tf = n.
    /// </summary>
    public static LivePhase Resolve(PhaseInput input)
    {
        var s = input.National;
        if (s is null)
            return input.SourceFailing ? LivePhase.SOURCE_ERROR : LivePhase.PRE_ELECTION;
        if (s.FinalTotalization == true) return LivePhase.FINAL;
        if (s.MathFlag == "e") return LivePhase.MATHEMATICALLY_DEFINED;
        if (s.Progress == "n")
            return input.TotalizationStartsAt is { } start && input.Now >= start ? LivePhase.WAITING_FOR_RELEASE : LivePhase.PRE_ELECTION;
        if (s.VotesReleased == false) return LivePhase.WAITING_FOR_RELEASE;
        if (s.Sections.NotTotalized == 0 && s.Sections.Total > 0) return LivePhase.FINALIZING;
        if (input.SourceStale || input.SourceFailing) return LivePhase.LIVE_STALE;
        return LivePhase.LIVE;
    }

    /// <summary>Andamento oficial (and) no vocabulário do contrato.</summary>
    public static string ProgressName(string? progress) => progress switch
    {
        "p" => "partial",
        "f" => "finished",
        _ => "not-started",
    };
}

/// <summary>Grandes regiões do IBGE (geografia fixa; não é dado eleitoral).</summary>
public static class Regions
{
    public static readonly IReadOnlyDictionary<string, string> ByUf = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["ac"] = "N",
        ["am"] = "N",
        ["ap"] = "N",
        ["pa"] = "N",
        ["ro"] = "N",
        ["rr"] = "N",
        ["to"] = "N",
        ["al"] = "NE",
        ["ba"] = "NE",
        ["ce"] = "NE",
        ["ma"] = "NE",
        ["pb"] = "NE",
        ["pe"] = "NE",
        ["pi"] = "NE",
        ["rn"] = "NE",
        ["se"] = "NE",
        ["df"] = "CO",
        ["go"] = "CO",
        ["ms"] = "CO",
        ["mt"] = "CO",
        ["es"] = "SE",
        ["mg"] = "SE",
        ["rj"] = "SE",
        ["sp"] = "SE",
        ["pr"] = "S",
        ["rs"] = "S",
        ["sc"] = "S",
    };

    public static readonly IReadOnlyList<(string Code, string Name)> All =
    [
        ("N", "Norte"),
        ("NE", "Nordeste"),
        ("CO", "Centro-Oeste"),
        ("SE", "Sudeste"),
        ("S", "Sul"),
    ];

    public static readonly IReadOnlyDictionary<string, string> UfNames = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["ac"] = "Acre",
        ["al"] = "Alagoas",
        ["am"] = "Amazonas",
        ["ap"] = "Amapá",
        ["ba"] = "Bahia",
        ["ce"] = "Ceará",
        ["df"] = "Distrito Federal",
        ["es"] = "Espírito Santo",
        ["go"] = "Goiás",
        ["ma"] = "Maranhão",
        ["mg"] = "Minas Gerais",
        ["ms"] = "Mato Grosso do Sul",
        ["mt"] = "Mato Grosso",
        ["pa"] = "Pará",
        ["pb"] = "Paraíba",
        ["pe"] = "Pernambuco",
        ["pi"] = "Piauí",
        ["pr"] = "Paraná",
        ["rj"] = "Rio de Janeiro",
        ["rn"] = "Rio Grande do Norte",
        ["ro"] = "Rondônia",
        ["rr"] = "Roraima",
        ["rs"] = "Rio Grande do Sul",
        ["sc"] = "Santa Catarina",
        ["se"] = "Sergipe",
        ["sp"] = "São Paulo",
        ["to"] = "Tocantins",
        ["zz"] = "Exterior",
    };

    public static string? Of(string? uf) => uf is not null && ByUf.TryGetValue(uf, out var region) ? region : null;

    public static string NameOfUf(string uf) => UfNames.TryGetValue(uf, out var name) ? name : uf.ToUpperInvariant();
}
