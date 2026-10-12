using Microsoft.AspNetCore.Mvc;
using RepBrasil.API.Infrastructure;

namespace RepBrasil.API.Controllers;

[ApiController]
[Route("api/v1/commercial")]
public sealed class CommercialApiController(AccountService accounts) : ControllerBase
{
    [HttpGet("ping")]
    public async Task<IActionResult> Ping(CancellationToken cancellationToken)
    {
        var secret = Request.Headers["X-Api-Key"].ToString();
        if (!await accounts.ValidateApiKeyAndConsumeAsync(secret, "read:public", cancellationToken))
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
