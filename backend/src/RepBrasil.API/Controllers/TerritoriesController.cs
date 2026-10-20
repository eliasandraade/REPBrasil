using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;
using RepBrasil.API.Infrastructure;
using RepBrasil.Application.Territories;

namespace RepBrasil.API.Controllers;

/// <summary>
/// Catálogo territorial (IBGE), independente de eleição: as UFs e os municípios de cada UF. Serve a escolha de
/// território; não indica que existe dado carregado para ele.
///
///   GET /api/v1/territories/states
///   GET /api/v1/territories/states/{uf}/municipalities
/// </summary>
[ApiController]
[Route("api/v1/territories")]
[OutputCache(PolicyName = CachePolicies.PublicData)]
public sealed class TerritoriesController(TerritoryCatalogService catalog) : ControllerBase
{
    [HttpGet("states")]
    public async Task<ActionResult<IReadOnlyList<TerritoryStateDto>>> States(CancellationToken ct) =>
        Ok(await catalog.StatesAsync(ct));

    [HttpGet("states/{uf}/municipalities")]
    public async Task<ActionResult<IReadOnlyList<TerritoryMunicipalityDto>>> Municipalities(string uf, CancellationToken ct)
    {
        try { return Ok(await catalog.MunicipalitiesAsync(uf, ct)); }
        catch (ArgumentException e) { return BadRequest(new { message = e.Message }); }
    }
}
