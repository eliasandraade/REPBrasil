using Microsoft.AspNetCore.Mvc;
using RepBrasil.Application.Search;

namespace RepBrasil.API.Controllers;

/// <summary>Busca global: políticos, territórios, partidos e pleitos numa só consulta.</summary>
[ApiController]
[Route("api/v1/search")]
public class SearchController(SearchService search) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(SearchResponse), StatusCodes.Status200OK)]
    public async Task<IActionResult> Search([FromQuery] string? q, [FromQuery] int limit = 6, CancellationToken ct = default) =>
        Ok(await search.SearchAsync(q, limit, ct));
}
