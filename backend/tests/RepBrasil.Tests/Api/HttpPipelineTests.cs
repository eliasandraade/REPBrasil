using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using RepBrasil.API.Infrastructure;

namespace RepBrasil.Tests.Api;

/// <summary>Controlador só de teste: falhas controladas dentro do pipeline real.</summary>
[ApiController]
[Route("__test")]
public sealed class PipelineProbeController : ControllerBase
{
    [HttpGet("boom")]
    public IActionResult Boom() => throw new InvalidOperationException("detalhe interno: senha=nao-vaza");

    [HttpGet("db-down")]
    public IActionResult DbDown() => throw new InvalidOperationException("consulta", new TimeoutException("conexão"));
}

/// <summary>
/// Pipeline HTTP de verdade (sem banco): cabeçalhos de segurança, CORS também no erro, ProblemDetails sem detalhe
/// interno, limite técnico com Retry-After, Swagger desligado em produção e /migrate escondido sem token.
/// </summary>
public class HttpPipelineTests
{
    private const string Origin = "http://localhost:3400";

    private static WebApplicationFactory<Program> Factory(string environment = "Production", params (string Key, string Value)[] settings) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseEnvironment(environment);
            b.UseSetting("AllowedOrigins", Origin);
            b.UseSetting("ConnectionStrings:Postgres", "Host=127.0.0.1;Port=1;Database=x;Username=x;Password=x;Timeout=1");
            foreach (var (key, value) in settings) b.UseSetting(key, value);
            b.ConfigureServices(s => s.AddControllers().AddApplicationPart(typeof(PipelineProbeController).Assembly));
        });

    private static HttpRequestMessage Get(string path)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Add("Origin", Origin);
        return request;
    }

    [Fact]
    public async Task Every_response_carries_security_headers_and_server_timing()
    {
        using var factory = Factory();
        var response = await factory.CreateClient().SendAsync(Get("/api/v1/status"));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
        Assert.Equal("no-referrer", response.Headers.GetValues("Referrer-Policy").Single());
        Assert.Contains("default-src 'none'", response.Headers.GetValues("Content-Security-Policy").Single());
        Assert.StartsWith("app;dur=", response.Headers.GetValues("Server-Timing").Single());
        Assert.Equal(Origin, response.Headers.GetValues("Access-Control-Allow-Origin").Single());
    }

    [Fact]
    public async Task An_unhandled_error_is_a_problem_document_without_internals_and_still_readable_by_the_frontend()
    {
        using var factory = Factory();
        var response = await factory.CreateClient().SendAsync(Get("/__test/boom"));
        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal(Origin, response.Headers.GetValues("Access-Control-Allow-Origin").Single()); // CORS também no erro
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("senha", body);
        Assert.DoesNotContain("InvalidOperationException", body);
        using var problem = JsonDocument.Parse(body);
        Assert.Equal("Erro interno", problem.RootElement.GetProperty("title").GetString());
        Assert.False(string.IsNullOrEmpty(problem.RootElement.GetProperty("traceId").GetString()));
    }

    [Fact]
    public async Task A_database_timeout_is_a_503_with_retry_after()
    {
        using var factory = Factory();
        var response = await factory.CreateClient().SendAsync(Get("/__test/db-down"));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("5", response.Headers.GetValues("Retry-After").Single());
        Assert.True(ApiExceptionHandler.IsTransientDatabaseFailure(new Exception("x", new NpgsqlException("y", new TimeoutException()))));
        Assert.False(ApiExceptionHandler.IsTransientDatabaseFailure(new InvalidOperationException("regra")));
    }

    [Fact]
    public async Task Too_many_requests_from_one_origin_get_429_with_retry_after_but_health_is_never_limited()
    {
        using var factory = Factory(settings: ("RateLimit:PerMinute", "3"));
        var client = factory.CreateClient();
        for (var i = 0; i < 3; i++) Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Get("/api/v1/status"))).StatusCode);
        var limited = await client.SendAsync(Get("/api/v1/status"));
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.True(int.Parse(limited.Headers.GetValues("Retry-After").Single(), System.Globalization.CultureInfo.InvariantCulture) > 0);
        var problem = await limited.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Muitas requisições", problem.GetProperty("title").GetString());
        for (var i = 0; i < 5; i++) Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health")).StatusCode);
    }

    [Fact]
    public async Task The_site_server_with_the_internal_token_is_not_limited_but_a_wrong_token_is()
    {
        using var factory = Factory(settings: [("RateLimit:PerMinute", "2"), ("RateLimit:InternalToken", "token-interno-de-teste")]);
        var client = factory.CreateClient();
        for (var i = 0; i < 6; i++)
        {
            var internalRequest = Get("/api/v1/status");
            internalRequest.Headers.Add("X-Internal-Token", "token-interno-de-teste");
            Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(internalRequest)).StatusCode);
        }
        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 3; i++)
        {
            var wrong = Get("/api/v1/status");
            wrong.Headers.Add("X-Internal-Token", "chute");
            statuses.Add((await client.SendAsync(wrong)).StatusCode);
        }
        Assert.Equal([HttpStatusCode.OK, HttpStatusCode.OK, HttpStatusCode.TooManyRequests], statuses);
    }

    [Fact]
    public async Task Swagger_is_off_in_production_unless_explicitly_enabled()
    {
        using var production = Factory();
        Assert.Equal(HttpStatusCode.NotFound, (await production.CreateClient().GetAsync("/swagger/v1/swagger.json")).StatusCode);
        using var enabled = Factory(settings: ("Swagger:Enabled", "true"));
        Assert.Equal(HttpStatusCode.OK, (await enabled.CreateClient().GetAsync("/swagger/v1/swagger.json")).StatusCode);
    }

    [Fact]
    public async Task Migrate_is_hidden_without_the_right_token()
    {
        using var noToken = Factory(settings: ("MigrateOnStartup", "true"));
        Assert.Equal(HttpStatusCode.NotFound, (await noToken.CreateClient().PostAsync("/migrate", null)).StatusCode);

        using var withToken = Factory(settings: [("MigrateOnStartup", "true"), ("Migrate:Token", "token-de-teste-longo")]);
        var wrong = new HttpRequestMessage(HttpMethod.Post, "/migrate");
        wrong.Headers.Add("X-Migrate-Token", "outro");
        Assert.Equal(HttpStatusCode.NotFound, (await withToken.CreateClient().SendAsync(wrong)).StatusCode);
        Assert.False(HttpPipeline.SecretEquals("", ""));
        Assert.True(HttpPipeline.SecretEquals("token-de-teste-longo", "token-de-teste-longo"));
    }

    [Fact]
    public async Task Readiness_reports_an_unreachable_database_as_503_without_details()
    {
        using var factory = Factory();
        var response = await factory.CreateClient().GetAsync("/health/ready");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("{\"status\":\"unavailable\"}", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Browsers_may_only_read_the_api()
    {
        using var factory = Factory();
        var preflight = new HttpRequestMessage(HttpMethod.Options, "/api/v1/status");
        preflight.Headers.Add("Origin", Origin);
        preflight.Headers.Add("Access-Control-Request-Method", "DELETE");
        var response = await factory.CreateClient().SendAsync(preflight);
        Assert.False(response.Headers.TryGetValues("Access-Control-Allow-Methods", out var methods) && methods.Any(m => m.Contains("DELETE")));
    }
}
