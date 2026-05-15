using Microsoft.AspNetCore.Mvc;

namespace RepBrasil.API.Controllers;

[ApiController]
public class HealthController : ControllerBase
{
    [HttpGet("/health")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public IActionResult Health() => Ok();

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
