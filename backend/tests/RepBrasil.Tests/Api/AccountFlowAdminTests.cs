using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Npgsql;
using RepBrasil.API.Accounts;
using RepBrasil.API.Infrastructure;
using RepBrasil.Tests.Electoral;
using static RepBrasil.Tests.Api.AccountTestKit;

namespace RepBrasil.Tests.Api;

/// <summary>
/// Super Admin ponta a ponta contra o banco de teste: papel decidido no servidor, suspensão que encerra sessões e
/// recusa login (sem conta duplicada), proteção do último Super Admin, alterações refletidas no acesso efetivo e na
/// auditoria (só inserção), suporte real e catálogo OpenAPI com a regra de acesso de cada rota.
/// </summary>
public sealed class AccountFlowAdminTests
{
    private static Task<object?> MakeSuperadmin(Guid user) =>
        Scalar("""
            INSERT INTO account.entitlement (id, user_id, entitlement_key, entitlement_value, source, starts_at)
            VALUES (gen_random_uuid(), @user, 'account.role', 'superadmin', 'test', now() - interval '1 minute')
            """, ("user", user));

    private static async Task<(SignedIn Admin, string Email)> SignInAdmin(Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program> api, HttpClient browser, string label)
    {
        var email = UniqueEmail(label);
        var admin = await SignInByMagicLink(api, browser, email);
        await MakeSuperadmin(admin.UserId);
        return (admin, email);
    }

    private static Task<(HttpStatusCode Status, JsonElement? Body)> Post(HttpClient browser, SignedIn who, string path, object? json = null) =>
        Send(browser, Request(HttpMethod.Post, path, who.Session, who.Csrf, json ?? new { }));

    [ElectoralSchemaFact]
    public async Task Admin_routes_are_decided_on_the_server_and_never_leak_secrets()
    {
        var regular = UniqueEmail("admin-regular");
        string? adminEmail = null;
        using var api = CreateApi();
        using var browser = Browser(api);
        try
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await Send(browser, Request(HttpMethod.Get, "/api/v1/admin/overview"))).Status);
            var user = await SignInByMagicLink(api, browser, regular);
            var (forbidden, refusal) = await Send(browser, Request(HttpMethod.Get, "/api/v1/admin/users", user.Session));
            Assert.Equal(HttpStatusCode.Forbidden, forbidden);
            Assert.Equal("forbidden", refusal!.Value.GetProperty("error").GetString());

            var (admin, email) = await SignInAdmin(api, browser, "admin-rbac");
            adminEmail = email;
            Assert.Equal(HttpStatusCode.Unauthorized, (await Send(browser, Request(HttpMethod.Post, $"/api/v1/admin/users/{user.UserId}/suspend", admin.Session, json: new { reason = "x" }))).Status);

            using var raw = await browser.SendAsync(Request(HttpMethod.Get, "/api/v1/admin/overview", admin.Session), Ct);
            Assert.Equal(HttpStatusCode.OK, raw.StatusCode);
            var text = await raw.Content.ReadAsStringAsync(Ct);
            foreach (var secret in new[] { "Host=", "Username=", "Password", AlertsToken, "test-only-client-secret", admin.Session, admin.Csrf })
                Assert.DoesNotContain(secret, text, StringComparison.OrdinalIgnoreCase);
            using var overview = JsonDocument.Parse(text);
            var components = overview.RootElement.GetProperty("components").EnumerateArray().Select(c => c.GetProperty("name").GetString()).ToList();
            Assert.Contains("Banco de dados (PostgreSQL)", components);
            Assert.Equal("ok", overview.RootElement.GetProperty("components")[0].GetProperty("status").GetString());
            Assert.True(overview.RootElement.GetProperty("users").GetProperty("total").GetInt32() >= 2);
            Assert.True(overview.RootElement.GetProperty("http").GetProperty("routes").GetArrayLength() >= 1);
            Assert.Equal(5, overview.RootElement.GetProperty("freshness").GetArrayLength());

            var (listed, page) = await Send(browser, Request(HttpMethod.Get, $"/api/v1/admin/users?q={Uri.EscapeDataString(regular)}", admin.Session));
            Assert.Equal(HttpStatusCode.OK, listed);
            var row = Assert.Single(page!.Value.GetProperty("items").EnumerateArray());
            Assert.Equal(("FREE", "user", "active"), (row.GetProperty("plan").GetString(), row.GetProperty("role").GetString(), row.GetProperty("status").GetString()));
        }
        finally
        {
            await Cleanup(regular, adminEmail ?? "");
        }
    }

    [ElectoralSchemaFact]
    public async Task Suspension_ends_sessions_refuses_every_login_and_never_creates_a_second_account()
    {
        var target = UniqueEmail("admin-suspended");
        string? adminEmail = null;
        using var api = CreateApi();
        using var browser = Browser(api);
        try
        {
            var user = await SignInByMagicLink(api, browser, target);
            var (admin, email) = await SignInAdmin(api, browser, "admin-suspender");
            adminEmail = email;

            var (self, selfBody) = await Post(browser, admin, $"/api/v1/admin/users/{admin.UserId}/suspend", new { reason = "teste" });
            Assert.Equal(HttpStatusCode.Conflict, self);
            Assert.Equal("self", selfBody!.Value.GetProperty("error").GetString());

            var (suspended, detail) = await Post(browser, admin, $"/api/v1/admin/users/{user.UserId}/suspend", new { reason = "Uso automatizado" });
            Assert.Equal(HttpStatusCode.OK, suspended);
            Assert.Equal(("suspended", "Uso automatizado"), (detail!.Value.GetProperty("status").GetString(), detail.Value.GetProperty("disabledReason").GetString()));
            Assert.Equal(HttpStatusCode.Unauthorized, (await Send(browser, Request(HttpMethod.Get, "/api/v1/account/me", user.Session))).Status);
            Assert.Equal(0L, await Scalar("SELECT count(*) FROM account.session WHERE user_id = @id AND revoked_at IS NULL", ("id", user.UserId)));

            // Link por e-mail e um primeiro login Google com o mesmo e-mail: os dois recusados, sem conta nova.
            var challenge = await WithAccounts(api, accounts => accounts.CreateMagicLinkChallengeAsync(target, "/conta", Ct));
            using (var consume = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/auth/magic-link/consume?token={Uri.EscapeDataString(challenge.Token)}"))
            {
                consume.Headers.Add("Cookie", $"repbrasil_magic_link={challenge.Token}");
                using var response = await browser.SendAsync(consume, Ct);
                Assert.Equal($"{Frontend}/entrar?erro=conta-suspensa", response.Headers.Location?.AbsoluteUri);
                Assert.Null(SetCookie(response, "repbrasil_session"));
            }
            await Assert.ThrowsAsync<AccountSuspendedException>(() =>
                WithAccounts(api, accounts => accounts.SignInGoogleAsync($"google-{Guid.NewGuid():N}", target, "Outro Nome", null, true, null, null, Ct)));
            Assert.Equal(1L, await Scalar("SELECT count(*) FROM account.user_account WHERE email = @email", ("email", target)));

            var (reactivated, active) = await Post(browser, admin, $"/api/v1/admin/users/{user.UserId}/reactivate");
            Assert.Equal(HttpStatusCode.OK, reactivated);
            Assert.Equal("active", active!.Value.GetProperty("status").GetString());
            var again = await SignInByMagicLink(api, browser, target);
            Assert.Equal(user.UserId, again.UserId);

            var actions = active.Value.GetProperty("audit").EnumerateArray().Select(a => a.GetProperty("action").GetString()).ToList();
            Assert.Equal(["user.reactivate", "user.suspend"], actions);
        }
        finally
        {
            await Cleanup(target, adminEmail ?? "");
        }
    }

    [ElectoralSchemaFact]
    public async Task Last_superadmin_cannot_be_removed_even_by_a_concurrent_admin()
    {
        var first = UniqueEmail("admin-last-a");
        var second = UniqueEmail("admin-last-b");
        // Sem Super Admin de configuração: só os papéis concedidos contam.
        using var api = CreateApi(builder => builder.UseSetting("Auth:SuperadminEmails", ""));
        using var browser = Browser(api);
        try
        {
            var a = await SignInByMagicLink(api, browser, first);
            var b = await SignInByMagicLink(api, browser, second);
            await MakeSuperadmin(a.UserId);
            await MakeSuperadmin(b.UserId);

            var (selfDemotion, body) = await Post(browser, a, $"/api/v1/admin/users/{a.UserId}/role", new { role = "user" });
            Assert.Equal((HttpStatusCode.Conflict, "self"), (selfDemotion, body!.Value.GetProperty("error").GetString()));
            Assert.Equal(HttpStatusCode.OK, (await Post(browser, a, $"/api/v1/admin/users/{b.UserId}/role", new { role = "user" })).Status);
            Assert.Equal(HttpStatusCode.Forbidden, (await Send(browser, Request(HttpMethod.Get, "/api/v1/admin/me", b.Session))).Status);

            // B ainda tinha a tela aberta quando perdeu o papel: a regra no servidor impede zerar os Super Admins.
            var conflict = await Assert.ThrowsAsync<AdminConflictException>(() =>
                WithService<AdminService, AdminUserDetail>(api, admin => admin.SetRoleAsync(new AdminActor(b.UserId, second, "test"), a.UserId, "user", Ct)));
            Assert.Equal("last_superadmin", conflict.Code);
            var suspend = await Assert.ThrowsAsync<AdminConflictException>(() =>
                WithService<AdminService, AdminUserDetail>(api, admin => admin.SuspendAsync(new AdminActor(b.UserId, second, "test"), a.UserId, null, Ct)));
            Assert.Equal("last_superadmin", suspend.Code);
            Assert.Equal(HttpStatusCode.OK, (await Send(browser, Request(HttpMethod.Get, "/api/v1/admin/me", a.Session))).Status);
        }
        finally
        {
            await Cleanup(first, second);
        }
    }

    [ElectoralSchemaFact]
    public async Task Plan_grants_and_subscription_changes_reach_the_account_and_the_append_only_audit()
    {
        var target = UniqueEmail("admin-plan-target");
        string? adminEmail = null;
        using var api = CreateApi();
        using var browser = Browser(api);
        try
        {
            var user = await SignInByMagicLink(api, browser, target);
            var (admin, email) = await SignInAdmin(api, browser, "admin-plan");
            adminEmail = email;
            async Task<JsonElement> Me() => (await Send(browser, Request(HttpMethod.Get, "/api/v1/account/me", user.Session))).Body!.Value;

            var until = DateTimeOffset.UtcNow.AddDays(30);
            Assert.Equal(HttpStatusCode.OK, (await Post(browser, admin, $"/api/v1/admin/users/{user.UserId}/plan", new { plan = "PROFESSIONAL", expiresAt = until })).Status);
            var me = await Me();
            Assert.Equal(("PROFESSIONAL", "manual"), (me.GetProperty("plan").GetString(), me.GetProperty("planSource").GetString()));
            Assert.Equal(HttpStatusCode.BadRequest, (await Post(browser, admin, $"/api/v1/admin/users/{user.UserId}/plan", new { plan = "ENTERPRISE" })).Status);
            Assert.Equal(HttpStatusCode.OK, (await Post(browser, admin, $"/api/v1/admin/users/{user.UserId}/plan", new { plan = "FREE" })).Status);
            Assert.Equal("FREE", (await Me()).GetProperty("plan").GetString());

            Assert.Equal(HttpStatusCode.OK, (await Post(browser, admin, $"/api/v1/admin/users/{user.UserId}/entitlements", new { key = "limit.favorites", value = "500" })).Status);
            Assert.Equal(500, (await Me()).GetProperty("limits").GetProperty("limit.favorites").GetInt32());
            Assert.Equal(HttpStatusCode.BadRequest, (await Post(browser, admin, $"/api/v1/admin/users/{user.UserId}/entitlements", new { key = "limit.favorites", value = "-1" })).Status);
            Assert.Equal(HttpStatusCode.BadRequest, (await Post(browser, admin, $"/api/v1/admin/users/{user.UserId}/entitlements", new { key = "account.role", value = "superadmin" })).Status);
            Assert.Equal(HttpStatusCode.OK, (await Send(browser, Request(HttpMethod.Delete, $"/api/v1/admin/users/{user.UserId}/entitlements/limit.favorites", admin.Session, admin.Csrf))).Status);
            Assert.Equal(10, (await Me()).GetProperty("limits").GetProperty("limit.favorites").GetInt32());

            Assert.Equal(HttpStatusCode.OK, (await Post(browser, admin, $"/api/v1/admin/users/{user.UserId}/subscription",
                new { plan = "ADVANCED", status = "active", currentPeriodEnd = until, notes = "Cortesia de lançamento" })).Status);
            Assert.Equal(("ADVANCED", "subscription"), ((await Me()).GetProperty("plan").GetString(), (await Me()).GetProperty("planSource").GetString()));
            var (_, corrected) = await Post(browser, admin, $"/api/v1/admin/users/{user.UserId}/subscription",
                new { plan = "ADVANCED", status = "canceled", currentPeriodEnd = DateTimeOffset.UtcNow.AddDays(-1), notes = (string?)null });
            Assert.Equal("FREE", (await Me()).GetProperty("plan").GetString());
            Assert.Single(corrected!.Value.GetProperty("subscriptions").EnumerateArray());

            Assert.Equal(HttpStatusCode.OK, (await Post(browser, admin, $"/api/v1/admin/users/{user.UserId}/role", new { role = "superadmin" })).Status);
            Assert.Equal(HttpStatusCode.OK, (await Send(browser, Request(HttpMethod.Get, "/api/v1/admin/me", user.Session))).Status);
            Assert.Equal(HttpStatusCode.OK, (await Post(browser, admin, $"/api/v1/admin/users/{user.UserId}/role", new { role = "user" })).Status);
            Assert.Equal(HttpStatusCode.Forbidden, (await Send(browser, Request(HttpMethod.Get, "/api/v1/admin/me", user.Session))).Status);

            var (_, audit) = await Send(browser, Request(HttpMethod.Get, $"/api/v1/admin/audit?target={user.UserId}", admin.Session));
            var entries = audit!.Value.GetProperty("items").EnumerateArray().ToList();
            Assert.Equal(
                ["user.role", "user.role", "user.subscription", "user.subscription", "user.entitlement.revoke", "user.entitlement.grant", "user.plan", "user.plan"],
                entries.Select(e => e.GetProperty("action").GetString()));
            Assert.All(entries, e => Assert.Equal(email, e.GetProperty("actorEmail").GetString()));
            var firstPlan = entries.Last();
            Assert.Equal("PROFESSIONAL", firstPlan.GetProperty("after").GetProperty("manualPlan").GetString());
            Assert.Equal("FREE", firstPlan.GetProperty("before").GetProperty("effectivePlan").GetString());

            var error = await Assert.ThrowsAsync<PostgresException>(() =>
                Scalar("UPDATE account.admin_audit_log SET action = 'user.role' WHERE target_user_id = @id", ("id", user.UserId)));
            Assert.Contains("só de inserção", error.MessageText);
        }
        finally
        {
            await Cleanup(target, adminEmail ?? "");
        }
    }

    [ElectoralSchemaFact]
    public async Task Status_change_answers_with_the_request_even_beyond_the_newest_200()
    {
        var marker = $"antigo-{Guid.NewGuid():N}@example.test";
        var id = Guid.NewGuid();
        string? adminEmail = null;
        using var api = CreateApi();
        using var browser = Browser(api);
        try
        {
            // Um pedido antigo e 200 mais novos que ele, todos no passado: a caixa dos outros testes não muda.
            await Scalar("""
                INSERT INTO account.support_request (id, category, email, message, created_at, updated_at)
                VALUES (@id, 'duvida', @email, 'Pedido antigo, anterior aos duzentos mais recentes da caixa.', '2000-01-01', '2000-01-01')
                """, ("id", id), ("email", marker));
            await Scalar("""
                INSERT INTO account.support_request (id, category, email, message, created_at, updated_at)
                SELECT gen_random_uuid(), 'duvida', @email, 'Pedido de preenchimento, mais novo que o antigo.',
                       '2000-01-02'::timestamptz + g * interval '1 second', '2000-01-02'::timestamptz
                  FROM generate_series(1, 200) AS g
                """, ("email", marker));

            var (admin, email) = await SignInAdmin(api, browser, "admin-support-old");
            adminEmail = email;
            var (changed, row) = await Post(browser, admin, $"/api/v1/admin/support/{id}/status", new { status = "arquivado" });
            Assert.Equal(HttpStatusCode.OK, changed);
            Assert.Equal(id, row!.Value.GetProperty("id").GetGuid());
            Assert.Equal("arquivado", row.Value.GetProperty("status").GetString());
        }
        finally
        {
            await Scalar("DELETE FROM account.support_request WHERE email = @email", ("email", marker));
            await Cleanup(adminEmail ?? "");
        }
    }

    [ElectoralSchemaFact]
    public async Task Support_requests_are_stored_rate_limited_and_triaged_with_audit()
    {
        var reporter = $"suporte-{Guid.NewGuid():N}@example.test";
        string? adminEmail = null;
        using var api = CreateApi(builder => builder.UseSetting("RateLimit:SupportPerHour", "2"));
        using var browser = Browser(api);
        try
        {
            object Ticket(string message) => new { category = "contestacao", name = "Pessoa", email = reporter, sourceReference = "https://dadosabertos.tse.jus.br/", message };
            Assert.Equal(HttpStatusCode.BadRequest, (await Send(browser, Request(HttpMethod.Post, "/api/v1/support/requests", json: Ticket("curta")))).Status);
            var (accepted, body) = await Send(browser, Request(HttpMethod.Post, "/api/v1/support/requests", json: Ticket("O total de votos da seção 33 em 2024 diverge do boletim de urna oficial.")));
            Assert.Equal(HttpStatusCode.Accepted, accepted);
            var id = body!.Value.GetProperty("id").GetGuid();
            Assert.Equal(HttpStatusCode.TooManyRequests, (await Send(browser, Request(HttpMethod.Post, "/api/v1/support/requests", json: Ticket("Mais uma mensagem com tamanho suficiente para passar.")))).Status);
            // O IP nunca é guardado: no máximo o hash do prefixo.
            Assert.Equal(0L, await Scalar("SELECT count(*) FROM account.support_request WHERE id = @id AND ip_hash IS NOT NULL AND ip_hash !~ '^[0-9a-f]{64}$'", ("id", id)));

            var (admin, email) = await SignInAdmin(api, browser, "admin-support");
            adminEmail = email;
            var (_, inbox) = await Send(browser, Request(HttpMethod.Get, "/api/v1/admin/support?status=novo", admin.Session));
            var ticket = Assert.Single(inbox!.Value.EnumerateArray(), t => t.GetProperty("id").GetGuid() == id);
            Assert.Equal("https://dadosabertos.tse.jus.br/", ticket.GetProperty("sourceReference").GetString());
            var (changed, row) = await Post(browser, admin, $"/api/v1/admin/support/{id}/status", new { status = "em_analise" });
            Assert.Equal(HttpStatusCode.OK, changed);
            Assert.Equal("em_analise", row!.Value.GetProperty("status").GetString());
            Assert.Equal(1L, await Scalar("SELECT count(*) FROM account.admin_audit_log WHERE action = 'support.status' AND context->>'requestId' = @id", ("id", id.ToString())));
        }
        finally
        {
            await Scalar("DELETE FROM account.support_request WHERE email = @email", ("email", reporter));
            await Cleanup(adminEmail ?? "");
        }
    }

    [ElectoralSchemaFact]
    public async Task OpenApi_catalog_is_admin_only_and_describes_access_from_the_enforcing_attributes()
    {
        string? adminEmail = null;
        using var api = CreateApi();
        using var browser = Browser(api);
        try
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await Send(browser, Request(HttpMethod.Get, "/api/v1/admin/openapi"))).Status);
            Assert.Equal(HttpStatusCode.NotFound, (await Send(browser, Request(HttpMethod.Get, "/swagger/v1/swagger.json"))).Status);
            var (admin, email) = await SignInAdmin(api, browser, "admin-openapi");
            adminEmail = email;
            var (status, catalog) = await Send(browser, Request(HttpMethod.Get, "/api/v1/admin/openapi", admin.Session));
            Assert.Equal(HttpStatusCode.OK, status);
            var paths = catalog!.Value.GetProperty("document").GetProperty("paths");
            string Kind(string path, string method) => paths.GetProperty(path).GetProperty(method).GetProperty(AccessOperationFilter.Extension).GetProperty("kind").GetString()!;
            Assert.Equal("capability", Kind("/api/v1/account/saved/folder", "post"));
            Assert.Equal("superadmin", Kind("/api/v1/admin/users", "get"));
            Assert.Equal("session", Kind("/api/v1/account/profile", "post"));
            Assert.Equal("public", Kind("/api/v1/plans", "get"));
            Assert.Equal("header", Kind("/api/v1/internal/alerts/publish", "post"));
            Assert.Equal("PROFESSIONAL", paths.GetProperty("/api/v1/account/saved/folder").GetProperty("post").GetProperty(AccessOperationFilter.Extension).GetProperty("requiredPlan").GetString());
            Assert.True(catalog.Value.GetProperty("metrics").GetArrayLength() >= 1);
        }
        finally
        {
            await Cleanup(adminEmail ?? "");
        }
    }
}
