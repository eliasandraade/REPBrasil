using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.OpenApi;
using RepBrasil.API.Accounts;
using RepBrasil.API.Infrastructure;
using Swashbuckle.AspNetCore.Swagger;

namespace RepBrasil.API.Controllers;

/// <summary>
/// Administração (Super Admin). Toda rota passa por <see cref="SuperAdminAttribute"/>: 401 sem sessão (ou sem CSRF
/// em escrita), 403 para conta comum. Mutações usam POST/DELETE (o CORS do site não libera outros métodos) e gravam
/// auditoria na mesma transação. Nenhuma resposta leva segredo.
/// </summary>
[ApiController]
[Route("api/v1/admin")]
[SuperAdmin]
[Tags("Administração")]
public sealed class AdminController(
    AccountAccessService access,
    AdminService admin,
    AdminDiagnosticsService diagnostics,
    SupportService support,
    ISwaggerProvider swagger,
    RequestMetrics metrics) : ControllerBase
{
    /// <summary>Identidade do Super Admin da sessão.</summary>
    [HttpGet("me")]
    public async Task<IActionResult> Me(CancellationToken ct)
    {
        var session = (await access.SessionAsync(HttpContext, ct))!;
        return Ok(new { id = session.UserId, email = session.Email, role = EntitlementResolver.SuperadminRole });
    }

    /// <summary>Diagnóstico: componentes, frescor dos dados, ingestões, contas, assinaturas, alertas, suporte e HTTP.</summary>
    [HttpGet("overview")]
    public async Task<ActionResult<AdminOverview>> Overview(CancellationToken ct) => Ok(await diagnostics.OverviewAsync(ct));

    /// <summary>Contas com busca (e-mail ou nome), filtros de plano, papel e status, ordenação e paginação.</summary>
    [HttpGet("users")]
    public async Task<ActionResult<AdminUserPage>> Users(
        [FromQuery] string? q, [FromQuery] string? plan, [FromQuery] string? role, [FromQuery] string? status,
        [FromQuery] string? sort, [FromQuery] string? dir, [FromQuery] int page = 1, [FromQuery] int pageSize = 25, CancellationToken ct = default) =>
        Ok(await admin.ListUsersAsync(new AdminUserQuery(q, plan, role, status, sort, dir, page, pageSize), ct));

    /// <summary>Detalhe da conta: perfil, acesso efetivo, concessões, assinaturas, uso e histórico administrativo.</summary>
    [HttpGet("users/{id:guid}")]
    public Task<IActionResult> UserDetail(Guid id, CancellationToken ct) => Run(() => admin.GetUserAsync(id, ct));

    /// <summary>Suspende a conta (encerra as sessões e recusa novos logins). Não vale para a própria conta nem para o último Super Admin.</summary>
    [HttpPost("users/{id:guid}/suspend")]
    public async Task<IActionResult> Suspend(Guid id, [FromBody] SuspendRequest request, CancellationToken ct) =>
        await Run(async () => await admin.SuspendAsync(await Actor(ct), id, request.Reason, ct));

    /// <summary>Reativa uma conta suspensa.</summary>
    [HttpPost("users/{id:guid}/reactivate")]
    public async Task<IActionResult> Reactivate(Guid id, CancellationToken ct) =>
        await Run(async () => await admin.ReactivateAsync(await Actor(ct), id, ct));

    /// <summary>Define o papel (<c>user</c> ou <c>superadmin</c>). Super Admin da configuração não muda por aqui.</summary>
    [HttpPost("users/{id:guid}/role")]
    public async Task<IActionResult> Role(Guid id, [FromBody] RoleRequest request, CancellationToken ct) =>
        await Run(async () => await admin.SetRoleAsync(await Actor(ct), id, request.Role, ct));

    /// <summary>Plano manual (concessão) com validade opcional; <c>FREE</c> remove a concessão.</summary>
    [HttpPost("users/{id:guid}/plan")]
    public async Task<IActionResult> Plan(Guid id, [FromBody] PlanRequest request, CancellationToken ct) =>
        await Run(async () => await admin.SetPlanAsync(await Actor(ct), id, request.Plan, request.ExpiresAt, ct));

    /// <summary>Concede uma capability do catálogo (ou a quota legada <c>api.daily_quota</c>) com validade opcional.</summary>
    [HttpPost("users/{id:guid}/entitlements")]
    public async Task<IActionResult> Grant(Guid id, [FromBody] GrantRequest request, CancellationToken ct) =>
        await Run(async () => await admin.GrantAsync(await Actor(ct), id, request.Key, request.Value, request.ExpiresAt, ct));

    /// <summary>Revoga uma concessão (expira agora; o histórico fica).</summary>
    [HttpDelete("users/{id:guid}/entitlements/{key}")]
    public async Task<IActionResult> Revoke(Guid id, string key, CancellationToken ct) =>
        await Run(async () => await admin.RevokeAsync(await Actor(ct), id, key, ct));

    /// <summary>Cria ou corrige a assinatura manual da conta (plano, status, fim do período, observação).</summary>
    [HttpPost("users/{id:guid}/subscription")]
    public async Task<IActionResult> Subscription(Guid id, [FromBody] SubscriptionRequest request, CancellationToken ct) =>
        await Run(async () => await admin.UpsertSubscriptionAsync(await Actor(ct), id, request.Plan, request.Status, request.CurrentPeriodEnd, request.Notes, ct));

    /// <summary>Assinaturas, filtráveis por status.</summary>
    [HttpGet("subscriptions")]
    public async Task<ActionResult<IReadOnlyList<AdminSubscriptionRow>>> Subscriptions([FromQuery] string? status, CancellationToken ct) =>
        Ok(await admin.ListSubscriptionsAsync(status, ct));

    /// <summary>Trilha de auditoria administrativa (só inserção), filtrável por ação e conta-alvo.</summary>
    [HttpGet("audit")]
    public async Task<IActionResult> Audit([FromQuery] string? action, [FromQuery] Guid? target, [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
    {
        var (items, total) = await admin.ListAuditAsync(action, target, page, pageSize, ct);
        return Ok(new { items, total, page = Math.Max(1, page), pageSize = Math.Clamp(pageSize, 1, 100) });
    }

    /// <summary>Pedidos de suporte, filtráveis por status.</summary>
    [HttpGet("support")]
    public async Task<ActionResult<IReadOnlyList<SupportRequestRow>>> Support([FromQuery] string? status, CancellationToken ct) =>
        Ok(await support.ListAsync(status, ct));

    /// <summary>Muda o status de um pedido de suporte (auditado).</summary>
    [HttpPost("support/{id:guid}/status")]
    public async Task<IActionResult> SupportStatus(Guid id, [FromBody] SupportStatusRequest request, CancellationToken ct)
    {
        try
        {
            var row = await support.SetStatusAsync(await Actor(ct), id, request.Status, ct);
            return row is null ? NotFound() : Ok(row);
        }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
    }

    /// <summary>
    /// Catálogo da API: o documento OpenAPI gerado do próprio código (rotas, parâmetros, corpos, respostas e a regra de
    /// acesso de cada uma em <c>x-repbrasil-access</c>) e as métricas por rota desde o início do processo.
    /// </summary>
    [HttpGet("openapi")]
    public async Task<IActionResult> OpenApi(CancellationToken ct)
    {
        var document = swagger.GetSwagger("v1");
        var json = await document.SerializeAsJsonAsync(OpenApiSpecVersion.OpenApi3_0, ct);
        Response.Headers.CacheControl = "no-store";
        return Ok(new
        {
            generatedAt = DateTimeOffset.UtcNow,
            metricsSince = metrics.StartedAt,
            document = System.Text.Json.JsonDocument.Parse(json).RootElement,
            metrics = metrics.Snapshot(),
        });
    }

    private async Task<AdminActor> Actor(CancellationToken ct)
    {
        var session = (await access.SessionAsync(HttpContext, ct))!;
        var route = (ControllerContext.ActionDescriptor as ControllerActionDescriptor)?.AttributeRouteInfo?.Template ?? Request.Path.Value ?? "";
        return new(session.UserId, session.Email, route);
    }

    private async Task<IActionResult> Run<T>(Func<Task<T>> action)
    {
        try
        {
            return Ok(await action());
        }
        catch (AdminNotFoundException) { return NotFound(new { error = "not_found" }); }
        catch (AdminConflictException ex) { return Conflict(new { error = ex.Code, message = ex.Message }); }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
    }

    public sealed record SuspendRequest(string? Reason);
    public sealed record RoleRequest(string Role);
    public sealed record PlanRequest(string Plan, DateTimeOffset? ExpiresAt);
    public sealed record GrantRequest(string Key, string Value, DateTimeOffset? ExpiresAt);
    public sealed record SubscriptionRequest(string Plan, string Status, DateTimeOffset? CurrentPeriodEnd, string? Notes);
    public sealed record SupportStatusRequest(string Status);
}
