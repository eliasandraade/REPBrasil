namespace RepBrasil.API.Accounts;

/// <summary>Uma capability do catálogo: recurso (sim/não) ou limite numérico.</summary>
public sealed record CapabilityDefinition(string Key, string Kind, string Group, string Label, string Description)
{
    public const string Feature = "feature";
    public const string Limit = "limit";
}

/// <summary>Um plano: preço mensal em centavos de real, recursos e limites. Preço é texto de produto, não cobrança.</summary>
public sealed record PlanDefinition(
    string Code,
    int Rank,
    string Name,
    int MonthlyPriceCents,
    bool Recommended,
    string Summary,
    string Audience,
    IReadOnlyDictionary<string, bool> Features,
    IReadOnlyDictionary<string, int> Limits);

/// <summary>
/// Fonte única de planos, capabilities e limites. A API decide o acesso a partir daqui (<see cref="EntitlementResolver"/>)
/// e o frontend lê o mesmo catálogo em <c>GET /api/v1/plans</c>, sem regra própria.
///
/// O dado público essencial não está no catálogo: consulta, mapas, fontes, metodologia, proveniência e data de
/// atualização são de todos (<see cref="PublicBaseline"/>). Planos pagos acrescentam profundidade, conveniência e
/// ferramentas; nunca escondem a informação necessária à fiscalização democrática.
/// </summary>
public static class PlanCatalog
{
    public const string Free = "FREE";
    public const string Advanced = "ADVANCED";
    public const string Professional = "PROFESSIONAL";

    public const string FavoritesLimit = "limit.favorites";
    public const string WatchlistLimit = "limit.watchlist";
    public const string AlertsLimit = "limit.alerts";
    public const string CompareLimit = "limit.compare_candidacies";
    public const string SavedFolders = "account.saved_folders";
    public const string AdvancedMapModes = "map.advanced_modes";
    public const string MapSeries = "data.map_series";
    public const string CorrelationMatrix = "data.correlation_matrix";
    public const string ExportCsv = "data.export_csv";
    public const string ExportBulk = "data.export_bulk";
    public const string TerritorialDefault = "account.territorial_default";

    public static IReadOnlyList<CapabilityDefinition> Capabilities { get; } =
    [
        new(FavoritesLimit, CapabilityDefinition.Limit, "Conta", "Favoritos", "Páginas e entidades salvas para voltar depois."),
        new(WatchlistLimit, CapabilityDefinition.Limit, "Conta", "Watchlist", "Entidades que você acompanha de perto."),
        new(AlertsLimit, CapabilityDefinition.Limit, "Conta", "Alertas", "Aviso na conta quando uma nova edição oficial é carregada."),
        new(SavedFolders, CapabilityDefinition.Feature, "Conta", "Pastas", "Organizar favoritos e watchlist em pastas."),
        new(TerritorialDefault, CapabilityDefinition.Feature, "Conta", "Abrir no meu território",
            "As análises territoriais abrem na UF e no município do seu perfil. O atalho \"Meu estado\" é de todos."),
        new(CompareLimit, CapabilityDefinition.Limit, "Análise", "Candidaturas por comparação", "Quantas candidaturas entram numa mesma comparação."),
        new(AdvancedMapModes, CapabilityDefinition.Feature, "Dados e mapas", "Modos avançados do mapa",
            "Relevo 3D, intensidade (mapa de calor) e antes/depois com divisor. O mapa, a tabela e os valores continuam abertos a todos."),
        new(MapSeries, CapabilityDefinition.Feature, "Dados e mapas", "Linha do tempo do mapa",
            "A série inteira de uma camada numa consulta só (ex.: emendas de todos os anos), para reproduzir o mapa ano a ano. Cada ano continua aberto a todos."),
        new(CorrelationMatrix, CapabilityDefinition.Feature, "Dados e mapas", "Matriz de correlação",
            "Cruza de uma vez todos os indicadores com dados na UF. Cada par de indicadores continua aberto a todos."),
        new(ExportCsv, CapabilityDefinition.Feature, "Dados e mapas", "Exportar o recorte (CSV)",
            "Baixa os valores do recorte do mapa com fonte, conjunto de dados e data de coleta."),
        new(ExportBulk, CapabilityDefinition.Feature, "Dados e mapas", "Exportação completa da UF (CSV)",
            "Todos os indicadores carregados da UF num arquivo, com proveniência de cada valor."),
    ];

    /// <summary>O que todo mundo recebe, com ou sem conta, em qualquer plano.</summary>
    public static IReadOnlyList<string> PublicBaseline { get; } =
    [
        "Consulta a todos os dados públicos carregados",
        "Mapas, rankings, pesquisas, parlamento e perfis",
        "Comparação de até 5 candidaturas, com exportação",
        "Explorador territorial: mapa, tabela, correlação entre dois indicadores e agrupamentos",
        "Fontes, metodologia, proveniência e data de atualização",
    ];

    public static IReadOnlyList<PlanDefinition> Plans { get; } =
    [
        new(Free, 0, "Gratuito", 0, false,
            "Tudo o que é público, sem pagar nada. Com conta, você salva e acompanha o essencial.",
            "Para qualquer cidadão.",
            Features(folders: false, analysis: false, bulk: false),
            Limits(favorites: 10, watchlist: 5, alerts: 3, compare: 5)),
        new(Advanced, 1, "Avançado", 2490, true,
            "Para acompanhar a política com regularidade: mais itens salvos, alertas de novas edições oficiais e as ferramentas de análise do mapa.",
            "Para eleitores atentos, estudantes e pesquisadores.",
            Features(folders: false, analysis: true, bulk: false),
            Limits(favorites: 200, watchlist: 100, alerts: 50, compare: 5)),
        new(Professional, 2, "Profissional", 6990, false,
            "Para uso profissional: limites ampliados, pastas, comparação de até 10 candidaturas e exportação completa por UF.",
            "Para jornalistas, assessorias e profissionais do setor público.",
            Features(folders: true, analysis: true, bulk: true),
            Limits(favorites: 1000, watchlist: 500, alerts: 200, compare: 10)),
    ];

    public static PlanDefinition Get(string code) =>
        Plans.FirstOrDefault(plan => plan.Code == code) ?? throw new ArgumentException($"Plano desconhecido: {code}.", nameof(code));

    public static bool IsPlan(string? code) => Plans.Any(plan => plan.Code == code);

    public static bool IsPaidPlan(string? code) => IsPlan(code) && code != Free;

    public static bool IsFeature(string key) => Capabilities.Any(c => c.Key == key && c.Kind == CapabilityDefinition.Feature);

    public static bool IsLimit(string key) => Capabilities.Any(c => c.Key == key && c.Kind == CapabilityDefinition.Limit);

    public static CapabilityDefinition Capability(string key) =>
        Capabilities.FirstOrDefault(c => c.Key == key) ?? throw new ArgumentException($"Capability desconhecida: {key}.", nameof(key));

    /// <summary>Menor plano que inclui o recurso, ou nulo se nenhum inclui.</summary>
    public static PlanDefinition? MinimumPlanWith(string feature) =>
        Plans.OrderBy(p => p.Rank).FirstOrDefault(p => p.Features.TryGetValue(feature, out var on) && on);

    /// <summary>Menor plano cujo limite passa de <paramref name="current"/>, ou nulo se nenhum passa.</summary>
    public static PlanDefinition? MinimumPlanAbove(string limit, int current) =>
        Plans.OrderBy(p => p.Rank).FirstOrDefault(p => p.Limits.TryGetValue(limit, out var max) && max > current);

    /// <param name="folders">Pastas para favoritos e watchlist.</param>
    /// <param name="analysis">Ferramentas de análise: modos avançados do mapa, linha do tempo, matriz, exportação do recorte e abertura no território do perfil.</param>
    /// <param name="bulk">Exportação completa dos indicadores da UF.</param>
    private static Dictionary<string, bool> Features(bool folders, bool analysis, bool bulk) => new()
    {
        [SavedFolders] = folders,
        [AdvancedMapModes] = analysis,
        [MapSeries] = analysis,
        [CorrelationMatrix] = analysis,
        [ExportCsv] = analysis,
        [ExportBulk] = bulk,
        [TerritorialDefault] = analysis,
    };

    private static Dictionary<string, int> Limits(int favorites, int watchlist, int alerts, int compare) => new()
    {
        [FavoritesLimit] = favorites,
        [WatchlistLimit] = watchlist,
        [AlertsLimit] = alerts,
        [CompareLimit] = compare,
    };
}
