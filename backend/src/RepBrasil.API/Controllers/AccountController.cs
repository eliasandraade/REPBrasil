using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using RepBrasil.API.Infrastructure;

namespace RepBrasil.API.Controllers;

[ApiController]
[Route("api/v1")]
public sealed class AccountController(AccountService accounts, AuthExternalService external, IConfiguration configuration) : ControllerBase
{
    private const string SessionCookie = "repbrasil_session";
    private const string GoogleCorrelationCookie = "repbrasil_google_state";

    [HttpPost("auth/magic-link")]
    public async Task<IActionResult> RequestMagicLink([FromBody] MagicLinkRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var challenge = await accounts.CreateMagicLinkChallengeAsync(request.Email, request.ReturnTo, cancellationToken);
            await external.SendMagicLinkAsync(challenge, cancellationToken);
            return Accepted(new { status = "accepted" });
        }
        catch (ArgumentException)
        {
            return Accepted(new { status = "accepted" });
        }
        catch (InvalidOperationException)
        {
            return Problem("O login por e-mail está temporariamente indisponível.", statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }

    [HttpGet("auth/magic-link/consume")]
    public async Task<IActionResult> ConsumeMagicLink([FromQuery] string token, CancellationToken cancellationToken)
    {
        var result = await accounts.ConsumeMagicLinkAsync(token, Request.Headers.UserAgent.ToString(), HttpContext.Connection.RemoteIpAddress?.ToString(), cancellationToken);
        if (result is null) return Redirect(external.FrontendRedirect("/entrar?erro=link-invalido").AbsoluteUri);
        SetSessionCookie(result.Value.SessionToken, result.Value.Session.ExpiresAt);
        return Redirect(external.FrontendRedirect(result.Value.ReturnTo).AbsoluteUri);
    }

    [HttpGet("auth/google/start")]
    public async Task<IActionResult> GoogleStart([FromQuery] string? returnTo, CancellationToken cancellationToken)
    {
        try
        {
            var state = await accounts.CreateGoogleStateAsync(returnTo, cancellationToken);
            var options = CorrelationCookieOptions();
            options.Expires = DateTimeOffset.UtcNow.AddMinutes(10);
            Response.Cookies.Append(GoogleCorrelationCookie, state, options);
            return Redirect(external.BuildGoogleAuthorizeUrl(state));
        }
        catch (InvalidOperationException)
        {
            return Redirect(external.FrontendRedirect("/entrar?erro=google-indisponivel").AbsoluteUri);
        }
    }

    [HttpGet("auth/google/callback")]
    public async Task<IActionResult> GoogleCallback([FromQuery] string? code, [FromQuery] string? state, [FromQuery] string? error, CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(error) || string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(state))
            return Redirect(external.FrontendRedirect("/entrar?erro=google-cancelado").AbsoluteUri);

        var correlation = Request.Cookies.TryGetValue(GoogleCorrelationCookie, out var storedState) ? storedState : null;
        Response.Cookies.Delete(GoogleCorrelationCookie, CorrelationCookieOptions());
        if (!AccountService.SecureEquals(correlation, state))
            return Redirect(external.FrontendRedirect("/entrar?erro=estado-invalido").AbsoluteUri);

        var returnTo = await accounts.ConsumeGoogleStateAsync(state, cancellationToken);
        if (returnTo is null) return Redirect(external.FrontendRedirect("/entrar?erro=estado-invalido").AbsoluteUri);
        try
        {
            var profile = await external.ExchangeGoogleCodeAsync(code, cancellationToken);
            var result = await accounts.SignInGoogleAsync(profile.Subject, profile.Email, profile.Name, profile.Picture, profile.EmailVerified,
                Request.Headers.UserAgent.ToString(), HttpContext.Connection.RemoteIpAddress?.ToString(), cancellationToken);
            SetSessionCookie(result.Token, result.Session.ExpiresAt);
            return Redirect(external.FrontendRedirect(returnTo).AbsoluteUri);
        }
        catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException)
        {
            return Redirect(external.FrontendRedirect("/entrar?erro=google-falhou").AbsoluteUri);
        }
    }

    [HttpGet("account/me")]
    public async Task<IActionResult> Me(CancellationToken cancellationToken)
    {
        var session = await CurrentSession(cancellationToken);
        if (session is null) return Unauthorized();
        return Ok(new
        {
            id = session.UserId,
            email = session.Email,
            displayName = session.DisplayName,
            avatarUrl = session.AvatarUrl,
            csrfToken = session.CsrfToken,
            sessionExpiresAt = session.ExpiresAt
        });
    }

    [HttpPost("auth/logout")]
    public async Task<IActionResult> Logout(CancellationToken cancellationToken)
    {
        var session = await RequireMutationSession(cancellationToken);
        if (session is null) return Unauthorized();
        if (Request.Cookies.TryGetValue(SessionCookie, out var token)) await accounts.RevokeSessionAsync(token, cancellationToken);
        Response.Cookies.Delete(SessionCookie, SessionCookieOptions());
        return NoContent();
    }

    [HttpGet("account/saved")]
    public async Task<IActionResult> Saved([FromQuery] string collection = "favorite", CancellationToken cancellationToken = default)
    {
        var session = await CurrentSession(cancellationToken);
        if (session is null) return Unauthorized();
        try { return Ok(await accounts.GetSavedItemsAsync(session.UserId, collection, cancellationToken)); }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("account/saved")]
    public async Task<IActionResult> Save([FromBody] SaveItemRequest request, CancellationToken cancellationToken)
    {
        var session = await RequireMutationSession(cancellationToken);
        if (session is null) return Unauthorized();
        try
        {
            return Ok(await accounts.SaveItemAsync(session.UserId, request.Collection, request.ResourceType, request.ResourceKey, request.Label, request.Href, request.Metadata, cancellationToken));
        }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpDelete("account/saved")]
    public async Task<IActionResult> RemoveSaved([FromQuery] string collection, [FromQuery] string resourceType, [FromQuery] string resourceKey, CancellationToken cancellationToken)
    {
        var session = await RequireMutationSession(cancellationToken);
        if (session is null) return Unauthorized();
        try
        {
            await accounts.RemoveSavedItemAsync(session.UserId, collection, resourceType, resourceKey, cancellationToken);
            return NoContent();
        }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpGet("account/alerts")]
    public async Task<IActionResult> Alerts(CancellationToken cancellationToken)
    {
        var session = await CurrentSession(cancellationToken);
        return session is null ? Unauthorized() : Ok(await accounts.GetAlertsAsync(session.UserId, cancellationToken));
    }

    [HttpPost("account/alerts")]
    public async Task<IActionResult> UpsertAlert([FromBody] AlertRequest request, CancellationToken cancellationToken)
    {
        var session = await RequireMutationSession(cancellationToken);
        if (session is null) return Unauthorized();
        try { return Ok(await accounts.UpsertAlertAsync(session.UserId, request.ResourceType, request.ResourceKey, request.EventKind, request.Delivery, request.Enabled, cancellationToken)); }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpDelete("account/alerts/{id:guid}")]
    public async Task<IActionResult> DeleteAlert(Guid id, CancellationToken cancellationToken)
    {
        var session = await RequireMutationSession(cancellationToken);
        if (session is null) return Unauthorized();
        await accounts.DeleteAlertAsync(session.UserId, id, cancellationToken);
        return NoContent();
    }

    [HttpGet("account/notifications")]
    public async Task<IActionResult> Notifications(CancellationToken cancellationToken)
    {
        var session = await CurrentSession(cancellationToken);
        return session is null ? Unauthorized() : Ok(await accounts.GetNotificationsAsync(session.UserId, cancellationToken));
    }

    [HttpPost("account/notifications/{id:guid}/read")]
    public async Task<IActionResult> ReadNotification(Guid id, CancellationToken cancellationToken)
    {
        var session = await RequireMutationSession(cancellationToken);
        if (session is null) return Unauthorized();
        await accounts.MarkNotificationReadAsync(session.UserId, id, cancellationToken);
        return NoContent();
    }

    [HttpGet("account/entitlements")]
    public async Task<IActionResult> Entitlements(CancellationToken cancellationToken)
    {
        var session = await CurrentSession(cancellationToken);
        return session is null ? Unauthorized() : Ok(await accounts.GetEntitlementsAsync(session.UserId, cancellationToken));
    }

    [HttpGet("account/api-keys")]
    public async Task<IActionResult> ApiKeys(CancellationToken cancellationToken)
    {
        var session = await CurrentSession(cancellationToken);
        return session is null ? Unauthorized() : Ok(await accounts.GetApiKeysAsync(session.UserId, cancellationToken));
    }

    [HttpPost("account/api-keys")]
    public async Task<IActionResult> CreateApiKey([FromBody] CreateApiKeyRequest request, CancellationToken cancellationToken)
    {
        var session = await RequireMutationSession(cancellationToken);
        if (session is null) return Unauthorized();
        try { return Ok(await accounts.CreateApiKeyAsync(session.UserId, request.Name, request.Scopes, cancellationToken)); }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpDelete("account/api-keys/{id:guid}")]
    public async Task<IActionResult> RevokeApiKey(Guid id, CancellationToken cancellationToken)
    {
        var session = await RequireMutationSession(cancellationToken);
        if (session is null) return Unauthorized();
        await accounts.RevokeApiKeyAsync(session.UserId, id, cancellationToken);
        return NoContent();
    }

    [HttpPost("internal/alerts/publish")]
    public async Task<IActionResult> PublishAlert([FromBody] PublishAlertRequest request, CancellationToken cancellationToken)
    {
        if (!AccountService.SecureEquals(Request.Headers["X-Alerts-Token"].ToString(), configuration["Alerts:PublishToken"])) return NotFound();
        try
        {
            var count = await accounts.PublishAlertAsync(request.EventKey, request.ResourceType, request.ResourceKey, request.EventKind, request.Title, request.Body, request.Href, request.Payload, cancellationToken);
            return Ok(new { created = count });
        }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
    }

    private async Task<AccountSession?> CurrentSession(CancellationToken cancellationToken) =>
        Request.Cookies.TryGetValue(SessionCookie, out var token) ? await accounts.GetSessionAsync(token, cancellationToken) : null;

    private async Task<AccountSession?> RequireMutationSession(CancellationToken cancellationToken)
    {
        var session = await CurrentSession(cancellationToken);
        if (session is null) return null;
        return AccountService.SecureEquals(Request.Headers["X-RepBrasil-CSRF"].ToString(), session.CsrfToken) ? session : null;
    }

    private void SetSessionCookie(string token, DateTimeOffset expiresAt)
    {
        var options = SessionCookieOptions();
        options.Expires = expiresAt;
        Response.Cookies.Append(SessionCookie, token, options);
    }

    private CookieOptions SessionCookieOptions()
    {
        var sameSite = ParseSameSite(configuration["Auth:CookieSameSite"]);
        return new CookieOptions
        {
            HttpOnly = true,
            Secure = sameSite == SameSiteMode.None || !HttpContext.RequestServices.GetRequiredService<IWebHostEnvironment>().IsDevelopment(),
            SameSite = sameSite,
            Path = "/",
            Domain = string.IsNullOrWhiteSpace(configuration["Auth:CookieDomain"]) ? null : configuration["Auth:CookieDomain"],
            IsEssential = true
        };
    }

    private CookieOptions CorrelationCookieOptions() => new()
    {
        HttpOnly = true,
        Secure = !HttpContext.RequestServices.GetRequiredService<IWebHostEnvironment>().IsDevelopment(),
        SameSite = SameSiteMode.Lax,
        Path = "/api/v1/auth/google",
        IsEssential = true
    };

    private static SameSiteMode ParseSameSite(string? configured) =>
        string.Equals(configured, "None", StringComparison.OrdinalIgnoreCase) ? SameSiteMode.None :
        string.Equals(configured, "Strict", StringComparison.OrdinalIgnoreCase) ? SameSiteMode.Strict :
        SameSiteMode.Lax;

    public sealed record MagicLinkRequest(string Email, string? ReturnTo);
    public sealed record SaveItemRequest(string Collection, string ResourceType, string ResourceKey, string? Label, string? Href, JsonElement? Metadata);
    public sealed record AlertRequest(string ResourceType, string ResourceKey, string EventKind, string Delivery = "in_app", bool Enabled = true);
    public sealed record CreateApiKeyRequest(string Name, string[]? Scopes);
    public sealed record PublishAlertRequest(string EventKey, string ResourceType, string ResourceKey, string EventKind, string Title, string? Body, string? Href, JsonElement? Payload);
}
