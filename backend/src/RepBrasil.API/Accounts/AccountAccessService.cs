using RepBrasil.API.Infrastructure;

namespace RepBrasil.API.Accounts;

/// <summary>
/// Sessão e acesso efetivo da requisição corrente, resolvidos uma vez por requisição (filtros e ações
/// compartilham o resultado). Anônimo resolve para o plano Gratuito; o servidor é a única autoridade.
/// </summary>
public sealed class AccountAccessService(AccountService accounts, IConfiguration configuration)
{
    public const string SessionCookie = "repbrasil_session";
    public const string CsrfHeader = "X-RepBrasil-CSRF";

    private static readonly object SessionItem = new();
    private static readonly object AccessItem = new();

    public async Task<AccountSession?> SessionAsync(HttpContext http, CancellationToken cancellationToken)
    {
        if (http.Items.TryGetValue(SessionItem, out var cached)) return cached as AccountSession;
        var session = http.Request.Cookies.TryGetValue(SessionCookie, out var token)
            ? await accounts.GetSessionAsync(token, cancellationToken)
            : null;
        http.Items[SessionItem] = session;
        return session;
    }

    /// <summary>Sessão válida e, se a requisição altera estado, com o token CSRF da própria sessão.</summary>
    public async Task<AccountSession?> AuthorizedSessionAsync(HttpContext http, CancellationToken cancellationToken)
    {
        var session = await SessionAsync(http, cancellationToken);
        if (session is null) return null;
        return IsSafeMethod(http.Request.Method) || CsrfMatches(http, session) ? session : null;
    }

    public async Task<EffectiveAccess> AccessAsync(HttpContext http, CancellationToken cancellationToken)
    {
        if (http.Items.TryGetValue(AccessItem, out var cached) && cached is EffectiveAccess known) return known;
        var session = await SessionAsync(http, cancellationToken);
        var access = session is null ? EntitlementResolver.Anonymous : await ResolveAsync(session.UserId, session.Email, cancellationToken);
        http.Items[AccessItem] = access;
        return access;
    }

    public async Task<EffectiveAccess> ResolveAsync(Guid userId, string email, CancellationToken cancellationToken)
    {
        var (subscriptions, entitlements) = await accounts.LoadAccessFactsAsync(userId, cancellationToken);
        return EntitlementResolver.Resolve(IsConfiguredSuperadmin(email), subscriptions, entitlements, DateTimeOffset.UtcNow);
    }

    /// <summary>Super Admin por configuração (<c>Auth:SuperadminEmails</c>): não é editável pela interface.</summary>
    public bool IsConfiguredSuperadmin(string email) =>
        (configuration["Auth:SuperadminEmails"] ?? string.Empty)
            .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Contains(email, StringComparer.OrdinalIgnoreCase);

    public static bool CsrfMatches(HttpContext http, AccountSession session) =>
        AccountService.SecureEquals(http.Request.Headers[CsrfHeader].ToString(), session.CsrfToken);

    private static bool IsSafeMethod(string method) => HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method);
}
