using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;
using RepBrasil.API.Infrastructure;
using RepBrasil.Application.Parliament;

namespace RepBrasil.API.Controllers;

[ApiController]
[Route("api/v1/parliament")]
public sealed class ParliamentController(ParliamentService service) : ControllerBase
{
    [HttpGet("members")]
    [OutputCache(PolicyName = CachePolicies.PublicData)]
    public async Task<ActionResult<IReadOnlyList<ParliamentMemberDto>>> Members(
        [FromQuery] string? uf,
        [FromQuery] string? institution,
        CancellationToken ct)
    {
        try { return Ok(await service.MembersAsync(uf, institution, ct)); }
        catch (ArgumentException e) { return BadRequest(new { message = e.Message }); }
    }

    [HttpGet("activities")]
    [OutputCache(PolicyName = CachePolicies.PublicData)]
    public async Task<ActionResult<IReadOnlyList<ParliamentActivityDto>>> Activities(
        [FromQuery] long? memberId,
        [FromQuery] string? institution,
        [FromQuery] string? uf,
        [FromQuery] int limit = 100,
        CancellationToken ct = default)
    {
        try { return Ok(await service.ActivitiesAsync(memberId, institution, uf, limit, ct)); }
        catch (ArgumentException e) { return BadRequest(new { message = e.Message }); }
    }

    [HttpGet("amendments")]
    [OutputCache(PolicyName = CachePolicies.PublicData)]
    public async Task<ActionResult<IReadOnlyList<ParliamentAmendmentDto>>> Amendments(
        [FromQuery] int? year,
        [FromQuery] long? memberId,
        [FromQuery] string? uf,
        [FromQuery] int limit = 100,
        CancellationToken ct = default)
    {
        try { return Ok(await service.AmendmentsAsync(year, memberId, uf, limit, ct)); }
        catch (ArgumentException e) { return BadRequest(new { message = e.Message }); }
    }

    [HttpGet("amendments/map")]
    [OutputCache(PolicyName = CachePolicies.PublicData)]
    public async Task<ActionResult<IReadOnlyList<AmendmentMunicipalityDto>>> AmendmentMap(
        [FromQuery] string uf,
        [FromQuery] int? year,
        CancellationToken ct)
    {
        try { return Ok(await service.AmendmentMapAsync(year, uf, ct)); }
        catch (ArgumentException e) { return BadRequest(new { message = e.Message }); }
    }
}
