using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;
using RepBrasil.API.Infrastructure;
using RepBrasil.Application.ElectoralLive;

namespace RepBrasil.API.Controllers;

[ApiController]
[Route("api/v1/elections")]
public sealed class ElectoralLiveController(ElectoralLiveService service) : ControllerBase
{
    [HttpGet("polls")]
    [OutputCache(PolicyName = CachePolicies.PublicData)]
    public async Task<ActionResult<PollsResponse>> Polls(
        [FromQuery] int year,
        [FromQuery] int round,
        [FromQuery] int office,
        [FromQuery] string? uf,
        [FromQuery] string? municipalityTseCode,
        CancellationToken ct)
    {
        try { return Ok(await service.PollsAsync(year, round, office, uf, municipalityTseCode, ct)); }
        catch (ArgumentException e) { return BadRequest(new { message = e.Message }); }
    }

    [HttpGet("live")]
    [OutputCache(PolicyName = CachePolicies.LiveData)]
    public async Task<ActionResult<LiveCountResponse>> Live(
        [FromQuery] int year,
        [FromQuery] int round,
        [FromQuery] int office,
        [FromQuery] string? uf,
        [FromQuery] string? municipalityTseCode,
        CancellationToken ct)
    {
        try { return Ok(await service.LiveCountAsync(year, round, office, uf, municipalityTseCode, ct)); }
        catch (ArgumentException e) { return BadRequest(new { message = e.Message }); }
    }
}
