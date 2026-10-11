using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Assets.DTOs;
using RepBrasil.Application.Assets.Queries;
using RepBrasil.Application.Common;
using RepBrasil.Application.Electoral;
using RepBrasil.Application.ElectionResults.DTOs;
using RepBrasil.Application.ElectionResults.Queries;
using RepBrasil.Application.Politicians.DTOs;
using RepBrasil.Application.Politicians.Queries;
using RepBrasil.Application.Score.DTOs;
using RepBrasil.Application.Score.Queries;
using RepBrasil.Application.Sources.DTOs;
using RepBrasil.Application.Sources.Queries;
using RepBrasil.Infrastructure.Persistence;

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
    private readonly CandidacyService _candidacies;
    private readonly XrayService _xray;
    private readonly ApplicationDbContext _db;

    public PoliticiansController(
        SearchPoliticiansQuery searchQuery,
        GetPoliticianByIdQuery getByIdQuery,
        GetPoliticianElectionsQuery getElectionsQuery,
        GetPoliticianAssetsQuery getAssetsQuery,
        GetPoliticianSourcesQuery getSourcesQuery,
        GetPoliticianScoreQuery getScoreQuery,
        GetPoliticianScoreHistoryQuery getScoreHistoryQuery,
        CandidacyService candidacies,
        XrayService xray,
        ApplicationDbContext db)
    {
        _searchQuery = searchQuery;
        _getByIdQuery = getByIdQuery;
        _getElectionsQuery = getElectionsQuery;
        _getAssetsQuery = getAssetsQuery;
        _getSourcesQuery = getSourcesQuery;
        _getScoreQuery = getScoreQuery;
        _getScoreHistoryQuery = getScoreHistoryQuery;
        _candidacies = candidacies;
        _xray = xray;
        _db = db;
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

    // ── Candidaturas (inteligência eleitoral) ───────────────────────────────────

    /// <summary>
    /// Candidaturas oficiais (TSE) ligadas a este perfil, com partido/cargo DAQUELA eleição e
    /// desempenho por município a partir do Boletim de Urna. Dados descritivos: não afetam o Score.
    /// </summary>
    /// <summary>Raio X eleitoral do perfil: candidaturas, votação, chapa, bens, contas, histórico, evolução e insights.</summary>
    [HttpGet("{id:guid}/xray")]
    [ElectoralErrors]
    [ProducesResponseType(typeof(XrayResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> GetXray(Guid id, CancellationToken ct) =>
        Ok(await _xray.BuildAsync(id, ct));

    [HttpGet("{id:guid}/candidacies")]
    [ProducesResponseType(typeof(PoliticianCandidaciesResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetCandidacies(Guid id, [FromQuery] int top = 5, CancellationToken ct = default)
    {
        var politician = await _getByIdQuery.ExecuteAsync(id, ct);
        if (politician is null) return NotFound();

        var result = await _candidacies.ByPoliticianAsync(id, Math.Clamp(top, 0, 50), ct);
        return Ok(result);
    }

    // ── Mandates ─────────────────────────────────────────────────────────────────

    public record MandateResponse(
        Guid Id,
        string House,
        int Legislature,
        string? Title,
        string? State,
        string? PartyAcronym,
        DateTime? StartDate,
        DateTime? EndDate,
        string? ExternalId,
        string? ExternalUrl
    );

    [HttpGet("{id:guid}/mandates")]
    [ProducesResponseType(typeof(IReadOnlyList<MandateResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetMandates(Guid id, CancellationToken ct)
    {
        var politician = await _getByIdQuery.ExecuteAsync(id, ct);
        if (politician is null)
            return NotFound();

        var mandates = await _db.Mandates
            .AsNoTracking()
            .Where(m => m.PoliticianId == id)
            .OrderByDescending(m => m.Legislature)
            .Select(m => new MandateResponse(
                m.Id, m.House, m.Legislature, m.Title,
                m.State, m.PartyAcronym, m.StartDate, m.EndDate,
                m.ExternalId, m.ExternalUrl
            ))
            .ToListAsync(ct);

        return Ok(mandates);
    }
}
