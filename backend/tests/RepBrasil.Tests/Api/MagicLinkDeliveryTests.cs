using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using RepBrasil.API.Infrastructure;

namespace RepBrasil.Tests.Api;

/// <summary>
/// Entrega do magic link pela API HTTPS do Resend, sem rede: o cliente HTTP usa um handler de teste.
/// Cobre sucesso, tempo esgotado, erro do provedor, falha de rede, cancelamento do próprio pedido,
/// configuração recusada e a regra de que nenhum log traz e-mail, token, link ou chave.
/// </summary>
public sealed class MagicLinkDeliveryTests
{
    private const string ApiKey = "re_test_only_key_123";
    private const string Email = "pessoa@example.test";
    private const string Token = "token-secreto-de-teste";
    private const string SenderAddress = "acesso@apprepbrasil.com.br";
    private static readonly MagicLinkChallenge Challenge = new(Email, Token, "/conta", DateTimeOffset.UtcNow.AddMinutes(15));

    private sealed class Handler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        public List<(HttpRequestMessage Request, string Body)> Requests { get; } = [];
        public bool SawCancellation { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add((request, request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken)));
            cancellationToken.Register(() => SawCancellation = true);
            return await respond(request, cancellationToken);
        }
    }

    private sealed class Factory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) =>
            name == AuthExternalService.ResendClient
                ? new HttpClient(handler, disposeHandler: false)
                : throw new InvalidOperationException($"cliente inesperado: {name}");
    }

    private sealed class CapturingLogger : ILogger<AuthExternalService>
    {
        public List<string> Lines { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            var values = state is IEnumerable<KeyValuePair<string, object?>> pairs
                ? string.Join(" ", pairs.Select(pair => $"{pair.Key}={pair.Value}"))
                : "";
            Lines.Add($"{logLevel} {formatter(state, exception)} | {values} | {exception}");
        }
    }

    private sealed class FixedEnvironment(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "RepBrasil.Tests";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } =
            new Microsoft.Extensions.FileProviders.NullFileProvider();
    }

    private static AuthExternalService Service(Handler handler, CapturingLogger logger, Dictionary<string, string?>? overrides = null)
    {
        var settings = new Dictionary<string, string?>
        {
            ["Auth:PublicBaseUrl"] = "https://api.example.test",
            ["Auth:MagicLink:Delivery"] = "resend",
            ["Auth:MagicLink:Resend:ApiKey"] = ApiKey,
            ["Auth:MagicLink:From"] = $"REPBrasil <{SenderAddress}>",
            ["Auth:MagicLink:TimeoutSeconds"] = "1",
        };
        if (overrides is not null)
            foreach (var (key, value) in overrides) settings[key] = value;
        return new AuthExternalService(
            new ConfigurationBuilder().AddInMemoryCollection(settings).Build(),
            new Factory(handler),
            new FixedEnvironment(Environments.Production),
            logger);
    }

    private static Handler Responds(HttpStatusCode status, string body) =>
        new((_, _) => Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") }));

    private static Handler NoNetwork() => new((_, _) => throw new InvalidOperationException("sem rede neste teste"));

    /// <summary>Nenhuma linha de log pode carregar destinatário, remetente, token, link ou chave.</summary>
    private static void AssertNoSecrets(CapturingLogger logger)
    {
        string[] secrets = [Email, SenderAddress, Token, ApiKey, "magic-link/consume"];
        foreach (var line in logger.Lines)
        {
            foreach (var secret in secrets)
                Assert.DoesNotContain(secret, line, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task Sends_the_link_through_the_Resend_https_api()
    {
        var handler = Responds(HttpStatusCode.OK, """{"id":"4ef9a417-02e9-4d39-ad75-9611e0fcc33c"}""");
        var logger = new CapturingLogger();

        await Service(handler, logger).SendMagicLinkAsync(Challenge, CancellationToken.None);

        var (request, body) = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("https://api.resend.com/emails", request.RequestUri!.AbsoluteUri);
        Assert.Equal("Bearer", request.Headers.Authorization!.Scheme);
        Assert.Equal(ApiKey, request.Headers.Authorization.Parameter);
        using var json = JsonDocument.Parse(body);
        Assert.Equal($"REPBrasil <{SenderAddress}>", json.RootElement.GetProperty("from").GetString());
        Assert.Equal(Email, Assert.Single(json.RootElement.GetProperty("to").EnumerateArray().ToList()).GetString());
        Assert.Equal("Seu acesso ao REPBrasil", json.RootElement.GetProperty("subject").GetString());
        Assert.Contains($"https://api.example.test/api/v1/auth/magic-link/consume?token={Token}", json.RootElement.GetProperty("text").GetString());
        Assert.Contains(logger.Lines, line => line.Contains("provider=resend status=200"));
        AssertNoSecrets(logger);
    }

    [Fact]
    public async Task Gives_up_at_the_deadline_and_cancels_the_provider_request()
    {
        var handler = new Handler(async (_, cancellationToken) =>
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.OK);
        });
        var logger = new CapturingLogger();
        var clock = Stopwatch.StartNew();

        var error = await Assert.ThrowsAsync<MagicLinkDeliveryException>(() =>
            Service(handler, logger).SendMagicLinkAsync(Challenge, CancellationToken.None));

        Assert.InRange(clock.Elapsed, TimeSpan.FromSeconds(0.9), TimeSpan.FromSeconds(10));
        Assert.True(handler.SawCancellation);
        Assert.True(error.MayHaveBeenSent); // o provedor pode ter aceitado: o cookie de correlação fica
        Assert.Contains(logger.Lines, line => line.Contains("reason=timeout"));
        AssertNoSecrets(logger);
    }

    [Theory]
    [InlineData(HttpStatusCode.Forbidden, """{"statusCode":403,"name":"validation_error","message":"pessoa@example.test token-secreto-de-teste re_test_only_key_123"}""", "validation_error")]
    [InlineData(HttpStatusCode.TooManyRequests, """{"statusCode":429,"name":"rate_limit_exceeded","message":"Too many requests"}""", "rate_limit_exceeded")]
    [InlineData(HttpStatusCode.InternalServerError, "<html>pessoa@example.test</html>", "desconhecido")]
    [InlineData(HttpStatusCode.BadRequest, """{"name":"Pessoa@example.test"}""", "desconhecido")]
    public async Task Provider_errors_end_in_a_controlled_failure(HttpStatusCode status, string body, string expectedCode)
    {
        var logger = new CapturingLogger();

        var error = await Assert.ThrowsAsync<MagicLinkDeliveryException>(() =>
            Service(Responds(status, body), logger).SendMagicLinkAsync(Challenge, CancellationToken.None));

        Assert.False(error.MayHaveBeenSent);
        Assert.Contains(logger.Lines, line => line.Contains($"status={(int)status}") && line.Contains($"providerError={expectedCode}"));
        AssertNoSecrets(logger);
    }

    [Theory]
    [InlineData("NaN")]
    [InlineData("10s")]
    [InlineData("Infinity")]
    public async Task Unreadable_timeout_falls_back_to_the_default_and_still_sends(string timeout)
    {
        var handler = Responds(HttpStatusCode.OK, """{"id":"x"}""");
        var logger = new CapturingLogger();

        await Service(handler, logger, new() { ["Auth:MagicLink:TimeoutSeconds"] = timeout }).SendMagicLinkAsync(Challenge, CancellationToken.None);

        Assert.Single(handler.Requests);
        Assert.Contains(logger.Lines, line => line.Contains("Auth:MagicLink:TimeoutSeconds inválido"));
    }

    [Fact]
    public async Task Api_key_and_sender_pasted_with_surrounding_whitespace_are_trimmed()
    {
        var handler = Responds(HttpStatusCode.OK, """{"id":"x"}""");
        var logger = new CapturingLogger();

        await Service(handler, logger, new()
        {
            ["Auth:MagicLink:Resend:ApiKey"] = $" {ApiKey}\n",
            ["Auth:MagicLink:From"] = $" REPBrasil <{SenderAddress}>\r\n",
        }).SendMagicLinkAsync(Challenge, CancellationToken.None);

        var (request, body) = Assert.Single(handler.Requests);
        Assert.Equal(ApiKey, request.Headers.Authorization!.Parameter);
        using var json = JsonDocument.Parse(body);
        Assert.Equal($"REPBrasil <{SenderAddress}>", json.RootElement.GetProperty("from").GetString());
    }

    [Fact]
    public async Task Network_failure_ends_in_a_controlled_failure()
    {
        var handler = new Handler((_, _) => throw new HttpRequestException(HttpRequestError.ConnectionError, "Connection refused (api.resend.com:443)"));
        var logger = new CapturingLogger();

        var error = await Assert.ThrowsAsync<MagicLinkDeliveryException>(() =>
            Service(handler, logger).SendMagicLinkAsync(Challenge, CancellationToken.None));

        Assert.False(error.MayHaveBeenSent);
        Assert.Contains(logger.Lines, line => line.Contains("reason=network") && line.Contains("ConnectionError"));
        AssertNoSecrets(logger);
    }

    [Fact]
    public async Task Cancellation_of_the_request_itself_is_propagated_not_reported_as_unavailable()
    {
        using var caller = new CancellationTokenSource();
        var handler = new Handler(async (_, cancellationToken) =>
        {
            await caller.CancelAsync();
            await Task.Delay(Timeout.Infinite, cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.OK);
        });
        var logger = new CapturingLogger();

        var error = await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            Service(handler, logger).SendMagicLinkAsync(Challenge, caller.Token));

        Assert.IsNotType<MagicLinkDeliveryException>(error);
        Assert.True(handler.SawCancellation);
        Assert.DoesNotContain(logger.Lines, line => line.Contains("reason="));
    }

    [Theory]
    [InlineData("smtp")]
    [InlineData("sendgrid")]
    [InlineData(null)]
    public async Task Only_resend_delivers_outside_development(string? delivery)
    {
        var handler = NoNetwork();
        var logger = new CapturingLogger();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Service(handler, logger, new() { ["Auth:MagicLink:Delivery"] = delivery }).SendMagicLinkAsync(Challenge, CancellationToken.None));

        Assert.Empty(handler.Requests);
        Assert.Contains(logger.Lines, line => line.Contains("Auth:MagicLink:Delivery"));
        AssertNoSecrets(logger);
    }

    [Theory]
    [InlineData("Auth:MagicLink:Resend:ApiKey")]
    [InlineData("Auth:MagicLink:From")]
    public async Task Missing_resend_settings_are_refused_and_logged_by_name_only(string setting)
    {
        var handler = NoNetwork();
        var logger = new CapturingLogger();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Service(handler, logger, new() { [setting] = " " }).SendMagicLinkAsync(Challenge, CancellationToken.None));

        Assert.Empty(handler.Requests);
        Assert.Contains(logger.Lines, line => line.Contains(setting));
        AssertNoSecrets(logger);
    }
}
