using System.Reflection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;
using RepBrasil.API.Accounts;

namespace RepBrasil.Tests.Api;

/// <summary>Catálogo de planos, resolução do acesso efetivo e contrato dos filtros (sem banco).</summary>
public sealed class PlanCatalogTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 20, 12, 0, 0, TimeSpan.Zero);

    private static SubscriptionFact Subscription(string plan, string status, DateTimeOffset? periodEnd = null, DateTimeOffset? created = null) =>
        new(Guid.NewGuid(), plan, status, "manual", periodEnd, false, created ?? Now.AddDays(-10));

    private static EntitlementFact Grant(string key, string value, DateTimeOffset? starts = null, DateTimeOffset? expires = null, string source = "admin") =>
        new(key, value, source, starts ?? Now.AddDays(-1), expires);

    private static EffectiveAccess Resolve(IReadOnlyList<SubscriptionFact>? subscriptions = null, IReadOnlyList<EntitlementFact>? entitlements = null, bool configured = false) =>
        EntitlementResolver.Resolve(configured, subscriptions ?? [], entitlements ?? [], Now);

    [Fact]
    public void Catalog_has_exactly_the_three_plans_with_the_published_monthly_prices()
    {
        Assert.Equal(["FREE", "ADVANCED", "PROFESSIONAL"], PlanCatalog.Plans.OrderBy(p => p.Rank).Select(p => p.Code));
        Assert.Equal(0, PlanCatalog.Get(PlanCatalog.Free).MonthlyPriceCents);
        Assert.Equal(2490, PlanCatalog.Get(PlanCatalog.Advanced).MonthlyPriceCents);
        Assert.Equal(6990, PlanCatalog.Get(PlanCatalog.Professional).MonthlyPriceCents);
        Assert.Equal([PlanCatalog.Advanced], PlanCatalog.Plans.Where(p => p.Recommended).Select(p => p.Code));
    }

    [Fact]
    public void Limits_and_features_match_the_published_table()
    {
        var expected = new Dictionary<string, (int Free, int Advanced, int Professional)>
        {
            [PlanCatalog.FavoritesLimit] = (10, 200, 1000),
            [PlanCatalog.WatchlistLimit] = (5, 100, 500),
            [PlanCatalog.AlertsLimit] = (3, 50, 200),
            [PlanCatalog.CompareLimit] = (5, 5, 10),
        };
        foreach (var (key, (free, advanced, professional)) in expected)
        {
            Assert.Equal(free, PlanCatalog.Get(PlanCatalog.Free).Limits[key]);
            Assert.Equal(advanced, PlanCatalog.Get(PlanCatalog.Advanced).Limits[key]);
            Assert.Equal(professional, PlanCatalog.Get(PlanCatalog.Professional).Limits[key]);
        }
        Assert.False(PlanCatalog.Get(PlanCatalog.Free).Features[PlanCatalog.SavedFolders]);
        Assert.False(PlanCatalog.Get(PlanCatalog.Advanced).Features[PlanCatalog.SavedFolders]);
        Assert.True(PlanCatalog.Get(PlanCatalog.Professional).Features[PlanCatalog.SavedFolders]);
    }

    [Fact]
    public void Every_plan_contains_the_one_below_and_every_capability_is_described()
    {
        var plans = PlanCatalog.Plans.OrderBy(p => p.Rank).ToList();
        foreach (var capability in PlanCatalog.Capabilities)
        {
            Assert.False(string.IsNullOrWhiteSpace(capability.Label));
            Assert.False(string.IsNullOrWhiteSpace(capability.Description));
            foreach (var plan in plans)
            {
                if (capability.Kind == CapabilityDefinition.Feature) Assert.True(plan.Features.ContainsKey(capability.Key), $"{plan.Code} sem {capability.Key}");
                else Assert.True(plan.Limits.ContainsKey(capability.Key), $"{plan.Code} sem {capability.Key}");
            }
        }
        for (var i = 1; i < plans.Count; i++)
        {
            foreach (var (key, on) in plans[i - 1].Features) Assert.True(!on || plans[i].Features[key], $"{plans[i].Code} perde {key}");
            foreach (var (key, max) in plans[i - 1].Limits) Assert.True(plans[i].Limits[key] >= max, $"{plans[i].Code} reduz {key}");
        }
        Assert.Equal(PlanCatalog.Capabilities.Count, PlanCatalog.Capabilities.Select(c => c.Key).Distinct().Count());
    }

    [Fact]
    public void Smallest_plan_that_solves_is_offered()
    {
        Assert.Equal(PlanCatalog.Professional, PlanCatalog.MinimumPlanWith(PlanCatalog.SavedFolders)?.Code);
        Assert.Equal(PlanCatalog.Advanced, PlanCatalog.MinimumPlanAbove(PlanCatalog.FavoritesLimit, 10)?.Code);
        Assert.Equal(PlanCatalog.Professional, PlanCatalog.MinimumPlanAbove(PlanCatalog.CompareLimit, 5)?.Code);
        Assert.Null(PlanCatalog.MinimumPlanAbove(PlanCatalog.FavoritesLimit, 1000));
    }

    [Fact]
    public void Anonymous_and_accounts_without_facts_are_free()
    {
        Assert.Equal(PlanCatalog.Free, EntitlementResolver.Anonymous.Plan);
        var access = Resolve();
        Assert.Equal((PlanCatalog.Free, EntitlementResolver.SourceDefault, EntitlementResolver.UserRole), (access.Plan, access.PlanSource, access.Role));
        Assert.Equal(10, access.Limit(PlanCatalog.FavoritesLimit));
        Assert.False(access.Has(PlanCatalog.SavedFolders));
        Assert.Null(access.Subscription);
    }

    [Theory]
    [InlineData("active", null, "ADVANCED")]
    [InlineData("active", 5, "ADVANCED")]
    [InlineData("active", -1, "FREE")]
    [InlineData("past_due", 5, "ADVANCED")]
    [InlineData("canceled", 5, "ADVANCED")]
    [InlineData("canceled", -1, "FREE")]
    [InlineData("canceled", null, "FREE")]
    [InlineData("expired", 5, "FREE")]
    public void Subscription_counts_only_while_it_is_alive(string status, int? periodEndInDays, string expected)
    {
        var access = Resolve([Subscription(PlanCatalog.Advanced, status, periodEndInDays is null ? null : Now.AddDays(periodEndInDays.Value))]);
        Assert.Equal(expected, access.Plan);
        Assert.Equal(expected == PlanCatalog.Free ? EntitlementResolver.SourceDefault : EntitlementResolver.SourceSubscription, access.PlanSource);
        Assert.NotNull(access.Subscription);
    }

    [Fact]
    public void Manual_plan_and_superadmin_raise_the_plan_to_the_highest_source()
    {
        var manual = Resolve([Subscription(PlanCatalog.Advanced, "active")], [Grant(EntitlementResolver.PlanKey, PlanCatalog.Professional)]);
        Assert.Equal((PlanCatalog.Professional, EntitlementResolver.SourceManual), (manual.Plan, manual.PlanSource));

        var lowerManual = Resolve([Subscription(PlanCatalog.Professional, "active")], [Grant(EntitlementResolver.PlanKey, PlanCatalog.Advanced)]);
        Assert.Equal((PlanCatalog.Professional, EntitlementResolver.SourceSubscription), (lowerManual.Plan, lowerManual.PlanSource));

        var configured = Resolve(configured: true);
        Assert.Equal((PlanCatalog.Professional, EntitlementResolver.SourceRole, EntitlementResolver.SuperadminRole), (configured.Plan, configured.PlanSource, configured.Role));
        Assert.True(configured.IsSuperadmin);

        var granted = Resolve(entitlements: [Grant(EntitlementResolver.RoleKey, EntitlementResolver.SuperadminRole)]);
        Assert.True(granted.IsSuperadmin);
        Assert.Equal(PlanCatalog.Professional, granted.Plan);
    }

    [Fact]
    public void Expired_future_and_unknown_entitlements_are_ignored()
    {
        var access = Resolve(entitlements:
        [
            Grant(EntitlementResolver.PlanKey, PlanCatalog.Professional, expires: Now.AddMinutes(-1)),
            Grant(EntitlementResolver.RoleKey, EntitlementResolver.SuperadminRole, starts: Now.AddMinutes(5)),
            Grant(EntitlementResolver.PlanKey, "ENTERPRISE", source: "promo"),
            Grant("limit.unknown", "999"),
            Grant(PlanCatalog.FavoritesLimit, "-3"),
            Grant(PlanCatalog.SavedFolders, "talvez"),
        ]);
        Assert.Equal((PlanCatalog.Free, EntitlementResolver.UserRole), (access.Plan, access.Role));
        Assert.Equal(10, access.Limit(PlanCatalog.FavoritesLimit));
        Assert.False(access.Has(PlanCatalog.SavedFolders));
        Assert.False(access.Limits.ContainsKey("limit.unknown"));
    }

    [Fact]
    public void Capability_and_limit_grants_override_the_plan_and_the_latest_grant_wins()
    {
        var access = Resolve([Subscription(PlanCatalog.Professional, "active")],
        [
            Grant(PlanCatalog.SavedFolders, "false"),
            Grant(PlanCatalog.FavoritesLimit, "40", starts: Now.AddDays(-5), source: "promo"),
            Grant(PlanCatalog.FavoritesLimit, "25", starts: Now.AddDays(-1)),
            Grant(PlanCatalog.CompareLimit, "7"),
        ]);
        Assert.Equal(PlanCatalog.Professional, access.Plan);
        Assert.False(access.Has(PlanCatalog.SavedFolders));
        Assert.Equal(25, access.Limit(PlanCatalog.FavoritesLimit));
        Assert.Equal(7, access.Limit(PlanCatalog.CompareLimit));
        Assert.Equal(500, access.Limit(PlanCatalog.WatchlistLimit));

        var freeWithFolders = Resolve(entitlements: [Grant(PlanCatalog.SavedFolders, "true")]);
        Assert.Equal(PlanCatalog.Free, freeWithFolders.Plan);
        Assert.True(freeWithFolders.Has(PlanCatalog.SavedFolders));
    }

    [Fact]
    public void Live_subscription_is_shown_before_an_older_finished_one()
    {
        var expired = Subscription(PlanCatalog.Professional, "expired", Now.AddDays(-40), created: Now.AddDays(-1));
        var active = Subscription(PlanCatalog.Advanced, "active", Now.AddDays(20), created: Now.AddDays(-60));
        var access = Resolve([expired, active]);
        Assert.Equal(active.Id, access.Subscription?.Id);
        Assert.Equal(PlanCatalog.Advanced, access.Plan);
    }

    [Theory]
    [InlineData("indicator", "ibge.population", "new_edition", true)]
    [InlineData("indicator", "Ibge Population", "new_edition", false)]
    [InlineData("state", "CE", "amendments_update", true)]
    [InlineData("state", "ZZ", "amendments_update", false)]
    [InlineData("election", "2026:3:CE", "polls_update", true)]
    [InlineData("election", "2026:1:BR", "live_count_update", true)]
    [InlineData("election", "2026:3:ZZ", "polls_update", false)]
    [InlineData("election", "2026:99:CE", "polls_update", false)]
    [InlineData("municipality", "2304400", "live_count_update", true)]
    [InlineData("municipality", "ce/fortaleza", "live_count_update", false)]
    [InlineData("state", "CE", "new_edition", false)]
    [InlineData("politician", "abc", "new_edition", false)]
    public void Alert_catalog_accepts_only_alerts_that_have_a_producer(string type, string key, string kind, bool valid)
    {
        var error = Record.Exception(() => AlertCatalog.Validate(type, key, kind, "in_app"));
        Assert.Equal(valid, error is null);
        if (!valid) Assert.IsType<ArgumentException>(error);
    }

    [Fact]
    public void Email_delivery_is_refused_until_alert_emails_exist()
    {
        var error = Assert.Throws<ArgumentException>(() => AlertCatalog.Validate("state", "CE", "amendments_update", "email"));
        Assert.Contains("e-mail", error.Message);
    }

    /// <summary>
    /// O cache de saída roda antes dos filtros: ação protegida por sessão ou plano com cache compartilhado serviria a
    /// resposta de uma conta para qualquer pessoa. Toda ação protegida precisa recusar armazenamento.
    /// </summary>
    [Fact]
    public void Protected_actions_never_use_the_shared_output_cache()
    {
        var actions = typeof(RepBrasil.API.Controllers.AccountController).Assembly.GetTypes()
            .Where(t => typeof(ControllerBase).IsAssignableFrom(t))
            .SelectMany(t => t.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly).Select(m => (Type: t, Method: m)))
            .Where(a => a.Method.GetCustomAttributes<RequiresSessionAttribute>().Any() || a.Method.GetCustomAttributes<RequiresCapabilityAttribute>().Any())
            .ToList();
        Assert.NotEmpty(actions);
        foreach (var (type, method) in actions)
        {
            var policy = method.GetCustomAttribute<OutputCacheAttribute>() ?? type.GetCustomAttribute<OutputCacheAttribute>();
            Assert.True(policy is null || policy.NoStore, $"{type.Name}.{method.Name} protegido com cache compartilhado");
        }
    }
}
