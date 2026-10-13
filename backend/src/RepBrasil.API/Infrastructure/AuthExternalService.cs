using System.Net;
using System.Net.Http.Headers;
using System.Net.Mail;
using System.Text.Json;

namespace RepBrasil.API.Infrastructure;

public sealed record GoogleProfile(string Subject, string Email, string? Name, string? Picture, bool EmailVerified);

public sealed class AuthExternalService(
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory,
    IHostEnvironment environment,
    ILogger<AuthExternalService> logger)
{
    public async Task SendMagicLinkAsync(MagicLinkChallenge challenge, CancellationToken cancellationToken)
    {
        var publicBase = RequireAbsolute("Auth:PublicBaseUrl");
        var callback = new UriBuilder(new Uri(publicBase, "/api/v1/auth/magic-link/consume"));
        callback.Query = $"token={Uri.EscapeDataString(challenge.Token)}";
        var link = callback.Uri.AbsoluteUri;
        var delivery = configuration["Auth:MagicLink:Delivery"] ?? "smtp";

        if (string.Equals(delivery, "log", StringComparison.OrdinalIgnoreCase))
        {
            // O link é uma credencial de login: só pode ir para o log em desenvolvimento local.
            if (!environment.IsDevelopment())
                throw new InvalidOperationException("Entrega de magic link por log só é permitida em desenvolvimento.");
            logger.LogInformation("Magic link for {Email}: {Link}", challenge.Email, link);
            return;
        }

        var host = configuration["Auth:MagicLink:Smtp:Host"];
        var from = configuration["Auth:MagicLink:Smtp:From"];
        if (string.IsNullOrWhiteSpace(host) || string.IsNullOrWhiteSpace(from))
            throw new InvalidOperationException("Entrega de magic link não configurada.");

        var port = configuration.GetValue("Auth:MagicLink:Smtp:Port", 587);
        var ssl = configuration.GetValue("Auth:MagicLink:Smtp:EnableSsl", true);
        using var message = new MailMessage(from, challenge.Email)
        {
            Subject = "Seu acesso ao REPBrasil",
            Body = $"Use este link para entrar no REPBrasil. Ele expira em 15 minutos:\n\n{link}\n\nSe você não solicitou este acesso, ignore esta mensagem.",
            IsBodyHtml = false
        };
        using var client = new SmtpClient(host, port) { EnableSsl = ssl };
        var username = configuration["Auth:MagicLink:Smtp:Username"];
        var password = configuration["Auth:MagicLink:Smtp:Password"];
        if (!string.IsNullOrWhiteSpace(username)) client.Credentials = new NetworkCredential(username, password);
        cancellationToken.ThrowIfCancellationRequested();
        await client.SendMailAsync(message, cancellationToken);
    }

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
