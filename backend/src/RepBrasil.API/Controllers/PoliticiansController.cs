using Microsoft.AspNetCore.Mvc;
using RepBrasil.Application.Common;
using RepBrasil.Application.Politicians.DTOs;
using RepBrasil.Application.Politicians.Queries;

namespace RepBrasil.API.Controllers;

[ApiController]
[Route("api/v1/politicians")]
public class PoliticiansController(
    SearchPoliticiansQuery searchQuery,
    GetPoliticianByIdQuery getByIdQuery) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(PagedResult<PoliticianSummaryDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> Search(
        [FromQuery] string? q,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken ct = default)
    {
        var result = await searchQuery.ExecuteAsync(q, page, pageSize, ct);
        return Ok(result);
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(PoliticianDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct = default)
    {
        var result = await getByIdQuery.ExecuteAsync(id, ct);
        if (result is null)
            return NotFound(new { message = $"Político {id} não encontrado." });
        return Ok(result);
    }
}
