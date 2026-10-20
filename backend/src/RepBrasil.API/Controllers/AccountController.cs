using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using RepBrasil.API.Accounts;
using RepBrasil.API.Infrastructure;

namespace RepBrasil.API.Controllers;

[ApiController]
[Route("api/v1")]
public sealed class AccountController(
    AccountService accounts,
    AccountAccessService access,
    ProfileService profiles,
    AuthExternalService external,
    IConfiguration configuration) : ControllerBase
{
    private const string SessionCookie = AccountAccessService.SessionCookie;
    private const string GoogleCorrelationCookie = "repbrasil_google_state";
    private const string MagicLinkCorrelationCookie = "repbrasil_magic_link";

    [HttpPost("auth/magic-link")]
    public async Task<IActionResult> RequestMagicLink([FromBody] MagicLinkRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var challenge = await accounts.CreateMagicLinkChallengeAsync(request.Email, request.ReturnTo, cancellationToken);
            var options = MagicLinkCorrelationCookieOptions();
            options.Expires = challenge.ExpiresAt;
            Response.Cookies.Append(MagicLinkCorrelationCookie, challenge.Token, options);
            await external.SendMagicLinkAsync(challenge, cancellationToken);
            return Accepted(new { status = "accepted" });
        }
        catch (ArgumentException)
        {
            return Accepted(new { status = "accepted" });
        }
        catch (MagicLinkDeliveryException ex)
        {
            // Provedor não confirmou o envio (tempo esgotado, rede ou erro HTTP): 503 sem deixar o navegador esperando.
            // No tempo esgotado o e-mail pode ter saído, então o cookie fica para o link valer neste navegador.
            if (!ex.MayHaveBeenSent) Response.Cookies.Delete(MagicLinkCorrelationCookie, MagicLinkCorrelationCookieOptions());
            return Problem("O login por e-mail está temporariamente indisponível.", statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        catch (InvalidOperationException)
        {
            Response.Cookies.Delete(MagicLinkCorrelationCookie, MagicLinkCorrelationCookieOptions());
            return Problem("O login por e-mail está temporariamente indisponível.", statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }

    [HttpGet("auth/magic-link/consume")]
    public async Task<IActionResult> ConsumeMagicLink([FromQuery] string token, CancellationToken cancellationToken)
    {
        var correlation = Request.Cookies.TryGetValue(MagicLinkCorrelationCookie, out var storedToken) ? storedToken : null;
        Response.Cookies.Delete(MagicLinkCorrelationCookie, MagicLinkCorrelationCookieOptions());
        if (!AccountService.SecureEquals(correlation, token))
            return Redirect(external.FrontendRedirect("/entrar?erro=link-invalido").AbsoluteUri);

        (AccountSession Session, string SessionToken, string ReturnTo)? result;
        try
        {
            result = await accounts.ConsumeMagicLinkAsync(token, Request.Headers.UserAgent.ToString(), HttpContext.Connection.RemoteIpAddress?.ToString(), cancellationToken);
        }
        catch (AccountSuspendedException)
        {
            return Redirect(external.FrontendRedirect("/entrar?erro=conta-suspensa").AbsoluteUri);
        }
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
            var options = GoogleCorrelationCookieOptions();
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
        Response.Cookies.Delete(GoogleCorrelationCookie, GoogleCorrelationCookieOptions());
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
        catch (AccountSuspendedException)
        {
            return Redirect(external.FrontendRedirect("/entrar?erro=conta-suspensa").AbsoluteUri);
        }
        catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException)
        {
            return Redirect(external.FrontendRedirect("/entrar?erro=google-falhou").AbsoluteUri);
        }
    }

    /// <summary>
    /// Conta da sessão: identidade, papel, plano efetivo (com a origem), recursos e limites decididos pelo servidor,
    /// assinatura, perfil e uso frente aos limites. Nenhum segredo além do token CSRF da própria sessão.
    /// </summary>
    [HttpGet("account/me")]
    [RequiresSession]
    public async Task<IActionResult> Me(CancellationToken cancellationToken)
    {
        var session = await RequiredSession(cancellationToken);
        Response.Headers.CacheControl = "no-store";
        return Ok(await AccountPayloadAsync(session, cancellationToken));
    }

    /// <summary>
    /// Mesmo conteúdo de <c>/account/me</c>, mas sem erro para quem não entrou (<c>{"authenticated":false}</c>):
    /// a interface consulta o estado da sessão em toda página e um 401 esperado não deve virar erro no console.
    /// </summary>
    [HttpGet("account/session")]
    public async Task<IActionResult> SessionState(CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        var session = await CurrentSession(cancellationToken);
        return Ok(session is null ? new { authenticated = false } : await AccountPayloadAsync(session, cancellationToken));
    }

    private async Task<object> AccountPayloadAsync(AccountSession session, CancellationToken cancellationToken)
    {
        var effective = await access.AccessAsync(HttpContext, cancellationToken);
        var profile = await profiles.GetAsync(session.UserId, cancellationToken);
        var usage = await profiles.UsageAsync(session.UserId, cancellationToken);
        return new
        {
            authenticated = true,
            id = session.UserId,
            email = session.Email,
            displayName = session.DisplayName,
            avatarUrl = session.AvatarUrl,
            csrfToken = session.CsrfToken,
            sessionExpiresAt = session.ExpiresAt,
            role = effective.Role,
            plan = effective.Plan,
            planSource = effective.PlanSource,
            capabilities = effective.Features,
            limits = effective.Limits,
            subscription = effective.Subscription is { } current
                ? new
                {
                    plan = current.Plan,
                    status = current.Status,
                    provider = current.Provider,
                    currentPeriodEnd = current.CurrentPeriodEnd,
                    cancelAtPeriodEnd = current.CancelAtPeriodEnd,
                    active = EntitlementResolver.Counts(current, DateTimeOffset.UtcNow),
                }
                : null,
            profile = new
            {
                fullName = profile.FullName,
                stateCode = profile.StateCode,
                municipalityIbgeCode = profile.MunicipalityIbgeCode,
                municipalityName = profile.MunicipalityName,
                usageType = profile.UsageType,
                avatarHidden = profile.AvatarHidden,
            },
            usage,
        };
    }

    [HttpGet("account/profile")]
    [RequiresSession]
    public async Task<IActionResult> Profile(CancellationToken cancellationToken)
    {
        var session = await RequiredSession(cancellationToken);
        return Ok(await profiles.GetAsync(session.UserId, cancellationToken));
    }

    [HttpPost("account/profile")]
    [RequiresSession]
    public async Task<IActionResult> UpdateProfile([FromBody] ProfileUpdate request, CancellationToken cancellationToken)
    {
        var session = await RequiredSession(cancellationToken);
        try { return Ok(await profiles.UpdateAsync(session.UserId, request, cancellationToken)); }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("auth/logout")]
    [RequiresSession]
    public async Task<IActionResult> Logout(CancellationToken cancellationToken)
    {
        var session = await RequiredSession(cancellationToken);
        if (Request.Cookies.TryGetValue(SessionCookie, out var token)) await accounts.RevokeSessionAsync(token, cancellationToken);
        Response.Cookies.Delete(SessionCookie, SessionCookieOptions());
        return NoContent();
    }

    [HttpGet("account/saved")]
    [RequiresSession]
    public async Task<IActionResult> Saved([FromQuery] string collection = "favorite", CancellationToken cancellationToken = default)
    {
        var session = await RequiredSession(cancellationToken);
        try { return Ok(await accounts.GetSavedItemsAsync(session.UserId, collection, cancellationToken)); }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("account/saved")]
    [RequiresSession]
    public async Task<IActionResult> Save([FromBody] SaveItemRequest request, CancellationToken cancellationToken)
    {
        var session = await RequiredSession(cancellationToken);
        var effective = await access.AccessAsync(HttpContext, cancellationToken);
        var limit = effective.Limit(request.Collection == "watchlist" ? PlanCatalog.WatchlistLimit : PlanCatalog.FavoritesLimit);
        try
        {
            return Ok(await accounts.SaveItemAsync(session.UserId, request.Collection, request.ResourceType, request.ResourceKey, request.Label, request.Href, request.Metadata, limit, cancellationToken));
        }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
        catch (PlanLimitReachedException ex) { return PlanResults.LimitReached(ex.Limit, ex.Max); }
    }

    /// <summary>Move um item salvo para uma pasta (pasta vazia tira da pasta). Recurso do plano Profissional.</summary>
    [HttpPost("account/saved/folder")]
    [RequiresCapability(PlanCatalog.SavedFolders)]
    public async Task<IActionResult> MoveSaved([FromBody] MoveSavedRequest request, CancellationToken cancellationToken)
    {
        var session = await CurrentSession(cancellationToken);
        try
        {
            var item = await accounts.SetSavedItemFolderAsync(session!.UserId, request.Collection, request.ResourceType, request.ResourceKey, request.Folder, cancellationToken);
            return item is null ? NotFound() : Ok(item);
        }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpDelete("account/saved")]
    [RequiresSession]
    public async Task<IActionResult> RemoveSaved([FromQuery] string collection, [FromQuery] string resourceType, [FromQuery] string resourceKey, CancellationToken cancellationToken)
    {
        var session = await RequiredSession(cancellationToken);
        try
        {
            await accounts.RemoveSavedItemAsync(session.UserId, collection, resourceType, resourceKey, cancellationToken);
            return NoContent();
        }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpGet("account/alerts")]
    [RequiresSession]
    public async Task<IActionResult> Alerts(CancellationToken cancellationToken)
    {
        var session = await RequiredSession(cancellationToken);
        return Ok(await accounts.GetAlertsAsync(session.UserId, cancellationToken));
    }

    /// <summary>Tipos de alerta que o sistema dispara de verdade (cada um tem um produtor de edições oficiais).</summary>
    [HttpGet("account/alert-kinds")]
    public IActionResult AlertKinds() => Ok(AlertCatalog.Kinds);

    [HttpPost("account/alerts")]
    [RequiresSession]
    public async Task<IActionResult> UpsertAlert([FromBody] AlertRequest request, CancellationToken cancellationToken)
    {
        var session = await RequiredSession(cancellationToken);
        var limit = (await access.AccessAsync(HttpContext, cancellationToken)).Limit(PlanCatalog.AlertsLimit);
        try { return Ok(await accounts.UpsertAlertAsync(session.UserId, request.ResourceType, request.ResourceKey, request.EventKind, request.Delivery, request.Enabled, limit, cancellationToken)); }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
        catch (PlanLimitReachedException ex) { return PlanResults.LimitReached(ex.Limit, ex.Max); }
    }

    [HttpDelete("account/alerts/{id:guid}")]
    [RequiresSession]
    public async Task<IActionResult> DeleteAlert(Guid id, CancellationToken cancellationToken)
    {
        var session = await RequiredSession(cancellationToken);
        await accounts.DeleteAlertAsync(session.UserId, id, cancellationToken);
        return NoContent();
    }

    [HttpGet("account/notifications")]
    [RequiresSession]
    public async Task<IActionResult> Notifications(CancellationToken cancellationToken)
    {
        var session = await RequiredSession(cancellationToken);
        return Ok(await accounts.GetNotificationsAsync(session.UserId, cancellationToken));
    }

    [HttpPost("account/notifications/{id:guid}/read")]
    [RequiresSession]
    public async Task<IActionResult> ReadNotification(Guid id, CancellationToken cancellationToken)
    {
        var session = await RequiredSession(cancellationToken);
        await accounts.MarkNotificationReadAsync(session.UserId, id, cancellationToken);
        return NoContent();
    }

    [HttpPost("account/notifications/read-all")]
    [RequiresSession]
    public async Task<IActionResult> ReadAllNotifications(CancellationToken cancellationToken)
    {
        var session = await RequiredSession(cancellationToken);
        await accounts.MarkAllNotificationsReadAsync(session.UserId, cancellationToken);
        return NoContent();
    }

    [HttpGet("account/entitlements")]
    [RequiresSession]
    public async Task<IActionResult> Entitlements(CancellationToken cancellationToken)
    {
        var session = await RequiredSession(cancellationToken);
        return Ok(await accounts.GetEntitlementsAsync(session.UserId, cancellationToken));
    }

    [HttpGet("account/api-keys")]
    [RequiresSession]
    public async Task<IActionResult> ApiKeys(CancellationToken cancellationToken)
    {
        var session = await RequiredSession(cancellationToken);
        return Ok(await accounts.GetApiKeysAsync(session.UserId, cancellationToken));
    }

    [HttpPost("account/api-keys")]
    [RequiresSession]
    public async Task<IActionResult> CreateApiKey([FromBody] CreateApiKeyRequest request, CancellationToken cancellationToken)
    {
        var session = await RequiredSession(cancellationToken);
        try { return Ok(await accounts.CreateApiKeyAsync(session.UserId, request.Name, request.Scopes, cancellationToken)); }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpDelete("account/api-keys/{id:guid}")]
    [RequiresSession]
    public async Task<IActionResult> RevokeApiKey(Guid id, CancellationToken cancellationToken)
    {
        var session = await RequiredSession(cancellationToken);
        await accounts.RevokeApiKeyAsync(session.UserId, id, cancellationToken);
        return NoContent();
    }

    [HttpPost("internal/alerts/publish")]
    [HeaderCredential("X-Alerts-Token", "Token interno de publicação de alertas (rotina auditável)")]
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

    private Task<AccountSession?> CurrentSession(CancellationToken cancellationToken) => access.SessionAsync(HttpContext, cancellationToken);

    /// <summary>Sessão de uma rota com <see cref="RequiresSessionAttribute"/> (o filtro já recusou quem não tem).</summary>
    private async Task<AccountSession> RequiredSession(CancellationToken cancellationToken) =>
        await CurrentSession(cancellationToken) ?? throw new InvalidOperationException("Rota sem [RequiresSession].");

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

    private CookieOptions GoogleCorrelationCookieOptions() => new()
    {
        HttpOnly = true,
        Secure = !HttpContext.RequestServices.GetRequiredService<IWebHostEnvironment>().IsDevelopment(),
        SameSite = SameSiteMode.Lax,
        Path = "/api/v1/auth/google",
        IsEssential = true
    };

    private CookieOptions MagicLinkCorrelationCookieOptions() => new()
    {
        HttpOnly = true,
        Secure = !HttpContext.RequestServices.GetRequiredService<IWebHostEnvironment>().IsDevelopment(),
        SameSite = SameSiteMode.Lax,
        Path = "/api/v1/auth/magic-link",
        IsEssential = true
    };

    private static SameSiteMode ParseSameSite(string? configured) =>
        string.Equals(configured, "None", StringComparison.OrdinalIgnoreCase) ? SameSiteMode.None :
        string.Equals(configured, "Strict", StringComparison.OrdinalIgnoreCase) ? SameSiteMode.Strict :
        SameSiteMode.Lax;

    public sealed record MagicLinkRequest(string Email, string? ReturnTo);
    public sealed record SaveItemRequest(string Collection, string ResourceType, string ResourceKey, string? Label, string? Href, JsonElement? Metadata);
    public sealed record MoveSavedRequest(string Collection, string ResourceType, string ResourceKey, string? Folder);
    public sealed record AlertRequest(string ResourceType, string ResourceKey, string EventKind, string Delivery = "in_app", bool Enabled = true);
    public sealed record CreateApiKeyRequest(string Name, string[]? Scopes);
    public sealed record PublishAlertRequest(string EventKey, string ResourceType, string ResourceKey, string EventKind, string Title, string? Body, string? Href, JsonElement? Payload);
}
