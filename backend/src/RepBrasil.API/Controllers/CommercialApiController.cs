using Microsoft.AspNetCore.Mvc;
using RepBrasil.API.Infrastructure;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.API.Controllers;

[ApiController]
[Route("api/v1/commercial")]
public sealed class CommercialApiController(ApplicationDbContext db) : ControllerBase
{
    [HttpGet("ping")]
    public async Task<IActionResult> Ping(CancellationToken cancellationToken)
    {
        var secret = Request.Headers["X-Api-Key"].ToString();
        if (!await CommercialApiQuotaGate.ValidateAndConsumeAsync(db, secret, "read:public", cancellationToken))
            return StatusCode(StatusCodes.Status429TooManyRequests, new { error = "invalid_or_exhausted_api_key" });

        return Ok(new
        {
            status = "ok",
            apiVersion = "v1",
            semantics = new
            {
                missingIsNotZero = true,
                provenanceRequired = true,
                syntheticElectionFacts = false
            }
        });
    }
}
