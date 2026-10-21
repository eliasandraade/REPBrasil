using Microsoft.AspNetCore.Mvc;
using RepBrasil.API.Accounts;
using RepBrasil.API.Infrastructure;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.API.Controllers;

[ApiController]
[Route("api/v1/commercial")]
public sealed class CommercialApiController(ApplicationDbContext db) : ControllerBase
{
    [HttpGet("ping")]
    [HeaderCredential("X-Api-Key", "Chave da API comercial (legado), escopo read:public")]
    public async Task<IActionResult> Ping(CancellationToken cancellationToken)
    {
        var secret = Request.Headers["X-Api-Key"].ToString();
        var access = await CommercialApiQuotaGate.ValidateAndConsumeAsync(db, secret, "read:public", cancellationToken);

        return access switch
        {
            CommercialApiAccess.Granted => Ok(new
            {
                status = "ok",
                apiVersion = "v1",
                semantics = new
                {
                    missingIsNotZero = true,
                    provenanceRequired = true,
                    syntheticElectionFacts = false
                }
            }),
            CommercialApiAccess.InsufficientScope => StatusCode(StatusCodes.Status403Forbidden, new { error = "insufficient_scope" }),
            CommercialApiAccess.QuotaExhausted => StatusCode(StatusCodes.Status429TooManyRequests, new { error = "daily_quota_exhausted" }),
            _ => StatusCode(StatusCodes.Status401Unauthorized, new { error = "invalid_api_key" }),
        };
    }
}
