using Microsoft.AspNetCore.Mvc;
using RepBrasil.Application.Common;
using RepBrasil.Application.ElectionResults.DTOs;
using RepBrasil.Application.ElectionResults.Queries;
using RepBrasil.Application.Politicians.DTOs;
using RepBrasil.Application.Politicians.Queries;

namespace RepBrasil.API.Controllers;

[ApiController]
[Route("api/v1/politicians")]
public class PoliticiansController(
    SearchPoliticiansQuery searchQuery,
    GetPoliticianByIdQuery getByIdQuery,
    GetPoliticianElectionsQuery getElectionsQuery) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(PagedResult<PoliticianSummaryDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> Search(
        [FromQuery] string? q,
        [FromQuery] string? state,
        [FromQuery] string? party,
        [FromQuery] string? office,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken ct = default)
    {
        var result = await searchQuery.ExecuteAsync(q, state, party, office, page, pageSize, ct);
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

    [HttpGet("{id:guid}/elections")]
    [ProducesResponseType(typeof(IReadOnlyList<ElectionResultDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetElections(Guid id, CancellationToken ct)
    {
        var politician = await getByIdQuery.ExecuteAsync(id, ct);
        if (politician is null)
            return NotFound();

        var results = await getElectionsQuery.ExecuteAsync(id, ct);
        return Ok(results);
    }
}
