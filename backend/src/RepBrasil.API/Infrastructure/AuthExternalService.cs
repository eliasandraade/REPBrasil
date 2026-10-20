using System.Diagnostics;
using System.Globalization;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace RepBrasil.API.Infrastructure;

public sealed record GoogleProfile(string Subject, string Email, string? Name, string? Picture, bool EmailVerified);

/// <summary>
/// O provedor de e-mail não confirmou o magic link: tempo esgotado, falha de rede ou resposta de erro. O pedido
/// termina em 503. <see cref="MayHaveBeenSent"/> marca o tempo esgotado: o provedor pode ter aceitado o e-mail
/// sem responder a tempo, então o cookie de correlação é mantido para o link continuar válido neste navegador.
/// </summary>
public sealed class MagicLinkDeliveryException(string reason, bool mayHaveBeenSent = false)
    : InvalidOperationException($"Entrega do magic link falhou: {reason}.")
{
    public bool MayHaveBeenSent { get; } = mayHaveBeenSent;
}

public sealed class AuthExternalService(
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory,
    IHostEnvironment environment,
    ILogger<AuthExternalService> logger)
{
    /// <summary>Cliente HTTP nomeado da API do Resend (HTTPS, porta 443).</summary>
    public const string ResendClient = "resend";
    private static readonly Uri ResendEmails = new("https://api.resend.com/emails");
    private const double DefaultDeliveryTimeoutSeconds = 10;
    // Abaixo dos 20 s em que o navegador desiste (MAGIC_LINK_TIMEOUT_MS), para o 503 sempre chegar antes.
    private const double MaxDeliveryTimeoutSeconds = 15;

    public async Task SendMagicLinkAsync(MagicLinkChallenge challenge, CancellationToken cancellationToken)
    {
        var publicBase = RequireAbsolute("Auth:PublicBaseUrl");
        var callback = new UriBuilder(new Uri(publicBase, "/api/v1/auth/magic-link/consume"));
        callback.Query = $"token={Uri.EscapeDataString(challenge.Token)}";
        var link = callback.Uri.AbsoluteUri;
        var delivery = configuration["Auth:MagicLink:Delivery"];

        if (string.Equals(delivery, "log", StringComparison.OrdinalIgnoreCase))
        {
            // O link é uma credencial de login: só pode ir para o log em desenvolvimento local.
            if (!environment.IsDevelopment())
                throw new InvalidOperationException("Entrega de magic link por log só é permitida em desenvolvimento.");
            logger.LogInformation("Magic link for {Email}: {Link}", challenge.Email, link);
            return;
        }

        // A entrega ativa é só a API HTTPS do Resend: o Railway bloqueia SMTP de saída fora do plano Pro.
        if (!string.Equals(delivery, "resend", StringComparison.OrdinalIgnoreCase))
        {
            logger.LogWarning("Magic link não enviado: Auth:MagicLink:Delivery ausente ou não suportado (esperado: resend).");
            throw new InvalidOperationException("Entrega de magic link não configurada.");
        }

        // Segredo colado com espaço ou quebra de linha no fim não pode virar cabeçalho inválido.
        var apiKey = configuration["Auth:MagicLink:Resend:ApiKey"]?.Trim();
        var sender = configuration["Auth:MagicLink:From"]?.Trim();
        if (string.IsNullOrWhiteSpace(apiKey) || string.IsNullOrWhiteSpace(sender))
        {
            var missing = new List<string>();
            if (string.IsNullOrWhiteSpace(apiKey)) missing.Add("Auth:MagicLink:Resend:ApiKey");
            if (string.IsNullOrWhiteSpace(sender)) missing.Add("Auth:MagicLink:From");
            logger.LogWarning("Magic link não enviado: configuração ausente ({MissingSettings}).", string.Join(", ", missing));
            throw new InvalidOperationException("Entrega de magic link não configurada.");
        }

        await SendWithResendAsync(apiKey, sender, challenge.Email, link, cancellationToken);
    }

    /// <summary>
    /// POST /emails da API do Resend com prazo próprio (10 s, <c>Auth:MagicLink:TimeoutSeconds</c>, 1–15). Os logs
    /// trazem só provedor, motivo, status HTTP, código de erro do provedor e duração: nunca e-mail, token, link
    /// nem chave. Cancelamento do próprio pedido (navegador desistiu) é propagado; o resto vira 503.
    /// </summary>
    private async Task SendWithResendAsync(string apiKey, string sender, string recipient, string link, CancellationToken cancellationToken)
    {
        var timeout = DeliveryTimeout();
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(timeout);
        using var request = new HttpRequestMessage(HttpMethod.Post, ResendEmails)
        {
            Content = JsonContent.Create(new
            {
                from = sender,
                to = new[] { recipient },
                subject = "Seu acesso ao REPBrasil",
                text = $"Use este link para entrar no REPBrasil. Ele expira em 15 minutos:\n\n{link}\n\nSe você não solicitou este acesso, ignore esta mensagem.",
            }),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        var started = Stopwatch.GetTimestamp();
        try
        {
            using var response = await httpClientFactory.CreateClient(ResendClient).SendAsync(request, deadline.Token);
            if (response.IsSuccessStatusCode)
            {
                logger.LogInformation("Magic link entregue ao provedor: provider=resend status={Status} elapsedMs={ElapsedMs}.",
                    (int)response.StatusCode, ElapsedMs(started));
                return;
            }
            var providerError = await ProviderErrorAsync(response, deadline.Token);
            logger.LogWarning("Magic link não enviado: provider=resend reason=http_status status={Status} providerError={ProviderError} elapsedMs={ElapsedMs}.",
                (int)response.StatusCode, providerError, ElapsedMs(started));
            throw new MagicLinkDeliveryException("resposta de erro do provedor");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("Magic link não confirmado: provider=resend reason=timeout elapsedMs={ElapsedMs}.", ElapsedMs(started));
            throw new MagicLinkDeliveryException("tempo esgotado", mayHaveBeenSent: true);
        }
        catch (HttpRequestException ex)
        {
            logger.LogWarning("Magic link não enviado: provider=resend reason=network error={HttpRequestError} elapsedMs={ElapsedMs}.",
                ex.HttpRequestError, ElapsedMs(started));
            throw new MagicLinkDeliveryException("falha de rede");
        }
    }

    /// <summary>Só o código de erro do Resend (ex.: <c>validation_error</c>); a mensagem pode citar o destinatário.</summary>
    private static async Task<string> ProviderErrorAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        try
        {
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            var code = json.RootElement.ValueKind == JsonValueKind.Object
                && json.RootElement.TryGetProperty("name", out var name)
                && name.ValueKind == JsonValueKind.String
                ? name.GetString() ?? ""
                : "";
            return code.Length is > 0 and <= 64 && code.All(c => c is (>= 'a' and <= 'z') or '_') ? code : "desconhecido";
        }
        catch (JsonException)
        {
            return "desconhecido";
        }
    }

    /// <summary>Prazo do envio; valor ausente, ilegível ou não finito usa o padrão de 10 s (com aviso no log).</summary>
    private TimeSpan DeliveryTimeout()
    {
        var raw = configuration["Auth:MagicLink:TimeoutSeconds"];
        if (string.IsNullOrWhiteSpace(raw)) return TimeSpan.FromSeconds(DefaultDeliveryTimeoutSeconds);
        if (double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds) && double.IsFinite(seconds))
            return TimeSpan.FromSeconds(Math.Clamp(seconds, 1, MaxDeliveryTimeoutSeconds));
        logger.LogWarning("Auth:MagicLink:TimeoutSeconds inválido; usando {DefaultSeconds} s.", DefaultDeliveryTimeoutSeconds);
        return TimeSpan.FromSeconds(DefaultDeliveryTimeoutSeconds);
    }

    private static long ElapsedMs(long started) => (long)Stopwatch.GetElapsedTime(started).TotalMilliseconds;

    public string BuildGoogleAuthorizeUrl(string state)
    {
        var clientId = configuration["Auth:Google:ClientId"] ?? throw new InvalidOperationException("Google OAuth não configurado.");
        var redirectUri = RequireAbsolute("Auth:Google:RedirectUri").AbsoluteUri;
        var query = new Dictionary<string, string>
        {
            ["client_id"] = clientId,
            ["redirect_uri"] = redirectUri,
            ["response_type"] = "code",
            ["scope"] = "openid email profile",
            ["state"] = state,
            ["prompt"] = "select_account"
        };
        return "https://accounts.google.com/o/oauth2/v2/auth?" + string.Join('&', query.Select(x => $"{Uri.EscapeDataString(x.Key)}={Uri.EscapeDataString(x.Value)}"));
    }

    public async Task<GoogleProfile> ExchangeGoogleCodeAsync(string code, CancellationToken cancellationToken)
    {
        var clientId = configuration["Auth:Google:ClientId"] ?? throw new InvalidOperationException("Google OAuth não configurado.");
        var clientSecret = configuration["Auth:Google:ClientSecret"] ?? throw new InvalidOperationException("Google OAuth não configurado.");
        var redirectUri = RequireAbsolute("Auth:Google:RedirectUri").AbsoluteUri;
        var client = httpClientFactory.CreateClient("google-auth");
        using var tokenResponse = await client.PostAsync("https://oauth2.googleapis.com/token", new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["code"] = code,
            ["client_id"] = clientId,
            ["client_secret"] = clientSecret,
            ["redirect_uri"] = redirectUri,
            ["grant_type"] = "authorization_code"
        }), cancellationToken);
        tokenResponse.EnsureSuccessStatusCode();
        using var tokenJson = JsonDocument.Parse(await tokenResponse.Content.ReadAsStringAsync(cancellationToken));
        var accessToken = tokenJson.RootElement.GetProperty("access_token").GetString();
        if (string.IsNullOrWhiteSpace(accessToken)) throw new InvalidOperationException("Google não retornou access token.");

        using var request = new HttpRequestMessage(HttpMethod.Get, "https://openidconnect.googleapis.com/v1/userinfo");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        using var profileResponse = await client.SendAsync(request, cancellationToken);
        profileResponse.EnsureSuccessStatusCode();
        using var profileJson = JsonDocument.Parse(await profileResponse.Content.ReadAsStringAsync(cancellationToken));
        var root = profileJson.RootElement;
        var subject = root.GetProperty("sub").GetString();
        var email = root.GetProperty("email").GetString();
        if (string.IsNullOrWhiteSpace(subject) || string.IsNullOrWhiteSpace(email)) throw new InvalidOperationException("Perfil Google sem identidade verificável.");
        var verified = root.TryGetProperty("email_verified", out var ev) && ev.ValueKind == JsonValueKind.True;
        if (!verified) throw new InvalidOperationException("O Google não confirmou o e-mail desta conta.");
        return new(subject, email, Optional(root, "name"), Optional(root, "picture"), verified);
    }

    public Uri FrontendRedirect(string returnTo)
    {
        var frontend = RequireAbsolute("Auth:FrontendBaseUrl");
        return new Uri(frontend, AccountService.NormalizeReturnTo(returnTo));
    }

    private Uri RequireAbsolute(string key)
    {
        var raw = configuration[key];
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var value) || value.Scheme is not ("http" or "https"))
            throw new InvalidOperationException($"Configuração obrigatória ausente ou inválida: {key}.");
        return value;
    }

    private static string? Optional(JsonElement root, string name) => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
