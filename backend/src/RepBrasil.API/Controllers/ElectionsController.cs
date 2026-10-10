using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using RepBrasil.Application.Electoral;

namespace RepBrasil.API.Controllers;

/// <summary>
/// Inteligência eleitoral: catálogo territorial, cadastro, resultado oficial por seção e comparações descritivas (TSE).
///
///   GET /api/v1/elections
///   GET /api/v1/elections/{year}/{round}/states
///   GET /api/v1/elections/{year}/{round}/states/{uf}/municipalities?q=
///   GET /api/v1/elections/{year}/{round}/states/{uf}/municipalities/{municipality}
///   GET /api/v1/elections/{year}/{round}/states/{uf}/municipalities/{municipality}/zones/{zone}
///   GET /api/v1/elections/{year}/{round}/states/{uf}/municipalities/{municipality}/zones/{zone}/sections/{section}/results
///       ?office=&amp;candidate=&amp;party=&amp;voteType=nominal|legenda|branco|nulo
///   GET /api/v1/elections/candidacies/{candidacyId}
///   GET /api/v1/elections/candidacies/{candidacyId}/territory?level=municipality|zone|section|place&amp;uf=&amp;municipality=&amp;zone=
///   GET /api/v1/elections/candidacies/{candidacyId}/assets?compareTo=
///   GET /api/v1/elections/candidacies/{candidacyId}/finance
///   GET /api/v1/elections/{year}/{round}/states/{uf}/candidates?municipality=&amp;zone=&amp;office=&amp;party=&amp;q=&amp;status=&amp;elected=&amp;minVotes=&amp;sort=&amp;dir=&amp;page=&amp;pageSize=
///   GET /api/v1/elections/{year}/{round}/states/{uf}/map?layer=intensity|share|winner|growth|decline|ab&amp;office=&amp;candidacy=&amp;base=&amp;a=&amp;b=&amp;municipality=
///   GET /api/v1/elections/compare?candidacy=…(máx. 5)&amp;uf=CE&amp;level=state|municipality|zone|section|place&amp;municipality=&amp;zone=
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
    CandidacyService candidacies,
    TerritoryService territory,
    ComparisonService comparison) : ControllerBase
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

    [HttpGet("candidacies/{candidacyId:guid}/territory")]
    [ProducesResponseType(typeof(CandidacyTerritoryResponse), StatusCodes.Status200OK)]
    public Task<CandidacyTerritoryResponse> CandidacyTerritory(
        Guid candidacyId,
        [FromQuery] string? level,
        [FromQuery] string? uf,
        [FromQuery] string? municipality,
        [FromQuery] int? zone,
        CancellationToken ct) =>
        territory.DistributionAsync(candidacyId, level, uf, municipality, zone, ct);

    [HttpGet("candidacies/{candidacyId:guid}/assets")]
    [ProducesResponseType(typeof(CandidacyAssetsResponse), StatusCodes.Status200OK)]
    public Task<CandidacyAssetsResponse> CandidacyAssets(Guid candidacyId, [FromQuery] Guid? compareTo, CancellationToken ct) =>
        territory.AssetsAsync(candidacyId, compareTo, ct);

    [HttpGet("candidacies/{candidacyId:guid}/finance")]
    [ProducesResponseType(typeof(CandidacyFinanceResponse), StatusCodes.Status200OK)]
    public Task<CandidacyFinanceResponse> CandidacyFinance(Guid candidacyId, CancellationToken ct) =>
        territory.FinanceAsync(candidacyId, ct);

    [HttpGet("{year:int}/{round:int}/states/{uf}/candidates")]
    [ProducesResponseType(typeof(TerritoryCandidatesResponse), StatusCodes.Status200OK)]
    public Task<TerritoryCandidatesResponse> Candidates(
        int year, int round, string uf,
        [FromQuery] string? municipality,
        [FromQuery] int? zone,
        [FromQuery] int? office,
        [FromQuery] string? party,
        [FromQuery] string? q,
        [FromQuery] string? status,
        [FromQuery] bool? elected,
        [FromQuery] long? minVotes,
        [FromQuery] string? sort,
        [FromQuery] string? dir,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken ct = default) =>
        territory.CandidatesAsync(
            new CandidatesQuery(year, round, uf, municipality, zone, office, party, q, status, elected, minVotes, sort, dir, page, pageSize),
            ct);

    [HttpGet("{year:int}/{round:int}/states/{uf}/map")]
    [ProducesResponseType(typeof(MapLayerResponse), StatusCodes.Status200OK)]
    public Task<MapLayerResponse> Map(
        int year, int round, string uf,
        [FromQuery] string layer,
        [FromQuery] int? office,
        [FromQuery] Guid? candidacy,
        [FromQuery(Name = "base")] Guid? baseCandidacy,
        [FromQuery] Guid? a,
        [FromQuery] Guid? b,
        [FromQuery] string? municipality,
        CancellationToken ct) =>
        territory.MapAsync(new MapQuery(year, round, uf, layer, office, candidacy, baseCandidacy, a, b, municipality), ct);

    /// <summary>Comparação de até 5 candidaturas (limite imposto aqui e no frontend).</summary>
    [HttpGet("compare")]
    [ProducesResponseType(typeof(ElectoralComparisonResponse), StatusCodes.Status200OK)]
    public Task<ElectoralComparisonResponse> Compare(
        [FromQuery(Name = "candidacy")] Guid[] candidacyIds,
        [FromQuery] string? uf,
        [FromQuery] string? level,
        [FromQuery] string? municipality,
        [FromQuery] int? zone,
        CancellationToken ct) =>
        comparison.CompareAsync(new ComparisonService.Request(candidacyIds, uf, level, municipality, zone), ct);
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
