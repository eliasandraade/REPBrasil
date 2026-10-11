using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;
using Microsoft.AspNetCore.RateLimiting;
using RepBrasil.API.Infrastructure;
using RepBrasil.Application.Rankings;

namespace RepBrasil.API.Controllers;

/// <summary>
/// Rankings determinísticos sobre dados oficiais.
///   GET /api/v1/rankings/kinds — tipos, definição, filtros obrigatórios e regra de comparabilidade
///   GET /api/v1/rankings?kind=votes&amp;year=2024&amp;round=1&amp;office=13&amp;uf=CE&amp;municipality=&amp;party=&amp;page=&amp;pageSize=
/// Recortes que comparariam disputas incompatíveis respondem 400 com o motivo.
/// </summary>
[ApiController]
[Route("api/v1/rankings")]
[ElectoralErrors]
[OutputCache(PolicyName = CachePolicies.PublicData)]
public class RankingsController(RankingService rankings) : ControllerBase
{
    [HttpGet("kinds")]
    [ProducesResponseType(typeof(IReadOnlyList<RankingKindDto>), StatusCodes.Status200OK)]
    public IReadOnlyList<RankingKindDto> Kinds() => RankingService.Kinds;

    [HttpGet]
    [EnableRateLimiting(ApiRateLimits.Heavy)]
    [ProducesResponseType(typeof(RankingResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public Task<RankingResponse> Rank(
        [FromQuery] string kind,
        [FromQuery] int? year,
        [FromQuery] int? round,
        [FromQuery] int? office,
        [FromQuery] string? uf,
        [FromQuery] string? municipality,
        [FromQuery] string? party,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken ct = default) =>
        rankings.RankAsync(kind, year, round, office, uf, municipality, party, page, pageSize, ct);
}
