using Microsoft.AspNetCore.Mvc;
using RepBrasil.Application.Overview;

namespace RepBrasil.API.Controllers;

/// <summary>O que a plataforma cobre hoje: pleitos importados por UF e as bases oficiais usadas.</summary>
[ApiController]
[Route("api/v1/overview")]
public class OverviewController(OverviewService overview) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(OverviewResponse), StatusCodes.Status200OK)]
    public async Task<IActionResult> Get(CancellationToken ct) => Ok(await overview.GetAsync(ct));
}
