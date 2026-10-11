using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.API.Controllers;

[ApiController]
public class HealthController : ControllerBase
{
    /// <summary>Vivo (o processo responde). Não toca no banco: serve para o orquestrador reiniciar só quando travar.</summary>
    [HttpGet("/health")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public IActionResult Health() => Ok();

    /// <summary>Pronto para atender: o banco responde em até 3 s. Sem detalhes internos na resposta.</summary>
    [HttpGet("/health/ready")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> Ready([FromServices] ApplicationDbContext db, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(3));
        bool ok;
        try
        {
            ok = await db.Database.CanConnectAsync(timeout.Token);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            ok = false;
        }
        return ok
            ? Ok(new { status = "ready" })
            : StatusCode(StatusCodes.Status503ServiceUnavailable, new { status = "unavailable" });
    }

    [HttpGet("/api/v1/status")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public IActionResult Status() => Ok(new
    {
        status = "ok",
        version = "0.1.0",
        environment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Production",
        timestamp = DateTimeOffset.UtcNow
    });
}
