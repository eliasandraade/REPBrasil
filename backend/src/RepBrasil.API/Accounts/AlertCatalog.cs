using System.Text.RegularExpressions;
using RepBrasil.Application.Territories;

namespace RepBrasil.API.Accounts;

/// <summary>Um tipo de alerta que o sistema sabe disparar: recurso, evento e formato da chave do recurso.</summary>
public sealed record AlertKindDefinition(string ResourceType, string EventKind, string Label, string Description, string KeyFormat);

/// <summary>
/// Os alertas que existem de verdade: cada um tem um produtor (<see cref="DataEditionAlertPublisher"/>) que observa
/// uma tabela de edições oficiais. Assinatura fora deste catálogo é recusada, porque nunca dispararia.
/// A entrega é na conta (<c>in_app</c>); e-mail ainda não é enviado, então não é aceito.
/// </summary>
public static partial class AlertCatalog
{
    public const string Indicator = "indicator";
    public const string State = "state";
    public const string Election = "election";
    public const string Municipality = "municipality";

    public const string NewEdition = "new_edition";
    public const string AmendmentsUpdate = "amendments_update";
    public const string PollsUpdate = "polls_update";
    public const string LiveCountUpdate = "live_count_update";

    public static IReadOnlyList<AlertKindDefinition> Kinds { get; } =
    [
        new(Indicator, NewEdition, "Nova edição de indicador",
            "Quando uma nova edição oficial do indicador socioeconômico é carregada.", "código do indicador, ex.: ibge.population"),
        new(State, AmendmentsUpdate, "Emendas parlamentares da UF",
            "Quando uma nova versão da base oficial de emendas da UF é carregada.", "sigla da UF, ex.: CE"),
        new(Election, PollsUpdate, "Pesquisas registradas",
            "Quando o registro oficial passa a ter pesquisas novas para o cargo e o território.", "ano:cargo:UF ou ano:cargo:BR, ex.: 2026:3:CE"),
        new(Election, LiveCountUpdate, "Apuração oficial (UF ou Brasil)",
            "Quando a totalização oficial do TSE começa, passa de 25%, 50% e 75% das seções e termina.", "ano:cargo:UF ou ano:cargo:BR, ex.: 2026:3:CE"),
        new(Municipality, LiveCountUpdate, "Apuração oficial (município)",
            "Quando a totalização oficial do município começa, passa de 25%, 50% e 75% das seções e termina.", "código IBGE de 7 dígitos"),
    ];

    public static AlertKindDefinition? Find(string resourceType, string eventKind) =>
        Kinds.FirstOrDefault(k => k.ResourceType == resourceType && k.EventKind == eventKind);

    /// <summary>Recusa (<see cref="ArgumentException"/>) tipo, evento, chave ou canal que o sistema não atende.</summary>
    public static void Validate(string resourceType, string resourceKey, string eventKind, string delivery)
    {
        if (delivery != "in_app") throw new ArgumentException("Por enquanto os alertas chegam só na sua conta; e-mail ainda não é enviado.");
        if (Find(resourceType, eventKind) is null) throw new ArgumentException("Tipo de alerta não disponível.");
        var valid = resourceType switch
        {
            Indicator => IndicatorKey().IsMatch(resourceKey),
            State => BrazilianStates.IsValid(resourceKey),
            Election => IsElectionKey(resourceKey),
            Municipality => TerritoryCatalogService.IsIbgeCode(resourceKey),
            _ => false,
        };
        if (!valid) throw new ArgumentException("Chave do alerta inválida para este tipo.");
    }

    /// <summary><c>ano:cargo:UF</c> ou <c>ano:cargo:BR</c>, com cargo do catálogo do TSE.</summary>
    public static bool IsElectionKey(string key)
    {
        var match = ElectionKey().Match(key);
        return match.Success && (match.Groups["scope"].Value == "BR" || BrazilianStates.IsValid(match.Groups["scope"].Value));
    }

    public static string ElectionKeyFor(int year, int office, string? uf) => $"{year}:{office}:{uf ?? "BR"}";

    [GeneratedRegex("^[a-z][a-z0-9_]*(\\.[a-z0-9_]+)+$", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 100)]
    private static partial Regex IndicatorKey();

    [GeneratedRegex("^(19|20|21)[0-9]{2}:(1[0-3]|[1-9]):(?<scope>[A-Z]{2})$", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 100)]
    private static partial Regex ElectionKey();
}
