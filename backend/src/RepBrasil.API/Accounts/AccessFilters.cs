using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace RepBrasil.API.Accounts;

/// <summary>
/// Exige sessão válida: 401 sem ela e, em requisição que altera estado, 401 sem o token CSRF da própria sessão.
/// Ação protegida nunca usa cache de saída compartilhado (o teste de contrato confere).
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class RequiresSessionAttribute : Attribute, IAsyncAuthorizationFilter
{
    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var http = context.HttpContext;
        var access = http.RequestServices.GetRequiredService<AccountAccessService>();
        if (await access.AuthorizedSessionAsync(http, http.RequestAborted) is null) context.Result = new UnauthorizedResult();
    }
}

/// <summary>
/// Exige um recurso do plano efetivo (<see cref="PlanCatalog"/>): 401 sem sessão (ou sem CSRF em escrita),
/// 403 <c>plan_required</c> sem o recurso. A decisão é do servidor; a interface só reflete.
/// </summary>
[AttributeUsage(AttributeTargets.Method, AllowMultiple = true)]
public sealed class RequiresCapabilityAttribute(string capability) : Attribute, IAsyncAuthorizationFilter
{
    public string Capability { get; } = capability;

    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var http = context.HttpContext;
        var access = http.RequestServices.GetRequiredService<AccountAccessService>();
        if (await access.AuthorizedSessionAsync(http, http.RequestAborted) is null)
        {
            context.Result = new UnauthorizedResult();
            return;
        }
        if (!(await access.AccessAsync(http, http.RequestAborted)).Has(Capability)) context.Result = PlanResults.Required(Capability);
    }
}

/// <summary>
/// Exige Super Admin (configuração <c>Auth:SuperadminEmails</c> ou entitlement <c>account.role = superadmin</c>), decidido
/// no servidor: 401 sem sessão (ou sem CSRF em escrita), 403 <c>forbidden</c> para conta comum.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class SuperAdminAttribute : Attribute, IAsyncAuthorizationFilter
{
    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var http = context.HttpContext;
        var access = http.RequestServices.GetRequiredService<AccountAccessService>();
        if (await access.AuthorizedSessionAsync(http, http.RequestAborted) is null)
        {
            context.Result = new UnauthorizedResult();
            return;
        }
        // Sem esquema de autenticação registrado, Forbid() lançaria (500); a recusa é um 403 explícito.
        if (!(await access.AccessAsync(http, http.RequestAborted)).IsSuperadmin)
            context.Result = new ObjectResult(new { error = "forbidden" }) { StatusCode = StatusCodes.Status403Forbidden };
    }
}

/// <summary>
/// Credencial fora da sessão (cabeçalho próprio), verificada dentro da ação. Só documenta a rota no catálogo da API;
/// a verificação continua no código da ação.
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class HeaderCredentialAttribute(string header, string description) : Attribute
{
    public string Header { get; } = header;
    public string Description { get; } = description;
}

/// <summary>Limite do plano atingido ao criar um item novo. Itens que já existem nunca são apagados.</summary>
public sealed class PlanLimitReachedException(string limit, int max)
    : InvalidOperationException($"Limite do plano atingido: {limit} = {max}.")
{
    public string Limit { get; } = limit;
    public int Max { get; } = max;
}

/// <summary>Corpos 403 de plano, com o menor plano que resolveria (a interface oferece, nunca decide).</summary>
public static class PlanResults
{
    public static ObjectResult Required(string capability)
    {
        var plan = PlanCatalog.MinimumPlanWith(capability);
        var label = PlanCatalog.Capability(capability).Label;
        return Forbidden(new
        {
            error = "plan_required",
            capability,
            requiredPlan = plan?.Code,
            message = plan is null
                ? $"{label} não está disponível na sua conta."
                : $"{label} faz parte do plano {plan.Name}.",
        });
    }

    public static ObjectResult LimitReached(string limit, int max)
    {
        var plan = PlanCatalog.MinimumPlanAbove(limit, max);
        var label = PlanCatalog.Capability(limit).Label;
        return Forbidden(new
        {
            error = "plan_limit_reached",
            limit,
            max,
            requiredPlan = plan?.Code,
            message = plan is null
                ? $"Você atingiu o limite de {max} em {label}."
                : $"Você atingiu o limite de {max} em {label}. O plano {plan.Name} permite {plan.Limits[limit]}.",
        });
    }

    private static ObjectResult Forbidden(object body) => new(body) { StatusCode = StatusCodes.Status403Forbidden };
}
