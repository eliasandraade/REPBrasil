using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;
using RepBrasil.API.Infrastructure;
using RepBrasil.Application.DataIntelligence;

namespace RepBrasil.API.Controllers;

[ApiController]
[Route("api/v1/data")]
public sealed class DataController(DataIntelligenceService service) : ControllerBase
{
    [HttpGet("indicators")]
    [OutputCache(PolicyName = CachePolicies.PublicData)]
    public async Task<ActionResult<IReadOnlyList<IndicatorDto>>> Indicators(CancellationToken ct) =>
        Ok(await service.CatalogAsync(ct));

    [HttpGet("values")]
    [OutputCache(PolicyName = CachePolicies.PublicData)]
    public async Task<ActionResult<IReadOnlyList<IndicatorValueDto>>> Values(
        [FromQuery] string indicator,
        [FromQuery] int? period,
        [FromQuery] string? uf,
        CancellationToken ct)
    {
        try { return Ok(await service.ValuesAsync(indicator, period, uf, ct)); }
        catch (ArgumentException e) { return BadRequest(new { message = e.Message }); }
    }

    [HttpGet("correlation")]
    [OutputCache(PolicyName = CachePolicies.PublicData)]
    public async Task<ActionResult<CorrelationResponse>> Correlation(
        [FromQuery] string xIndicator,
        [FromQuery] string? yIndicator,
        [FromQuery] int period,
        [FromQuery] string? uf,
        [FromQuery] Guid? candidacyId,
        [FromQuery] int? year,
        [FromQuery] int? round,
        [FromQuery] int? office,
        CancellationToken ct)
    {
        try
        {
            return Ok(await service.CorrelationAsync(xIndicator, yIndicator, period, uf, candidacyId, year, round, office, ct));
        }
        catch (ArgumentException e) { return BadRequest(new { message = e.Message }); }
    }

    [HttpGet("clusters")]
    [OutputCache(PolicyName = CachePolicies.PublicData)]
    public async Task<ActionResult<ClusterResponse>> Clusters(
        [FromQuery] string indicator,
        [FromQuery] int period,
        [FromQuery] string? uf,
        [FromQuery] int k = 3,
        CancellationToken ct = default)
    {
        try { return Ok(await service.ClustersAsync(indicator, period, uf, k, ct)); }
        catch (ArgumentException e) { return BadRequest(new { message = e.Message }); }
    }
}
