using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;
using Microsoft.AspNetCore.RateLimiting;
using RepBrasil.API.Accounts;
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

    /// <summary>Total de atos do mesmo recorte de <c>/activities</c>, que é limitado.</summary>
    [HttpGet("activities/count")]
    [OutputCache(PolicyName = CachePolicies.PublicData)]
    public async Task<ActionResult<ParliamentActivityTotalDto>> ActivityTotal(
        [FromQuery] long? memberId,
        [FromQuery] string? institution,
        [FromQuery] string? uf,
        CancellationToken ct)
    {
        try { return Ok(await service.ActivityTotalAsync(memberId, institution, uf, ct)); }
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

    /// <summary>Anos com emenda na edição vigente do recorte, independente do limite de <c>/amendments</c>.</summary>
    [HttpGet("amendments/years")]
    [OutputCache(PolicyName = CachePolicies.PublicData)]
    public async Task<ActionResult<IReadOnlyList<int>>> AmendmentYears([FromQuery] string? uf, CancellationToken ct)
    {
        try { return Ok(await service.AmendmentYearsAsync(uf, ct)); }
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

    /// <summary>O mapa de emendas da UF ano a ano numa consulta (linha do tempo). Cada ano continua aberto em <c>/amendments/map</c>.</summary>
    [HttpGet("amendments/map-series")]
    [RequiresCapability(PlanCatalog.MapSeries)]
    [OutputCache(NoStore = true)]
    [EnableRateLimiting(ApiRateLimits.Heavy)]
    public async Task<ActionResult<AmendmentMapSeriesResponse>> AmendmentMapSeries([FromQuery] string? uf, CancellationToken ct)
    {
        Response.Headers.CacheControl = "private, no-store";
        try { return Ok(await service.AmendmentMapSeriesAsync(uf, ct)); }
        catch (ArgumentException e) { return BadRequest(new { message = e.Message }); }
    }
}
