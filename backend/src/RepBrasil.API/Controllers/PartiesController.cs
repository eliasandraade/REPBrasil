using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;
using RepBrasil.API.Infrastructure;
using RepBrasil.Application.Parties;

namespace RepBrasil.API.Controllers;

/// <summary>
/// Partidos e força partidária numa UF (dados oficiais do TSE: candidaturas e Boletins de Urna).
///   GET /api/v1/parties?uf=CE — partidos com resultados por eleição × cargo
///   GET /api/v1/parties/{slug}?uf=CE&amp;year=&amp;round=&amp;office= — perfil: identidade, resultados, variação, municípios, candidaturas
/// Camada do mapa: GET /api/v1/elections/{year}/{round}/states/{uf}/map?layer=party&amp;office=&amp;party=
/// </summary>
[ApiController]
[Route("api/v1/parties")]
[ElectoralErrors]
[OutputCache(PolicyName = CachePolicies.PublicData)]
public class PartiesController(PartyService parties) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(PartiesResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public Task<PartiesResponse> List([FromQuery] string? uf, CancellationToken ct) => parties.ListAsync(uf, ct);

    [HttpGet("{slug}")]
    [ProducesResponseType(typeof(PartyProfileResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<PartyProfileResponse> Profile(
        string slug,
        [FromQuery] string? uf,
        [FromQuery] int? year,
        [FromQuery] int? round,
        [FromQuery] int? office,
        CancellationToken ct) =>
        parties.ProfileAsync(slug, uf, year, round, office, ct);
}
