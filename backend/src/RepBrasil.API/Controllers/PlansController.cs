using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;
using RepBrasil.API.Accounts;
using RepBrasil.API.Infrastructure;

namespace RepBrasil.API.Controllers;

/// <summary>
/// Catálogo público de planos e entrada da cobrança.
///
///   GET  /api/v1/plans              catálogo (planos, capabilities, limites, base pública, disponibilidade do pagamento)
///   POST /api/v1/billing/checkout   abre o pagamento no provedor; sem provedor, 503 billing_unavailable
/// </summary>
[ApiController]
[Route("api/v1")]
public sealed class PlansController(IBillingProvider billing, AccountAccessService access) : ControllerBase
{
    private const string BillingUnavailableMessage = "Pagamento online ainda não disponível.";

    [HttpGet("plans")]
    [OutputCache(PolicyName = CachePolicies.PublicData)]
    public IActionResult Plans() => Ok(new
    {
        currency = "BRL",
        interval = "month",
        billing = new { available = billing.Available, message = billing.Available ? null : BillingUnavailableMessage },
        baseline = PlanCatalog.PublicBaseline,
        capabilities = PlanCatalog.Capabilities,
        plans = PlanCatalog.Plans.OrderBy(plan => plan.Rank),
    });

    [HttpPost("billing/checkout")]
    [RequiresSession]
    public async Task<IActionResult> Checkout([FromBody] CheckoutRequest request, CancellationToken cancellationToken)
    {
        if (!PlanCatalog.IsPaidPlan(request.Plan)) return BadRequest(new { error = "Plano inválido." });
        var session = await access.SessionAsync(HttpContext, cancellationToken);
        try
        {
            var checkout = await billing.StartCheckoutAsync(session!.UserId, session.Email, request.Plan, cancellationToken);
            return Ok(new { redirectUrl = checkout.RedirectUrl });
        }
        catch (BillingUnavailableException)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = "billing_unavailable", message = BillingUnavailableMessage });
        }
    }

    public sealed record CheckoutRequest(string Plan);
}
