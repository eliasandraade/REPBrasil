using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using RepBrasil.API.Infrastructure;
using RepBrasil.Tests.Electoral;

namespace RepBrasil.Tests.Api;

/// <summary>
/// Fluxos de conta ponta a ponta contra o banco de teste (REPBRASIL_ELECTORAL_TEST_DB, *_test, com
/// migrations): cookies, correlação de navegador, CSRF, one-shot, superadmin, quota agregada e
/// alertas. O Google é simulado por um stub HTTP; nenhum e-mail é enviado.
/// </summary>
public sealed class AccountFlowTests
{
    private const string Frontend = "https://www.apprepbrasil.com.br";
    private const string Superadmin = "superadmin-flow@example.test";
    private const string AlertsToken = "test-only-alerts-token";
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static string Connection => Environment.GetEnvironmentVariable(ElectoralSchemaFactAttribute.Variable)!;

    private static string UniqueEmail(string label) => $"flow-{label}-{Guid.NewGuid():N}@example.test";

    private static string Sha256(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    private sealed class StubGoogle : HttpMessageHandler
    {
        public bool EmailVerified { get; set; } = true;
        public string Subject { get; set; } = $"google-{Guid.NewGuid():N}";
        public string Email { get; set; } = UniqueEmail("google");

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.RequestUri!.AbsoluteUri switch
            {
                "https://oauth2.googleapis.com/token" => """{"access_token":"stub-access-token"}""",
                "https://openidconnect.googleapis.com/v1/userinfo" => JsonSerializer.Serialize(new
                {
                    sub = Subject,
                    email = Email,
                    email_verified = EmailVerified,
                    name = "Pessoa de Teste",
                }),
                _ => null,
            };
            return Task.FromResult(body is null
                ? new HttpResponseMessage(HttpStatusCode.NotFound)
                : new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        }
    }

    private static WebApplicationFactory<Program> Api(StubGoogle? google = null) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Production");
            builder.UseSetting("ConnectionStrings:Postgres", Connection);
            builder.UseSetting("Migrate:SkipStartupApply", "true");
            builder.UseSetting("AllowedOrigins", Frontend);
            builder.UseSetting("Auth:FrontendBaseUrl", Frontend);
            builder.UseSetting("Auth:PublicBaseUrl", "https://api.apprepbrasil.com.br");
            builder.UseSetting("Auth:CookieSameSite", "Lax");
            builder.UseSetting("Auth:Google:ClientId", "test-only-client-id");
            builder.UseSetting("Auth:Google:ClientSecret", "test-only-client-secret");
            builder.UseSetting("Auth:Google:RedirectUri", "https://api.apprepbrasil.com.br/api/v1/auth/google/callback");
            builder.UseSetting("Auth:SuperadminEmails", Superadmin);
            builder.UseSetting("Alerts:PublishToken", AlertsToken);
            if (google is not null)
                builder.ConfigureTestServices(services => services.AddHttpClient("google-auth").ConfigurePrimaryHttpMessageHandler(() => google));
        });

    private static HttpClient Browser(WebApplicationFactory<Program> api) => api.CreateClient(new WebApplicationFactoryClientOptions
    {
        AllowAutoRedirect = false,
        HandleCookies = false,
        BaseAddress = new Uri("https://localhost"),
    });

    private static string? SetCookie(HttpResponseMessage response, string name) =>
        response.Headers.TryGetValues("Set-Cookie", out var values)
            ? values.FirstOrDefault(value => value.StartsWith(name + "=", StringComparison.Ordinal))
            : null;

    private static string CookieValue(string setCookie)
    {
        var start = setCookie.IndexOf('=') + 1;
        return setCookie[start..setCookie.IndexOf(';')];
    }

    private static void AssertHardened(string setCookie, string path)
    {
        var attributes = setCookie.ToLowerInvariant();
        Assert.Contains("httponly", attributes);
        Assert.Contains("secure", attributes);
        Assert.Contains("samesite=lax", attributes);
        Assert.Contains($"path={path}", attributes);
    }

    private static async Task<T> WithAccounts<T>(WebApplicationFactory<Program> api, Func<AccountService, Task<T>> action)
    {
        using var scope = api.Services.CreateScope();
        return await action(scope.ServiceProvider.GetRequiredService<AccountService>());
    }

    private static async Task<object?> Scalar(string sql, params (string Name, object Value)[] args)
    {
        await using var connection = new NpgsqlConnection(Connection);
        await connection.OpenAsync(Ct);
        await using var command = new NpgsqlCommand(sql, connection);
        foreach (var (name, value) in args) command.Parameters.AddWithValue(name, value);
        return await command.ExecuteScalarAsync(Ct);
    }

    private static Task<object?> Cleanup(params string[] emails) =>
        Scalar("DELETE FROM account.user_account WHERE email = ANY(@emails)", ("emails", emails));

    private static HttpRequestMessage Request(HttpMethod method, string path, string? session = null, string? csrf = null, object? json = null)
    {
        var request = new HttpRequestMessage(method, path);
        if (session is not null) request.Headers.Add("Cookie", $"repbrasil_session={session}");
        if (csrf is not null) request.Headers.Add("X-RepBrasil-CSRF", csrf);
        if (json is not null) request.Content = JsonContent.Create(json);
        return request;
    }

    private sealed record SignedIn(string Session, string Csrf, Guid UserId);

    private static async Task<SignedIn> SignInByMagicLink(WebApplicationFactory<Program> api, HttpClient browser, string email, string returnTo = "/conta")
    {
        var challenge = await WithAccounts(api, accounts => accounts.CreateMagicLinkChallengeAsync(email, returnTo, Ct));
        using var consume = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/auth/magic-link/consume?token={Uri.EscapeDataString(challenge.Token)}");
        consume.Headers.Add("Cookie", $"repbrasil_magic_link={challenge.Token}");
        using var response = await browser.SendAsync(consume, Ct);
        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        var session = CookieValue(SetCookie(response, "repbrasil_session")!);

        using var me = await browser.SendAsync(Request(HttpMethod.Get, "/api/v1/account/me", session), Ct);
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        using var json = JsonDocument.Parse(await me.Content.ReadAsStringAsync(Ct));
        return new(session, json.RootElement.GetProperty("csrfToken").GetString()!, json.RootElement.GetProperty("id").GetGuid());
    }

    [ElectoralSchemaFact]
    public async Task Magic_link_signs_in_the_requesting_browser_once_with_a_hardened_session()
    {
        var email = UniqueEmail("magic");
        using var api = Api();
        using var browser = Browser(api);
        try
        {
            var challenge = await WithAccounts(api, accounts => accounts.CreateMagicLinkChallengeAsync(email, "/dados?x=1", Ct));
            var consumePath = $"/api/v1/auth/magic-link/consume?token={Uri.EscapeDataString(challenge.Token)}";

            using (var foreign = new HttpRequestMessage(HttpMethod.Get, consumePath))
            {
                foreign.Headers.Add("Cookie", "repbrasil_magic_link=correlation-of-another-request");
                using var refused = await browser.SendAsync(foreign, Ct);
                Assert.True(refused.StatusCode == HttpStatusCode.Redirect, $"{refused.StatusCode}: {await refused.Content.ReadAsStringAsync(Ct)}");
                Assert.Equal($"{Frontend}/entrar?erro=link-invalido", refused.Headers.Location?.AbsoluteUri);
                Assert.Null(SetCookie(refused, "repbrasil_session"));
            }

            using var own = new HttpRequestMessage(HttpMethod.Get, consumePath);
            own.Headers.Add("Cookie", $"repbrasil_magic_link={challenge.Token}");
            using var accepted = await browser.SendAsync(own, Ct);
            Assert.Equal(HttpStatusCode.Redirect, accepted.StatusCode);
            Assert.Equal($"{Frontend}/dados?x=1", accepted.Headers.Location?.AbsoluteUri);
            var sessionCookie = SetCookie(accepted, "repbrasil_session")!;
            AssertHardened(sessionCookie, "/");
            Assert.Contains("expires=thu, 01 jan 1970", SetCookie(accepted, "repbrasil_magic_link")!.ToLowerInvariant());

            using var replay = new HttpRequestMessage(HttpMethod.Get, consumePath);
            replay.Headers.Add("Cookie", $"repbrasil_magic_link={challenge.Token}");
            using var replayed = await browser.SendAsync(replay, Ct);
            Assert.Equal($"{Frontend}/entrar?erro=link-invalido", replayed.Headers.Location?.AbsoluteUri);

            var session = CookieValue(sessionCookie);
            Assert.Equal(1L, await Scalar("SELECT count(*) FROM account.session WHERE token_hash = @hash", ("hash", Sha256(session))));
            Assert.Equal(0L, await Scalar("SELECT count(*) FROM account.session WHERE token_hash = @raw", ("raw", session)));
            Assert.Equal(1L, await Scalar("SELECT count(*) FROM account.login_challenge WHERE token_hash = @hash AND consumed_at IS NOT NULL",
                ("hash", Sha256(challenge.Token))));
        }
        finally
        {
            await Cleanup(email);
        }
    }

    [ElectoralSchemaFact]
    public async Task Magic_link_request_sets_a_scoped_browser_correlation_cookie()
    {
        using var api = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.UseSetting("ConnectionStrings:Postgres", Connection);
            builder.UseSetting("Migrate:SkipStartupApply", "true");
            builder.UseSetting("Auth:FrontendBaseUrl", Frontend);
            builder.UseSetting("Auth:PublicBaseUrl", "https://api.apprepbrasil.com.br");
            builder.UseSetting("Auth:MagicLink:Delivery", "log");
        });
        using var browser = Browser(api);
        var email = UniqueEmail("request");
        try
        {
            using var response = await browser.PostAsJsonAsync("/api/v1/auth/magic-link", new { email, returnTo = "/conta" }, Ct);
            Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
            var correlation = SetCookie(response, "repbrasil_magic_link")!.ToLowerInvariant();
            Assert.Contains("httponly", correlation);
            Assert.Contains("samesite=lax", correlation);
            Assert.Contains("path=/api/v1/auth/magic-link", correlation);
        }
        finally
        {
            await Scalar("DELETE FROM account.login_challenge WHERE email = @email", ("email", email));
        }
    }

    [ElectoralSchemaFact]
    public async Task Account_mutations_require_the_csrf_token_of_the_same_session()
    {
        var owner = UniqueEmail("csrf-owner");
        var other = UniqueEmail("csrf-other");
        using var api = Api();
        using var browser = Browser(api);
        try
        {
            var me = await SignInByMagicLink(api, browser, owner);
            var stranger = await SignInByMagicLink(api, browser, other);
            var item = new { collection = "favorite", resourceType = "ranking", resourceKey = "/rankings?ano=2024&turno=1", label = "Rankings 2024", href = "/rankings?ano=2024&turno=1", metadata = new { } };

            using (var missing = await browser.SendAsync(Request(HttpMethod.Post, "/api/v1/account/saved", me.Session, json: item), Ct))
                Assert.Equal(HttpStatusCode.Unauthorized, missing.StatusCode);
            using (var foreign = await browser.SendAsync(Request(HttpMethod.Post, "/api/v1/account/saved", me.Session, stranger.Csrf, item), Ct))
                Assert.Equal(HttpStatusCode.Unauthorized, foreign.StatusCode);
            using (var saved = await browser.SendAsync(Request(HttpMethod.Post, "/api/v1/account/saved", me.Session, me.Csrf, item), Ct))
                Assert.Equal(HttpStatusCode.OK, saved.StatusCode);

            using (var second = await browser.SendAsync(Request(HttpMethod.Post, "/api/v1/account/saved", me.Session, me.Csrf,
                new { item.collection, item.resourceType, resourceKey = "/rankings?ano=2022&turno=1", item.label, href = "/rankings?ano=2022&turno=1", item.metadata }), Ct))
                Assert.Equal(HttpStatusCode.OK, second.StatusCode);
            using var list = await browser.SendAsync(Request(HttpMethod.Get, "/api/v1/account/saved?collection=favorite", me.Session), Ct);
            using var json = JsonDocument.Parse(await list.Content.ReadAsStringAsync(Ct));
            Assert.Equal(2, json.RootElement.GetArrayLength());

            using (var logoutWithoutCsrf = await browser.SendAsync(Request(HttpMethod.Post, "/api/v1/auth/logout", me.Session), Ct))
                Assert.Equal(HttpStatusCode.Unauthorized, logoutWithoutCsrf.StatusCode);
            using (var logout = await browser.SendAsync(Request(HttpMethod.Post, "/api/v1/auth/logout", me.Session, me.Csrf), Ct))
                Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
            using var afterLogout = await browser.SendAsync(Request(HttpMethod.Get, "/api/v1/account/me", me.Session), Ct);
            Assert.Equal(HttpStatusCode.Unauthorized, afterLogout.StatusCode);
        }
        finally
        {
            await Cleanup(owner, other);
        }
    }

    [ElectoralSchemaFact]
    public async Task Google_login_requires_the_initiating_browser_a_verified_email_and_a_fresh_state()
    {
        var google = new StubGoogle();
        using var api = Api(google);
        using var browser = Browser(api);
        try
        {
            async Task<string> Start()
            {
                using var start = await browser.GetAsync("/api/v1/auth/google/start?returnTo=/pesquisas", Ct);
                Assert.Equal(HttpStatusCode.Redirect, start.StatusCode);
                Assert.StartsWith("https://accounts.google.com/o/oauth2/v2/auth?", start.Headers.Location!.AbsoluteUri);
                var correlation = SetCookie(start, "repbrasil_google_state")!;
                AssertHardened(correlation, "/api/v1/auth/google");
                var state = CookieValue(correlation);
                Assert.Contains($"state={Uri.EscapeDataString(state)}", start.Headers.Location!.AbsoluteUri);
                return state;
            }

            async Task<HttpResponseMessage> Callback(string state, string? cookie)
            {
                var request = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/auth/google/callback?code=stub-code&state={Uri.EscapeDataString(state)}");
                if (cookie is not null) request.Headers.Add("Cookie", $"repbrasil_google_state={cookie}");
                return await browser.SendAsync(request, Ct);
            }

            var state = await Start();
            using (var otherBrowser = await Callback(state, cookie: null))
                Assert.Equal($"{Frontend}/entrar?erro=estado-invalido", otherBrowser.Headers.Location?.AbsoluteUri);

            google.EmailVerified = false;
            using (var unverified = await Callback(state, state))
            {
                Assert.Equal($"{Frontend}/entrar?erro=google-falhou", unverified.Headers.Location?.AbsoluteUri);
                Assert.Null(SetCookie(unverified, "repbrasil_session"));
            }

            google.EmailVerified = true;
            using (var reused = await Callback(state, state))
                Assert.Equal($"{Frontend}/entrar?erro=estado-invalido", reused.Headers.Location?.AbsoluteUri);

            var fresh = await Start();
            using var signedIn = await Callback(fresh, fresh);
            Assert.Equal($"{Frontend}/pesquisas", signedIn.Headers.Location?.AbsoluteUri);
            AssertHardened(SetCookie(signedIn, "repbrasil_session")!, "/");
            Assert.Equal(1L, await Scalar("SELECT count(*) FROM account.identity WHERE provider = 'google' AND provider_subject = @subject",
                ("subject", google.Subject)));
        }
        finally
        {
            await Cleanup(google.Email);
        }
    }

    [ElectoralSchemaFact]
    public async Task Superadmin_is_decided_server_side_and_refusal_is_a_403()
    {
        var regular = UniqueEmail("regular");
        var granted = UniqueEmail("granted");
        using var api = Api();
        using var browser = Browser(api);
        try
        {
            using (var anonymous = await browser.GetAsync("/api/v1/admin/me", Ct))
                Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

            var user = await SignInByMagicLink(api, browser, regular);
            using (var forbidden = await browser.SendAsync(Request(HttpMethod.Get, "/api/v1/admin/me", user.Session), Ct))
                Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);

            var configured = await SignInByMagicLink(api, browser, Superadmin);
            using (var byConfiguration = await browser.SendAsync(Request(HttpMethod.Get, "/api/v1/admin/me", configured.Session), Ct))
            {
                Assert.Equal(HttpStatusCode.OK, byConfiguration.StatusCode);
                Assert.Contains("\"role\":\"superadmin\"", await byConfiguration.Content.ReadAsStringAsync(Ct));
            }

            var entitled = await SignInByMagicLink(api, browser, granted);
            await Scalar("""
                INSERT INTO account.entitlement (id, user_id, entitlement_key, entitlement_value, source, starts_at)
                VALUES (gen_random_uuid(), @user, 'account.role', 'superadmin', 'test', now() - interval '1 minute')
                """, ("user", entitled.UserId));
            using var byEntitlement = await browser.SendAsync(Request(HttpMethod.Get, "/api/v1/admin/me", entitled.Session), Ct);
            Assert.Equal(HttpStatusCode.OK, byEntitlement.StatusCode);
        }
        finally
        {
            await Cleanup(regular, granted, Superadmin);
        }
    }

    [ElectoralSchemaFact]
    public async Task Commercial_quota_is_shared_by_every_key_of_the_account()
    {
        var email = UniqueEmail("quota");
        using var api = Api();
        using var browser = Browser(api);
        try
        {
            var me = await SignInByMagicLink(api, browser, email);
            await Scalar("""
                INSERT INTO account.entitlement (id, user_id, entitlement_key, entitlement_value, source, starts_at)
                VALUES (gen_random_uuid(), @user, 'api.daily_quota', '3', 'test', now() - interval '1 minute')
                """, ("user", me.UserId));

            async Task<(Guid Id, string Secret)> CreateKey(string name, string[] scopes)
            {
                using var created = await browser.SendAsync(Request(HttpMethod.Post, "/api/v1/account/api-keys", me.Session, me.Csrf, new { name, scopes }), Ct);
                Assert.Equal(HttpStatusCode.OK, created.StatusCode);
                using var json = JsonDocument.Parse(await created.Content.ReadAsStringAsync(Ct));
                return (json.RootElement.GetProperty("key").GetProperty("id").GetGuid(), json.RootElement.GetProperty("secret").GetString()!);
            }

            async Task<HttpStatusCode> Ping(string? secret)
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/commercial/ping");
                if (secret is not null) request.Headers.Add("X-Api-Key", secret);
                using var response = await browser.SendAsync(request, Ct);
                Assert.True((int)response.StatusCode < 500, await response.Content.ReadAsStringAsync(Ct));
                return response.StatusCode;
            }

            var first = await CreateKey("primeira", ["read:public"]);
            var second = await CreateKey("segunda", ["read:public"]);
            Assert.Equal(1L, await Scalar("SELECT count(*) FROM account.api_key WHERE key_hash = @hash", ("hash", Sha256(first.Secret))));
            Assert.Equal(0L, await Scalar("SELECT count(*) FROM account.api_key WHERE key_hash = @raw OR key_prefix = @raw", ("raw", first.Secret)));

            Assert.Equal(HttpStatusCode.OK, await Ping(first.Secret));
            Assert.Equal(HttpStatusCode.OK, await Ping(first.Secret));
            Assert.Equal(HttpStatusCode.OK, await Ping(second.Secret));
            Assert.Equal(HttpStatusCode.TooManyRequests, await Ping(second.Secret));
            var third = await CreateKey("terceira", ["read:public"]);
            Assert.Equal(HttpStatusCode.TooManyRequests, await Ping(third.Secret));
            Assert.Equal(3L, await Scalar("""
                SELECT COALESCE(SUM(u.request_count), 0)::bigint FROM account.api_usage_daily u
                JOIN account.api_key k ON k.id = u.api_key_id WHERE k.user_id = @user
                """, ("user", me.UserId)));

            using (var revoke = await browser.SendAsync(Request(HttpMethod.Delete, $"/api/v1/account/api-keys/{first.Id}", me.Session, me.Csrf), Ct))
                Assert.Equal(HttpStatusCode.NoContent, revoke.StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, await Ping(first.Secret));
            Assert.Equal(HttpStatusCode.Unauthorized, await Ping(null));
            Assert.Equal(HttpStatusCode.Unauthorized, await Ping("rep_live_" + new string('x', 40)));

            var accountOnly = await CreateKey("conta", ["read:account"]);
            Assert.Equal(HttpStatusCode.Forbidden, await Ping(accountOnly.Secret));
        }
        finally
        {
            await Cleanup(email);
        }
    }

    [ElectoralSchemaFact]
    public async Task Alert_publication_needs_the_internal_token_and_notifies_each_user_once()
    {
        var email = UniqueEmail("alerts");
        var resourceKey = $"ce/flow-{Guid.NewGuid():N}";
        using var api = Api();
        using var browser = Browser(api);
        try
        {
            var me = await SignInByMagicLink(api, browser, email);
            var subscription = new { resourceType = "municipality", resourceKey, eventKind = "live_count_update", delivery = "in_app", enabled = true };
            using (var subscribed = await browser.SendAsync(Request(HttpMethod.Post, "/api/v1/account/alerts", me.Session, me.Csrf, subscription), Ct))
                Assert.Equal(HttpStatusCode.OK, subscribed.StatusCode);

            var publication = new { eventKey = $"flow-{resourceKey}-1", resourceType = "municipality", resourceKey, eventKind = "live_count_update", title = "Nova totalização oficial", body = (string?)null, href = "/pesquisas", payload = new { } };
            async Task<HttpResponseMessage> Publish(string? token)
            {
                var request = Request(HttpMethod.Post, "/api/v1/internal/alerts/publish", json: publication);
                if (token is not null) request.Headers.Add("X-Alerts-Token", token);
                return await browser.SendAsync(request, Ct);
            }

            using (var anonymous = await Publish(null))
                Assert.Equal(HttpStatusCode.NotFound, anonymous.StatusCode);
            using (var wrong = await Publish("wrong-token"))
                Assert.Equal(HttpStatusCode.NotFound, wrong.StatusCode);
            using (var firstRun = await Publish(AlertsToken))
                Assert.Contains("\"created\":1", await firstRun.Content.ReadAsStringAsync(Ct));
            using (var secondRun = await Publish(AlertsToken))
                Assert.Contains("\"created\":0", await secondRun.Content.ReadAsStringAsync(Ct));

            using var inbox = await browser.SendAsync(Request(HttpMethod.Get, "/api/v1/account/notifications", me.Session), Ct);
            using var json = JsonDocument.Parse(await inbox.Content.ReadAsStringAsync(Ct));
            Assert.Equal(1, json.RootElement.GetArrayLength());
        }
        finally
        {
            await Cleanup(email);
        }
    }
}
