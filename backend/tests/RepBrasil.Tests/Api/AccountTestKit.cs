using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using RepBrasil.API.Infrastructure;
using RepBrasil.Tests.Electoral;

namespace RepBrasil.Tests.Api;

/// <summary>
/// Peças comuns dos testes de conta contra o banco de teste (REPBRASIL_ELECTORAL_TEST_DB, *_test, com migrations):
/// API em modo produção, navegador sem cookies automáticos, login por magic link e SQL direto para preparar e conferir.
/// O publicador de alertas fica desligado; os testes que precisam dele rodam o ciclo explicitamente.
/// </summary>
internal static class AccountTestKit
{
    public const string Frontend = "https://www.apprepbrasil.com.br";
    public const string Superadmin = "superadmin-flow@example.test";
    public const string AlertsToken = "test-only-alerts-token";
    public static readonly CancellationToken Ct = CancellationToken.None;

    public static string Connection => Environment.GetEnvironmentVariable(ElectoralSchemaFactAttribute.Variable)!;

    public static string UniqueEmail(string label) => $"flow-{label}-{Guid.NewGuid():N}@example.test";

    public static WebApplicationFactory<Program> CreateApi(Action<IWebHostBuilder>? configure = null) =>
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
            builder.UseSetting("Alerts:Publisher:Enabled", "false");
            configure?.Invoke(builder);
        });

    public static HttpClient Browser(WebApplicationFactory<Program> api) => api.CreateClient(new WebApplicationFactoryClientOptions
    {
        AllowAutoRedirect = false,
        HandleCookies = false,
        BaseAddress = new Uri("https://localhost"),
    });

    public static string? SetCookie(HttpResponseMessage response, string name) =>
        response.Headers.TryGetValues("Set-Cookie", out var values)
            ? values.FirstOrDefault(value => value.StartsWith(name + "=", StringComparison.Ordinal))
            : null;

    public static string CookieValue(string setCookie)
    {
        var start = setCookie.IndexOf('=') + 1;
        return setCookie[start..setCookie.IndexOf(';')];
    }

    public static async Task<T> WithService<TService, T>(WebApplicationFactory<Program> api, Func<TService, Task<T>> action) where TService : notnull
    {
        using var scope = api.Services.CreateScope();
        return await action(scope.ServiceProvider.GetRequiredService<TService>());
    }

    public static Task<T> WithAccounts<T>(WebApplicationFactory<Program> api, Func<AccountService, Task<T>> action) =>
        WithService(api, action);

    public static async Task<object?> Scalar(string sql, params (string Name, object Value)[] args)
    {
        await using var connection = new NpgsqlConnection(Connection);
        await connection.OpenAsync(Ct);
        await using var command = new NpgsqlCommand(sql, connection);
        foreach (var (name, value) in args) command.Parameters.AddWithValue(name, value);
        return await command.ExecuteScalarAsync(Ct);
    }

    public static Task<object?> Cleanup(params string[] emails) =>
        Scalar("DELETE FROM account.user_account WHERE email = ANY(@emails)", ("emails", emails));

    public static HttpRequestMessage Request(HttpMethod method, string path, string? session = null, string? csrf = null, object? json = null)
    {
        var request = new HttpRequestMessage(method, path);
        if (session is not null) request.Headers.Add("Cookie", $"repbrasil_session={session}");
        if (csrf is not null) request.Headers.Add("X-RepBrasil-CSRF", csrf);
        if (json is not null) request.Content = JsonContent.Create(json);
        return request;
    }

    public sealed record SignedIn(string Session, string Csrf, Guid UserId);

    public static async Task<SignedIn> SignInByMagicLink(WebApplicationFactory<Program> api, HttpClient browser, string email, string returnTo = "/conta")
    {
        var challenge = await WithAccounts(api, accounts => accounts.CreateMagicLinkChallengeAsync(email, returnTo, Ct));
        using var consume = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/auth/magic-link/consume?token={Uri.EscapeDataString(challenge.Token)}");
        consume.Headers.Add("Cookie", $"repbrasil_magic_link={challenge.Token}");
        using var response = await browser.SendAsync(consume, Ct);
        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        var session = CookieValue(SetCookie(response, "repbrasil_session")!);

        using var me = await browser.SendAsync(Request(HttpMethod.Get, "/api/v1/account/me", session), Ct);
        var text = await me.Content.ReadAsStringAsync(Ct);
        Assert.True(me.StatusCode == HttpStatusCode.OK, $"/account/me respondeu {(int)me.StatusCode}: {text}");
        using var json = JsonDocument.Parse(text);
        return new(session, json.RootElement.GetProperty("csrfToken").GetString()!, json.RootElement.GetProperty("id").GetGuid());
    }

    /// <summary>Envia e devolve status + corpo JSON (nulo se vazio).</summary>
    public static async Task<(HttpStatusCode Status, JsonElement? Body)> Send(HttpClient browser, HttpRequestMessage request)
    {
        using (request)
        using (var response = await browser.SendAsync(request, Ct))
        {
            var text = await response.Content.ReadAsStringAsync(Ct);
            return (response.StatusCode, string.IsNullOrWhiteSpace(text) ? null : JsonDocument.Parse(text).RootElement.Clone());
        }
    }
}
