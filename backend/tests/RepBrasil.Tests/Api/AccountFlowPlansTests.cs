using System.Net;
using System.Text.Json;
using RepBrasil.API.Accounts;
using RepBrasil.API.Infrastructure;
using RepBrasil.Tests.Electoral;
using static RepBrasil.Tests.Api.AccountTestKit;

namespace RepBrasil.Tests.Api;

/// <summary>
/// Planos, perfil e limites ponta a ponta contra o banco de teste: o servidor decide plano, recursos e limites;
/// o perfil é validado e persistido; itens além do limite são recusados sem apagar os existentes.
/// </summary>
public sealed class AccountFlowPlansTests
{
    private static Task<object?> Subscribe(Guid user, string plan, string status = "active", string periodEnd = "now() + interval '30 days'") =>
        Scalar($"""
            INSERT INTO account.subscription (id, user_id, plan, status, current_period_end)
            VALUES (gen_random_uuid(), @user, @plan, @status, {periodEnd})
            """, ("user", user), ("plan", plan), ("status", status));

    private static Task<object?> Grant(Guid user, string key, string value) =>
        Scalar("""
            INSERT INTO account.entitlement (id, user_id, entitlement_key, entitlement_value, source, starts_at)
            VALUES (gen_random_uuid(), @user, @key, @value, 'admin', now() - interval '1 minute')
            ON CONFLICT (user_id, entitlement_key, source) DO UPDATE SET entitlement_value = EXCLUDED.entitlement_value, starts_at = EXCLUDED.starts_at
            """, ("user", user), ("key", key), ("value", value));

    private static object Favorite(string key, string collection = "favorite") =>
        new { collection, resourceType = "ranking", resourceKey = key, label = key, href = key, metadata = new { } };

    private static async Task<JsonElement> Me(HttpClient browser, SignedIn user)
    {
        var (status, body) = await Send(browser, Request(HttpMethod.Get, "/api/v1/account/me", user.Session));
        Assert.Equal(HttpStatusCode.OK, status);
        return body!.Value;
    }

    [ElectoralSchemaFact]
    public async Task Me_reports_plan_capabilities_limits_and_usage_decided_by_the_server()
    {
        var email = UniqueEmail("plan-me");
        var adminEmail = UniqueEmail("plan-me-admin");
        using var api = CreateApi();
        using var browser = Browser(api);
        try
        {
            var (anonymousStatus, anonymous) = await Send(browser, Request(HttpMethod.Get, "/api/v1/account/session"));
            Assert.Equal(HttpStatusCode.OK, anonymousStatus);
            Assert.False(anonymous!.Value.GetProperty("authenticated").GetBoolean());
            Assert.Equal(HttpStatusCode.Unauthorized, (await Send(browser, Request(HttpMethod.Get, "/api/v1/account/me"))).Status);

            var user = await SignInByMagicLink(api, browser, email);
            var (_, session) = await Send(browser, Request(HttpMethod.Get, "/api/v1/account/session", user.Session));
            Assert.True(session!.Value.GetProperty("authenticated").GetBoolean());
            Assert.Equal("FREE", session.Value.GetProperty("plan").GetString());
            var free = await Me(browser, user);
            Assert.Equal("FREE", free.GetProperty("plan").GetString());
            Assert.Equal("default", free.GetProperty("planSource").GetString());
            Assert.Equal("user", free.GetProperty("role").GetString());
            Assert.Equal(10, free.GetProperty("limits").GetProperty("limit.favorites").GetInt32());
            Assert.False(free.GetProperty("capabilities").GetProperty("account.saved_folders").GetBoolean());
            Assert.Equal(JsonValueKind.Null, free.GetProperty("subscription").ValueKind);
            Assert.Equal(0, free.GetProperty("usage").GetProperty("favorites").GetInt32());

            await Subscribe(user.UserId, "ADVANCED");
            var advanced = await Me(browser, user);
            Assert.Equal("ADVANCED", advanced.GetProperty("plan").GetString());
            Assert.Equal("subscription", advanced.GetProperty("planSource").GetString());
            Assert.Equal("active", advanced.GetProperty("subscription").GetProperty("status").GetString());
            Assert.True(advanced.GetProperty("subscription").GetProperty("active").GetBoolean());
            Assert.Equal(200, advanced.GetProperty("limits").GetProperty("limit.favorites").GetInt32());

            // Período vencido: a assinatura continua visível, mas não vale mais.
            await Scalar("UPDATE account.subscription SET current_period_end = now() - interval '1 day' WHERE user_id = @user", ("user", user.UserId));
            var lapsed = await Me(browser, user);
            Assert.Equal("FREE", lapsed.GetProperty("plan").GetString());
            Assert.False(lapsed.GetProperty("subscription").GetProperty("active").GetBoolean());

            var admin = await SignInByMagicLink(api, browser, adminEmail);
            await Grant(admin.UserId, EntitlementResolver.RoleKey, EntitlementResolver.SuperadminRole);
            var adminMe = await Me(browser, admin);
            Assert.Equal(("PROFESSIONAL", "role", "superadmin"),
                (adminMe.GetProperty("plan").GetString(), adminMe.GetProperty("planSource").GetString(), adminMe.GetProperty("role").GetString()));
        }
        finally
        {
            await Cleanup(email, adminEmail);
        }
    }

    [ElectoralSchemaFact]
    public async Task Plans_catalog_is_public_and_checkout_never_charges_without_a_provider()
    {
        var email = UniqueEmail("plan-checkout");
        using var api = CreateApi();
        using var browser = Browser(api);
        try
        {
            var (status, catalog) = await Send(browser, Request(HttpMethod.Get, "/api/v1/plans"));
            Assert.Equal(HttpStatusCode.OK, status);
            var plans = catalog!.Value.GetProperty("plans").EnumerateArray().ToList();
            Assert.Equal(["FREE", "ADVANCED", "PROFESSIONAL"], plans.Select(p => p.GetProperty("code").GetString()));
            Assert.Equal([0, 2490, 6990], plans.Select(p => p.GetProperty("monthlyPriceCents").GetInt32()));
            Assert.False(catalog.Value.GetProperty("billing").GetProperty("available").GetBoolean());

            Assert.Equal(HttpStatusCode.Unauthorized, (await Send(browser, Request(HttpMethod.Post, "/api/v1/billing/checkout", json: new { plan = "ADVANCED" }))).Status);
            var user = await SignInByMagicLink(api, browser, email);
            Assert.Equal(HttpStatusCode.Unauthorized, (await Send(browser, Request(HttpMethod.Post, "/api/v1/billing/checkout", user.Session, json: new { plan = "ADVANCED" }))).Status);
            Assert.Equal(HttpStatusCode.BadRequest, (await Send(browser, Request(HttpMethod.Post, "/api/v1/billing/checkout", user.Session, user.Csrf, new { plan = "FREE" }))).Status);
            var (unavailable, body) = await Send(browser, Request(HttpMethod.Post, "/api/v1/billing/checkout", user.Session, user.Csrf, new { plan = "ADVANCED" }));
            Assert.Equal(HttpStatusCode.ServiceUnavailable, unavailable);
            Assert.Equal("billing_unavailable", body!.Value.GetProperty("error").GetString());
            Assert.Equal(0L, await Scalar("SELECT count(*) FROM account.subscription WHERE user_id = @user", ("user", user.UserId)));
        }
        finally
        {
            await Cleanup(email);
        }
    }

    [ElectoralSchemaFact]
    public async Task Profile_is_validated_persisted_and_kept_by_a_later_google_login()
    {
        var email = UniqueEmail("profile");
        var ibge = $"12{Random.Shared.Next(0, 100_000):D5}";
        var slug = $"perfil-teste-{Guid.NewGuid():N}";
        var stateInserted = await Scalar("INSERT INTO electoral.state(code, name) VALUES ('AC', 'Acre') ON CONFLICT (code) DO NOTHING RETURNING code") is not null;
        await Scalar("""
            INSERT INTO electoral.municipality (id, state_code, tse_code, ibge_code, name, slug)
            VALUES (gen_random_uuid(), 'AC', lpad((floor(random() * 90000) + 10000)::int::text, 5, '0'), CAST(@ibge AS integer), 'Município de Teste', @slug)
            """, ("ibge", ibge), ("slug", slug));
        using var api = CreateApi();
        using var browser = Browser(api);
        try
        {
            var user = await SignInByMagicLink(api, browser, email);
            object Profile(string? state, string? municipality, string? usage = "jornalista") => new
            {
                displayName = "  Ana  ",
                fullName = "Ana de Souza",
                stateCode = state,
                municipalityIbgeCode = municipality,
                usageType = usage,
                avatarHidden = true,
            };

            Assert.Equal(HttpStatusCode.Unauthorized, (await Send(browser, Request(HttpMethod.Post, "/api/v1/account/profile", user.Session, json: Profile("ac", ibge)))).Status);
            Assert.Equal(HttpStatusCode.BadRequest, (await Send(browser, Request(HttpMethod.Post, "/api/v1/account/profile", user.Session, user.Csrf, Profile("ZZ", null)))).Status);
            Assert.Equal(HttpStatusCode.BadRequest, (await Send(browser, Request(HttpMethod.Post, "/api/v1/account/profile", user.Session, user.Csrf, Profile("CE", ibge)))).Status);
            Assert.Equal(HttpStatusCode.BadRequest, (await Send(browser, Request(HttpMethod.Post, "/api/v1/account/profile", user.Session, user.Csrf, Profile(null, ibge)))).Status);
            Assert.Equal(HttpStatusCode.BadRequest, (await Send(browser, Request(HttpMethod.Post, "/api/v1/account/profile", user.Session, user.Csrf, Profile("ac", ibge, "militante")))).Status);

            var (saved, profile) = await Send(browser, Request(HttpMethod.Post, "/api/v1/account/profile", user.Session, user.Csrf, Profile("ac", ibge)));
            Assert.Equal(HttpStatusCode.OK, saved);
            Assert.Equal("Ana", profile!.Value.GetProperty("displayName").GetString());
            Assert.Equal("AC", profile.Value.GetProperty("stateCode").GetString());
            Assert.Equal("Município de Teste", profile.Value.GetProperty("municipalityName").GetString());
            Assert.Equal(email, profile.Value.GetProperty("email").GetString());

            var me = await Me(browser, user);
            Assert.Equal("Ana", me.GetProperty("displayName").GetString());
            Assert.Equal(JsonValueKind.Null, me.GetProperty("avatarUrl").ValueKind);
            Assert.Equal(ibge, me.GetProperty("profile").GetProperty("municipalityIbgeCode").GetString());
            Assert.Equal("jornalista", me.GetProperty("profile").GetProperty("usageType").GetString());

            // Login Google posterior (mesmo e-mail): o nome editado no perfil não volta a ser o do provedor.
            await WithAccounts(api, accounts => accounts.SignInGoogleAsync($"google-{Guid.NewGuid():N}", email, "Nome do Google", "https://example.test/a.png", true, null, null, Ct));
            Assert.Equal("Ana", await Scalar("SELECT display_name FROM account.user_account WHERE email = @email", ("email", email)));

            // Campos vazios limpam: o perfil não guarda nada além do que a pessoa mantém.
            var (cleared, empty) = await Send(browser, Request(HttpMethod.Post, "/api/v1/account/profile", user.Session, user.Csrf,
                new { displayName = "", fullName = (string?)null, stateCode = "", municipalityIbgeCode = "", usageType = "", avatarHidden = false }));
            Assert.Equal(HttpStatusCode.OK, cleared);
            Assert.Equal(JsonValueKind.Null, empty!.Value.GetProperty("stateCode").ValueKind);
            Assert.Equal(JsonValueKind.Null, empty.Value.GetProperty("usageType").ValueKind);
        }
        finally
        {
            await Cleanup(email);
            await Scalar("DELETE FROM electoral.municipality WHERE slug = @slug", ("slug", slug));
            if (stateInserted) await Scalar("DELETE FROM electoral.state WHERE code = 'AC' AND NOT EXISTS (SELECT 1 FROM electoral.municipality WHERE state_code = 'AC')");
        }
    }

    [ElectoralSchemaFact]
    public async Task Saved_items_stop_at_the_plan_limit_without_deleting_what_exists()
    {
        var email = UniqueEmail("plan-limit");
        using var api = CreateApi();
        using var browser = Browser(api);
        try
        {
            var user = await SignInByMagicLink(api, browser, email);
            Task<(HttpStatusCode Status, JsonElement? Body)> Save(object item) =>
                Send(browser, Request(HttpMethod.Post, "/api/v1/account/saved", user.Session, user.Csrf, item));

            for (var i = 0; i < 10; i++) Assert.Equal(HttpStatusCode.OK, (await Save(Favorite($"/rankings?n={i}"))).Status);
            var (refused, body) = await Save(Favorite("/rankings?n=10"));
            Assert.Equal(HttpStatusCode.Forbidden, refused);
            Assert.Equal("plan_limit_reached", body!.Value.GetProperty("error").GetString());
            Assert.Equal("limit.favorites", body.Value.GetProperty("limit").GetString());
            Assert.Equal(10, body.Value.GetProperty("max").GetInt32());
            Assert.Equal("ADVANCED", body.Value.GetProperty("requiredPlan").GetString());
            Assert.Equal(HttpStatusCode.OK, (await Save(Favorite("/rankings?n=3"))).Status);

            for (var i = 0; i < 5; i++) Assert.Equal(HttpStatusCode.OK, (await Save(Favorite($"/rankings?w={i}", "watchlist"))).Status);
            Assert.Equal(HttpStatusCode.Forbidden, (await Save(Favorite("/rankings?w=5", "watchlist"))).Status);

            // Concessão manual acima do plano e, depois, abaixo do que já existe: nada é apagado.
            await Grant(user.UserId, PlanCatalog.FavoritesLimit, "12");
            Assert.Equal(HttpStatusCode.OK, (await Save(Favorite("/rankings?n=10"))).Status);
            var race = await Task.WhenAll(Save(Favorite("/rankings?n=11")), Save(Favorite("/rankings?n=12")));
            Assert.Equal([HttpStatusCode.OK, HttpStatusCode.Forbidden], race.Select(r => r.Status).Order());
            Assert.Equal(12L, await Scalar("SELECT count(*) FROM account.saved_item WHERE user_id = @user AND collection = 'favorite'", ("user", user.UserId)));

            await Grant(user.UserId, PlanCatalog.FavoritesLimit, "3");
            var (_, list) = await Send(browser, Request(HttpMethod.Get, "/api/v1/account/saved?collection=favorite", user.Session));
            Assert.Equal(12, list!.Value.GetArrayLength());
            Assert.Equal(HttpStatusCode.Forbidden, (await Save(Favorite("/rankings?n=13"))).Status);
            Assert.Equal(HttpStatusCode.OK, (await Save(Favorite("/rankings?n=0"))).Status);
        }
        finally
        {
            await Cleanup(email);
        }
    }

    [ElectoralSchemaFact]
    public async Task Folders_are_a_professional_capability_enforced_by_the_api()
    {
        var email = UniqueEmail("plan-folder");
        using var api = CreateApi();
        using var browser = Browser(api);
        try
        {
            var user = await SignInByMagicLink(api, browser, email);
            Assert.Equal(HttpStatusCode.OK, (await Send(browser, Request(HttpMethod.Post, "/api/v1/account/saved", user.Session, user.Csrf, Favorite("/rankings?f=1")))).Status);
            var move = new { collection = "favorite", resourceType = "ranking", resourceKey = "/rankings?f=1", folder = "  Eleições 2026  " };

            Assert.Equal(HttpStatusCode.Unauthorized, (await Send(browser, Request(HttpMethod.Post, "/api/v1/account/saved/folder", json: move))).Status);
            Assert.Equal(HttpStatusCode.Unauthorized, (await Send(browser, Request(HttpMethod.Post, "/api/v1/account/saved/folder", user.Session, json: move))).Status);
            var (refused, body) = await Send(browser, Request(HttpMethod.Post, "/api/v1/account/saved/folder", user.Session, user.Csrf, move));
            Assert.Equal(HttpStatusCode.Forbidden, refused);
            Assert.Equal(("plan_required", "account.saved_folders", "PROFESSIONAL"),
                (body!.Value.GetProperty("error").GetString(), body.Value.GetProperty("capability").GetString(), body.Value.GetProperty("requiredPlan").GetString()));

            await Subscribe(user.UserId, "PROFESSIONAL");
            var (moved, item) = await Send(browser, Request(HttpMethod.Post, "/api/v1/account/saved/folder", user.Session, user.Csrf, move));
            Assert.Equal(HttpStatusCode.OK, moved);
            Assert.Equal("Eleições 2026", item!.Value.GetProperty("folder").GetString());
            Assert.Equal(HttpStatusCode.NotFound, (await Send(browser, Request(HttpMethod.Post, "/api/v1/account/saved/folder", user.Session, user.Csrf,
                new { collection = "favorite", resourceType = "ranking", resourceKey = "/rankings?f=nao-existe", folder = "X" }))).Status);
            var (_, unfiled) = await Send(browser, Request(HttpMethod.Post, "/api/v1/account/saved/folder", user.Session, user.Csrf,
                new { move.collection, move.resourceType, move.resourceKey, folder = "" }));
            Assert.Equal(JsonValueKind.Null, unfiled!.Value.GetProperty("folder").ValueKind);
        }
        finally
        {
            await Cleanup(email);
        }
    }

    [ElectoralSchemaFact]
    public async Task Alerts_follow_the_catalog_and_the_plan_limit()
    {
        var email = UniqueEmail("plan-alerts");
        using var api = CreateApi();
        using var browser = Browser(api);
        try
        {
            var user = await SignInByMagicLink(api, browser, email);
            Task<(HttpStatusCode Status, JsonElement? Body)> Alert(string type, string key, string kind, bool enabled = true, string delivery = "in_app") =>
                Send(browser, Request(HttpMethod.Post, "/api/v1/account/alerts", user.Session, user.Csrf,
                    new { resourceType = type, resourceKey = key, eventKind = kind, delivery, enabled }));

            var (kindsStatus, kinds) = await Send(browser, Request(HttpMethod.Get, "/api/v1/account/alert-kinds"));
            Assert.Equal(HttpStatusCode.OK, kindsStatus);
            Assert.Equal(AlertCatalog.Kinds.Count, kinds!.Value.GetArrayLength());

            Assert.Equal(HttpStatusCode.BadRequest, (await Alert("politician", "x", "new_edition")).Status);
            Assert.Equal(HttpStatusCode.BadRequest, (await Alert("state", "CE", "amendments_update", delivery: "email")).Status);
            Assert.Equal(HttpStatusCode.OK, (await Alert("state", "CE", "amendments_update")).Status);
            Assert.Equal(HttpStatusCode.OK, (await Alert("indicator", "ibge.population", "new_edition")).Status);
            Assert.Equal(HttpStatusCode.OK, (await Alert("election", "2026:3:CE", "polls_update")).Status);
            var (refused, body) = await Alert("election", "2026:3:CE", "live_count_update");
            Assert.Equal(HttpStatusCode.Forbidden, refused);
            Assert.Equal(("limit.alerts", 3), (body!.Value.GetProperty("limit").GetString(), body.Value.GetProperty("max").GetInt32()));

            // Pausar e retomar uma assinatura existente não conta como nova.
            Assert.Equal(HttpStatusCode.OK, (await Alert("state", "CE", "amendments_update", enabled: false)).Status);
            Assert.Equal(HttpStatusCode.OK, (await Alert("state", "CE", "amendments_update")).Status);

            await Subscribe(user.UserId, "ADVANCED");
            Assert.Equal(HttpStatusCode.OK, (await Alert("election", "2026:3:CE", "live_count_update")).Status);
            Assert.Equal(4, (await Me(browser, user)).GetProperty("usage").GetProperty("alerts").GetInt32());
        }
        finally
        {
            await Cleanup(email);
        }
    }

    [ElectoralSchemaFact]
    public async Task Extended_comparison_needs_a_session_and_the_plan_limit_and_is_never_shared()
    {
        var free = UniqueEmail("compare-free");
        var professional = UniqueEmail("compare-pro");
        using var api = CreateApi();
        using var browser = Browser(api);
        try
        {
            string Url(int count) => "/api/v1/elections/compare/extended?uf=CE&" +
                string.Join("&", Enumerable.Range(0, count).Select(i => $"candidacy={new Guid(i + 1, 0, 0, new byte[8])}"));

            Assert.Equal(HttpStatusCode.Unauthorized, (await Send(browser, Request(HttpMethod.Get, Url(6)))).Status);

            var user = await SignInByMagicLink(api, browser, free);
            var (refused, body) = await Send(browser, Request(HttpMethod.Get, Url(6), user.Session));
            Assert.Equal(HttpStatusCode.Forbidden, refused);
            Assert.Equal(("limit.compare_candidacies", 5, "PROFESSIONAL"),
                (body!.Value.GetProperty("limit").GetString(), body.Value.GetProperty("max").GetInt32(), body.Value.GetProperty("requiredPlan").GetString()));

            var pro = await SignInByMagicLink(api, browser, professional);
            await Subscribe(pro.UserId, "PROFESSIONAL");
            // Passou do portão do plano: as candidaturas sintéticas não existem, então a comparação responde 404.
            Assert.Equal(HttpStatusCode.NotFound, (await Send(browser, Request(HttpMethod.Get, Url(6), pro.Session))).Status);
            Assert.Equal(HttpStatusCode.Forbidden, (await Send(browser, Request(HttpMethod.Get, Url(11), pro.Session))).Status);

            // A mesma URL sem sessão continua 401: nada da conta Profissional ficou em cache compartilhado.
            Assert.Equal(HttpStatusCode.Unauthorized, (await Send(browser, Request(HttpMethod.Get, Url(6)))).Status);
            Assert.Equal(HttpStatusCode.BadRequest, (await Send(browser, Request(HttpMethod.Get, Url(6).Replace("/extended", "", StringComparison.Ordinal)))).Status);
        }
        finally
        {
            await Cleanup(free, professional);
        }
    }

    [ElectoralSchemaFact]
    public async Task Territory_catalog_lists_municipalities_independently_of_elections()
    {
        var slug = $"territorio-teste-{Guid.NewGuid():N}";
        var ibge = $"11{Random.Shared.Next(0, 100_000):D5}";
        var stateInserted = await Scalar("INSERT INTO electoral.state(code, name) VALUES ('RO', 'Rondônia') ON CONFLICT (code) DO NOTHING RETURNING code") is not null;
        await Scalar("""
            INSERT INTO electoral.municipality (id, state_code, tse_code, ibge_code, name, slug)
            VALUES (gen_random_uuid(), 'RO', lpad((floor(random() * 90000) + 10000)::int::text, 5, '0'), CAST(@ibge AS integer), 'Território de Teste', @slug)
            """, ("ibge", ibge), ("slug", slug));
        using var api = CreateApi();
        using var browser = Browser(api);
        try
        {
            var (status, list) = await Send(browser, Request(HttpMethod.Get, "/api/v1/territories/states/ro/municipalities"));
            Assert.Equal(HttpStatusCode.OK, status);
            Assert.Contains(list!.Value.EnumerateArray(), m => m.GetProperty("ibgeCode").GetString() == ibge && m.GetProperty("slug").GetString() == slug);
            Assert.Equal(HttpStatusCode.BadRequest, (await Send(browser, Request(HttpMethod.Get, "/api/v1/territories/states/ZZ/municipalities"))).Status);
            var (_, states) = await Send(browser, Request(HttpMethod.Get, "/api/v1/territories/states"));
            Assert.Contains(states!.Value.EnumerateArray(), s => s.GetProperty("code").GetString() == "RO" && s.GetProperty("municipalities").GetInt32() >= 1);
        }
        finally
        {
            await Scalar("DELETE FROM electoral.municipality WHERE slug = @slug", ("slug", slug));
            if (stateInserted) await Scalar("DELETE FROM electoral.state WHERE code = 'RO' AND NOT EXISTS (SELECT 1 FROM electoral.municipality WHERE state_code = 'RO')");
        }
    }
}
