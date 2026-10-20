using System.Globalization;

namespace RepBrasil.API.Accounts;

/// <summary>Assinatura gravada (provedor <c>manual</c> enquanto não houver cobrança online).</summary>
public sealed record SubscriptionFact(
    Guid Id,
    string Plan,
    string Status,
    string Provider,
    DateTimeOffset? CurrentPeriodEnd,
    bool CancelAtPeriodEnd,
    DateTimeOffset CreatedAt);

/// <summary>Entitlement ativo da conta (<c>account.entitlement</c>).</summary>
public sealed record EntitlementFact(string Key, string Value, string Source, DateTimeOffset StartsAt, DateTimeOffset? ExpiresAt);

/// <summary>
/// Acesso efetivo de uma conta: papel, plano, de onde o plano vem, recursos e limites já com as concessões manuais.
/// É a única resposta que a API consulta para liberar ou recusar algo.
/// </summary>
public sealed record EffectiveAccess(
    string Role,
    string Plan,
    string PlanSource,
    IReadOnlyDictionary<string, bool> Features,
    IReadOnlyDictionary<string, int> Limits,
    SubscriptionFact? Subscription)
{
    public bool IsSuperadmin => Role == EntitlementResolver.SuperadminRole;

    public bool Has(string feature) => Features.TryGetValue(feature, out var on) && on;

    public int Limit(string key) => Limits.TryGetValue(key, out var max) ? max : 0;
}

/// <summary>
/// Resolve o acesso efetivo a partir dos fatos da conta. Função pura (o relógio entra como argumento), testada
/// sem banco.
///
/// Regras:
/// <list type="bullet">
/// <item>O plano efetivo é o maior entre: Gratuito; assinatura viva (<c>active</c>/<c>past_due</c> dentro do período,
/// ou <c>canceled</c> até o fim do período pago); entitlement <c>plan</c>; Profissional para Super Admin.</item>
/// <item>Super Admin vem da configuração (<c>Auth:SuperadminEmails</c>) ou do entitlement <c>account.role = superadmin</c>.</item>
/// <item>Entitlements com a chave de uma capability do catálogo sobrepõem o plano: <c>true</c>/<c>false</c> para recurso,
/// inteiro ≥ 0 para limite. Havendo mais de um para a mesma chave, vale o de início mais recente.</item>
/// <item>Chaves fora do catálogo são ignoradas.</item>
/// </list>
/// </summary>
public static class EntitlementResolver
{
    public const string UserRole = "user";
    public const string SuperadminRole = "superadmin";
    public const string RoleKey = "account.role";
    public const string PlanKey = "plan";

    public const string SourceDefault = "default";
    public const string SourceSubscription = "subscription";
    public const string SourceManual = "manual";
    public const string SourceRole = "role";

    public static EffectiveAccess Anonymous { get; } = FromPlan(UserRole, PlanCatalog.Free, SourceDefault, [], null);

    public static EffectiveAccess Resolve(
        bool configuredSuperadmin,
        IReadOnlyList<SubscriptionFact> subscriptions,
        IReadOnlyList<EntitlementFact> entitlements,
        DateTimeOffset now)
    {
        var active = entitlements
            .Where(e => e.StartsAt <= now && (e.ExpiresAt is null || e.ExpiresAt > now))
            .GroupBy(e => e.Key, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(e => e.StartsAt).ThenBy(e => e.Source, StringComparer.Ordinal).First(), StringComparer.Ordinal);

        var superadmin = configuredSuperadmin
            || (active.TryGetValue(RoleKey, out var role) && role.Value == SuperadminRole);

        var subscription = CurrentSubscription(subscriptions, now);
        var plan = PlanCatalog.Free;
        var source = SourceDefault;
        void Offer(string candidate, string from)
        {
            if (PlanCatalog.Get(candidate).Rank > PlanCatalog.Get(plan).Rank) (plan, source) = (candidate, from);
        }

        if (subscription is not null && Counts(subscription, now)) Offer(subscription.Plan, SourceSubscription);
        if (active.TryGetValue(PlanKey, out var manual) && PlanCatalog.IsPlan(manual.Value)) Offer(manual.Value, SourceManual);
        if (superadmin) Offer(PlanCatalog.Professional, SourceRole);

        return FromPlan(superadmin ? SuperadminRole : UserRole, plan, source, active.Values, subscription);
    }

    /// <summary>Assinatura que vale agora: <c>active</c>/<c>past_due</c> dentro do período; <c>canceled</c> até o fim do período pago.</summary>
    public static bool Counts(SubscriptionFact subscription, DateTimeOffset now) => subscription.Status switch
    {
        "active" or "past_due" => subscription.CurrentPeriodEnd is null || subscription.CurrentPeriodEnd > now,
        "canceled" => subscription.CurrentPeriodEnd > now,
        _ => false,
    };

    /// <summary>A assinatura que a conta mostra: a viva, se houver; senão a mais recente.</summary>
    private static SubscriptionFact? CurrentSubscription(IReadOnlyList<SubscriptionFact> subscriptions, DateTimeOffset now) =>
        subscriptions.Where(s => Counts(s, now)).OrderByDescending(s => PlanCatalog.IsPlan(s.Plan) ? PlanCatalog.Get(s.Plan).Rank : -1).FirstOrDefault()
        ?? subscriptions.OrderByDescending(s => s.CreatedAt).FirstOrDefault();

    private static EffectiveAccess FromPlan(string role, string planCode, string source, IEnumerable<EntitlementFact> overrides, SubscriptionFact? subscription)
    {
        var plan = PlanCatalog.Get(planCode);
        var features = new Dictionary<string, bool>(plan.Features, StringComparer.Ordinal);
        var limits = new Dictionary<string, int>(plan.Limits, StringComparer.Ordinal);
        foreach (var grant in overrides)
        {
            if (PlanCatalog.IsFeature(grant.Key) && bool.TryParse(grant.Value, out var on)) features[grant.Key] = on;
            else if (PlanCatalog.IsLimit(grant.Key) && int.TryParse(grant.Value, NumberStyles.None, CultureInfo.InvariantCulture, out var max)) limits[grant.Key] = max;
        }
        return new(role, planCode, source, features, limits, subscription);
    }
}
