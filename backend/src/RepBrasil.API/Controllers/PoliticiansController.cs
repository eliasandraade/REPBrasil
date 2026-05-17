using Microsoft.AspNetCore.Mvc;
using RepBrasil.Application.Assets.DTOs;
using RepBrasil.Application.Assets.Queries;
using RepBrasil.Application.Common;
using RepBrasil.Application.ElectionResults.DTOs;
using RepBrasil.Application.ElectionResults.Queries;
using RepBrasil.Application.Politicians.DTOs;
using RepBrasil.Application.Politicians.Queries;
using RepBrasil.Application.Score.DTOs;
using RepBrasil.Application.Score.Queries;
using RepBrasil.Application.Sources.DTOs;
using RepBrasil.Application.Sources.Queries;

namespace RepBrasil.API.Controllers;

[ApiController]
[Route("api/v1/politicians")]
public class PoliticiansController : ControllerBase
{
    private readonly SearchPoliticiansQuery _searchQuery;
    private readonly GetPoliticianByIdQuery _getByIdQuery;
    private readonly GetPoliticianElectionsQuery _getElectionsQuery;
    private readonly GetPoliticianAssetsQuery _getAssetsQuery;
    private readonly GetPoliticianSourcesQuery _getSourcesQuery;
    private readonly GetPoliticianScoreQuery _getScoreQuery;
    private readonly GetPoliticianScoreHistoryQuery _getScoreHistoryQuery;

    public PoliticiansController(
        SearchPoliticiansQuery searchQuery,
        GetPoliticianByIdQuery getByIdQuery,
        GetPoliticianElectionsQuery getElectionsQuery,
        GetPoliticianAssetsQuery getAssetsQuery,
        GetPoliticianSourcesQuery getSourcesQuery,
        GetPoliticianScoreQuery getScoreQuery,
        GetPoliticianScoreHistoryQuery getScoreHistoryQuery)
    {
        _searchQuery = searchQuery;
        _getByIdQuery = getByIdQuery;
        _getElectionsQuery = getElectionsQuery;
        _getAssetsQuery = getAssetsQuery;
        _getSourcesQuery = getSourcesQuery;
        _getScoreQuery = getScoreQuery;
        _getScoreHistoryQuery = getScoreHistoryQuery;
    }

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
        var result = await _searchQuery.ExecuteAsync(q, state, party, office, page, pageSize, ct);
        return Ok(result);
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(PoliticianDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct = default)
    {
        var result = await _getByIdQuery.ExecuteAsync(id, ct);
        if (result is null)
            return NotFound(new { message = $"Político {id} não encontrado." });
        return Ok(result);
    }

    [HttpGet("{id:guid}/elections")]
    [ProducesResponseType(typeof(IReadOnlyList<ElectionResultDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetElections(Guid id, CancellationToken ct)
    {
        var politician = await _getByIdQuery.ExecuteAsync(id, ct);
        if (politician is null)
            return NotFound();

        var results = await _getElectionsQuery.ExecuteAsync(id, ct);
        return Ok(results);
    }

    [HttpGet("{id:guid}/assets")]
    [ProducesResponseType(typeof(IReadOnlyList<AssetDeclarationDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetAssets(Guid id, CancellationToken ct)
    {
        var politician = await _getByIdQuery.ExecuteAsync(id, ct);
        if (politician is null) return NotFound();
        var assets = await _getAssetsQuery.ExecuteAsync(id, ct);
        return Ok(assets);
    }

    [HttpGet("{id:guid}/sources")]
    [ProducesResponseType(typeof(IReadOnlyList<DataSourceDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetSources(Guid id, CancellationToken ct)
    {
        var politician = await _getByIdQuery.ExecuteAsync(id, ct);
        if (politician is null) return NotFound();

        var sources = await _getSourcesQuery.ExecuteAsync(ct);
        return Ok(sources);
    }

    [HttpGet("{id:guid}/score")]
    [ProducesResponseType(typeof(ScoreStatusDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetScore(Guid id, CancellationToken ct)
    {
        var politician = await _getByIdQuery.ExecuteAsync(id, ct);
        if (politician is null) return NotFound();

        var score = await _getScoreQuery.ExecuteAsync(id, ct);
        return Ok(score);
    }

    [HttpGet("{id:guid}/score/history")]
    [ProducesResponseType(typeof(IReadOnlyList<ScoreStatusDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetScoreHistory(Guid id, CancellationToken ct)
    {
        var politician = await _getByIdQuery.ExecuteAsync(id, ct);
        if (politician is null) return NotFound();

        var history = await _getScoreHistoryQuery.ExecuteAsync(id, ct);
        return Ok(history);
    }
}
