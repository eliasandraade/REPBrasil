using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;
using Microsoft.AspNetCore.RateLimiting;
using RepBrasil.API.Accounts;
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

    /// <summary>O que está carregado em cada UF: indicadores por período, pleitos com resultado e anos de emendas.</summary>
    [HttpGet("coverage")]
    [OutputCache(PolicyName = CachePolicies.PublicData)]
    public async Task<ActionResult<DataCoverageResponse>> Coverage(CancellationToken ct) =>
        Ok(await service.CoverageAsync(ct));

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

    /// <summary>Todos os pares de indicadores carregados na UF de uma vez. Cada par continua aberto em <c>/correlation</c>.</summary>
    [HttpGet("correlation-matrix")]
    [RequiresCapability(PlanCatalog.CorrelationMatrix)]
    [OutputCache(NoStore = true)]
    [EnableRateLimiting(ApiRateLimits.Heavy)]
    public async Task<ActionResult<CorrelationMatrixResponse>> CorrelationMatrix(
        [FromQuery] string? uf,
        [FromQuery] int period,
        CancellationToken ct)
    {
        Response.Headers.CacheControl = "private, no-store";
        try { return Ok(await service.CorrelationMatrixAsync(uf, period, ct)); }
        catch (ArgumentException e) { return BadRequest(new { message = e.Message }); }
    }

    /// <summary>CSV do recorte do mapa (um indicador numa UF), com fonte, conjunto e data de coleta em cada linha.</summary>
    [HttpGet("export")]
    [RequiresCapability(PlanCatalog.ExportCsv)]
    [OutputCache(NoStore = true)]
    [ProducesResponseType(typeof(string), StatusCodes.Status200OK, "text/csv")]
    public async Task<IActionResult> Export(
        [FromQuery] string indicator,
        [FromQuery] int? period,
        [FromQuery] string? uf,
        CancellationToken ct)
    {
        Response.Headers.CacheControl = "private, no-store";
        try
        {
            var rows = await service.ExportAsync(indicator, period, uf, ct);
            return File(IndicatorCsv.Write(rows), IndicatorCsv.ContentType, IndicatorCsv.FileName(indicator, uf, period));
        }
        catch (ArgumentException e) { return BadRequest(new { message = e.Message }); }
    }

    /// <summary>CSV com todos os indicadores carregados da UF (e período, se informado), com proveniência por linha.</summary>
    [HttpGet("export/bulk")]
    [RequiresCapability(PlanCatalog.ExportBulk)]
    [OutputCache(NoStore = true)]
    [EnableRateLimiting(ApiRateLimits.Heavy)]
    [ProducesResponseType(typeof(string), StatusCodes.Status200OK, "text/csv")]
    public async Task<IActionResult> BulkExport([FromQuery] string? uf, [FromQuery] int? period, CancellationToken ct)
    {
        Response.Headers.CacheControl = "private, no-store";
        try
        {
            var rows = await service.BulkExportAsync(uf, period, ct);
            return File(IndicatorCsv.Write(rows), IndicatorCsv.ContentType, IndicatorCsv.FileName("indicadores", uf, period));
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
