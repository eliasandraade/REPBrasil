using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using RepBrasil.Application.Electoral;

namespace RepBrasil.API.Controllers;

/// <summary>
/// Inteligência eleitoral: catálogo territorial, cadastro e resultado oficial por seção (TSE).
///
///   GET /api/v1/elections
///   GET /api/v1/elections/{year}/{round}/states
///   GET /api/v1/elections/{year}/{round}/states/{uf}/municipalities?q=
///   GET /api/v1/elections/{year}/{round}/states/{uf}/municipalities/{municipality}
///   GET /api/v1/elections/{year}/{round}/states/{uf}/municipalities/{municipality}/zones/{zone}
///   GET /api/v1/elections/{year}/{round}/states/{uf}/municipalities/{municipality}/zones/{zone}/sections/{section}/results
///       ?office=&amp;candidate=&amp;party=&amp;voteType=nominal|legenda|branco|nulo
///   GET /api/v1/elections/candidacies/{candidacyId}
///
/// <c>{municipality}</c> aceita slug, código TSE (5 dígitos) ou IBGE (7 dígitos).
/// Território sem cadastro responde <c>status: "cadaster_missing"</c> (200), não 404.
/// </summary>
[ApiController]
[Route("api/v1/elections")]
[ElectoralErrors]
public class ElectionsController(
    ElectoralCatalogService catalog,
    SectionResultsService results,
    CandidacyService candidacies) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(ElectionsResponse), StatusCodes.Status200OK)]
    public Task<ElectionsResponse> Elections(CancellationToken ct) => catalog.ElectionsAsync(ct);

    [HttpGet("{year:int}/{round:int}/states")]
    [ProducesResponseType(typeof(StatesResponse), StatusCodes.Status200OK)]
    public Task<StatesResponse> States(int year, int round, CancellationToken ct) => catalog.StatesAsync(year, round, ct);

    [HttpGet("{year:int}/{round:int}/states/{uf}/municipalities")]
    [ProducesResponseType(typeof(MunicipalitiesResponse), StatusCodes.Status200OK)]
    public Task<MunicipalitiesResponse> Municipalities(int year, int round, string uf, [FromQuery] string? q, CancellationToken ct) =>
        catalog.MunicipalitiesAsync(year, round, uf, q, ct);

    [HttpGet("{year:int}/{round:int}/states/{uf}/municipalities/{municipality}")]
    [ProducesResponseType(typeof(MunicipalityDetailResponse), StatusCodes.Status200OK)]
    public Task<MunicipalityDetailResponse> Municipality(int year, int round, string uf, string municipality, CancellationToken ct) =>
        catalog.MunicipalityDetailAsync(year, round, uf, municipality, ct);

    [HttpGet("{year:int}/{round:int}/states/{uf}/municipalities/{municipality}/zones/{zone:int}")]
    [ProducesResponseType(typeof(ZoneDetailResponse), StatusCodes.Status200OK)]
    public Task<ZoneDetailResponse> Zone(int year, int round, string uf, string municipality, int zone, CancellationToken ct) =>
        catalog.ZoneDetailAsync(year, round, uf, municipality, zone, ct);

    [HttpGet("{year:int}/{round:int}/states/{uf}/municipalities/{municipality}/zones/{zone:int}/sections/{section:int}/results")]
    [ProducesResponseType(typeof(SectionResultsResponse), StatusCodes.Status200OK)]
    public Task<SectionResultsResponse> SectionResults(
        int year, int round, string uf, string municipality, int zone, int section,
        [FromQuery] string? office, [FromQuery] string? candidate, [FromQuery] string? party, [FromQuery] string? voteType,
        CancellationToken ct) =>
        results.ExecuteAsync(year, round, uf, municipality, zone, section,
            SectionResultsService.ParseFilters(office, candidate, party, voteType), ct);

    [HttpGet("candidacies/{candidacyId:guid}")]
    [ProducesResponseType(typeof(CandidacyDto), StatusCodes.Status200OK)]
    public Task<CandidacyDto> Candidacy(Guid candidacyId, CancellationToken ct) => candidacies.PerformanceAsync(candidacyId, ct);
}

/// <summary>Erros eleitorais → HTTP. Integridade nunca vira resposta "vazia": 500 explícito.</summary>
public sealed class ElectoralErrorsAttribute : ExceptionFilterAttribute
{
    public override void OnException(ExceptionContext context)
    {
        context.Result = context.Exception switch
        {
            ElectoralNotFoundException e => new NotFoundObjectResult(new { message = e.Message }),
            ElectoralBadRequestException e => new BadRequestObjectResult(new { message = e.Message }),
            ElectoralIntegrityException e => new ObjectResult(new { message = e.Message, status = "integrity_error" })
            {
                StatusCode = StatusCodes.Status500InternalServerError,
            },
            _ => context.Result,
        };
        context.ExceptionHandled = context.Result is not null;
    }
}
