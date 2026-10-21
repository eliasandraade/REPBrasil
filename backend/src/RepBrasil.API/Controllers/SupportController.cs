using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using RepBrasil.API.Accounts;
using RepBrasil.API.Infrastructure;

namespace RepBrasil.API.Controllers;

/// <summary>
/// Pedidos de suporte enviados pela página <c>/suporte</c>: gravados e lidos na caixa do Super Admin. Público,
/// com limite técnico por origem; com sessão, o pedido fica ligado à conta.
///
///   POST /api/v1/support/requests
/// </summary>
[ApiController]
[Route("api/v1/support")]
[Tags("Suporte")]
public sealed class SupportController(SupportService support, AccountAccessService access) : ControllerBase
{
    /// <summary>Registra um pedido (dúvida, contestação, correção de dado, institucional, erro técnico ou conta).</summary>
    [HttpPost("requests")]
    [EnableRateLimiting(ApiRateLimits.Support)]
    public async Task<IActionResult> Create([FromBody] SupportRequestInput request, CancellationToken ct)
    {
        var session = await access.SessionAsync(HttpContext, ct);
        try
        {
            var id = await support.CreateAsync(request, session?.UserId, HttpContext.Connection.RemoteIpAddress?.ToString(), ct);
            return Accepted(new { status = "received", id });
        }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
    }
}
