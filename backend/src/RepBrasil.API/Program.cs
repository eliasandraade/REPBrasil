using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using RepBrasil.API.Infrastructure;
using RepBrasil.Application.Assets.Queries;
using RepBrasil.Application.DataIntelligence;
using RepBrasil.Application.Electoral;
using RepBrasil.Application.ElectionResults.Queries;
using RepBrasil.Application.Interfaces;
using RepBrasil.Application.Overview;
using RepBrasil.Application.Politicians.Queries;
using RepBrasil.Application.Parties;
using RepBrasil.Application.Rankings;
using RepBrasil.Application.Score.Queries;
using RepBrasil.Application.Search;
using RepBrasil.Application.Sources.Queries;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Repositories;

var builder = WebApplication.CreateBuilder(args);

// Logs estruturados (uma linha JSON por evento) fora do desenvolvimento.
if (!builder.Environment.IsDevelopment())
{
    builder.Logging.ClearProviders();
    builder.Logging.AddJsonConsole(o =>
    {
        o.UseUtcTimestamp = true;
        o.TimestampFormat = "yyyy-MM-ddTHH:mm:ss.fffZ ";
    });
}

builder.Services.AddControllers();
builder.Services.AddScoped<IPoliticianRepository, PoliticianRepository>();
builder.Services.AddScoped<SearchPoliticiansQuery>();
builder.Services.AddScoped<GetPoliticianByIdQuery>();
builder.Services.AddScoped<IElectionResultRepository, ElectionResultRepository>();
builder.Services.AddScoped<GetPoliticianElectionsQuery>();
builder.Services.AddScoped<IAssetDeclarationRepository, AssetDeclarationRepository>();
builder.Services.AddScoped<GetPoliticianAssetsQuery>();
builder.Services.AddScoped<ISourceRepository, SourceRepository>();
builder.Services.AddScoped<GetPoliticianSourcesQuery>();
builder.Services.AddScoped<IScoreRepository, ScoreRepository>();
builder.Services.AddScoped<GetPoliticianScoreQuery>();
builder.Services.AddScoped<GetPoliticianScoreHistoryQuery>();

var lakeBaseUrl = builder.Configuration["ElectoralLake:BaseUrl"] ?? "http://electoral-lake.railway.internal:8080";
// Mesmo segredo do worker (REPBRASIL_LAKE_TOKEN); ElectoralLake__Token tem precedência.
var lakeToken = builder.Configuration["ElectoralLake:Token"] ?? builder.Configuration["REPBRASIL_LAKE_TOKEN"];
builder.Services.AddHttpClient<IElectoralLakeClient, ElectoralLakeClient>(client =>
{
    client.BaseAddress = new Uri(lakeBaseUrl, UriKind.Absolute);
    client.Timeout = TimeSpan.FromSeconds(15);
    ElectoralLakeClient.ConfigureAuthorization(client, lakeToken);
});
builder.Services.AddScoped<ElectoralReadRepository>();
builder.Services.AddScoped<IElectoralReadRepository, HybridElectoralReadRepository>();
builder.Services.AddScoped<ElectoralCatalogService>();
builder.Services.AddScoped<SectionResultsService>();
builder.Services.AddScoped<CandidacyService>();
builder.Services.AddScoped<ElectoralXrayRepository>();
builder.Services.AddScoped<IElectoralXrayRepository, HybridElectoralXrayRepository>();
builder.Services.AddScoped<XrayService>();
builder.Services.AddScoped<TerritoryService>();
builder.Services.AddScoped<ComparisonService>();
builder.Services.AddScoped<ElectoralBaseService>();
builder.Services.AddScoped<IRankingRepository, RankingRepository>();
builder.Services.AddScoped<RankingService>();
builder.Services.AddScoped<IPartyRepository, PartyRepository>();
builder.Services.AddScoped<PartyService>();
builder.Services.AddScoped<IDataIntelligenceRepository, DataIntelligenceRepository>();
builder.Services.AddScoped<DataIntelligenceService>();

// Busca global (políticos, territórios, partidos, pleitos); o catálogo pequeno fica na memória do processo
builder.Services.AddMemoryCache();
builder.Services.AddScoped<ISearchRepository, SearchRepository>();
builder.Services.AddScoped<SearchService>();
builder.Services.AddScoped<IOverviewRepository, OverviewRepository>();
builder.Services.AddScoped<OverviewService>();

// Erros: ProblemDetails com id de rastreio; nunca mensagem interna nem pilha.
builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = ctx =>
    ctx.ProblemDetails.Extensions["traceId"] = ctx.HttpContext.TraceIdentifier);
builder.Services.AddExceptionHandler<ApiExceptionHandler>();

// Limite técnico contra abuso (por IP de origem, nunca identidade comercial) e cache de respostas públicas.
builder.Services.AddApiRateLimits(builder.Configuration);
builder.Services.AddOutputCache(o =>
{
    o.SizeLimit = 128L * 1024 * 1024;
    // Dados eleitorais oficiais mudam só em cargas do ETL: 5 min de defasagem são aceitáveis. Varia pela consulta
    // inteira e pela origem (o CORS responde por origem) — nada de uma origem é servido a outra.
    o.AddPolicy(CachePolicies.PublicData, b => b.Expire(TimeSpan.FromMinutes(5)).SetVaryByQuery("*").SetVaryByHeader("Origin"));
});

// Atrás do proxy do Railway: só o último salto de X-Forwarded-For/Proto é confiável (o que o proxy acrescenta).
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.ForwardLimit = 1;
    o.KnownNetworks.Clear();
    o.KnownProxies.Clear();
});

// Swagger só em desenvolvimento ou com Swagger:Enabled=true (ex.: staging protegido). Nunca por padrão em produção.
var swaggerEnabled = builder.Environment.IsDevelopment() || builder.Configuration.GetValue<bool>("Swagger:Enabled");
if (swaggerEnabled)
{
    builder.Services.AddEndpointsApiExplorer();
    builder.Services.AddSwaggerGen(c =>
    {
        c.SwaggerDoc("v1", new() { Title = "REPBrasil API", Version = "v1" });
        // Módulos diferentes têm DTOs homônimos (Assets.AssetItemDto × Electoral.AssetItemDto): id pelo módulo.
        c.CustomSchemaIds(SwaggerSchemaIds.For);
    });
}

var allowedOrigins = (builder.Configuration["AllowedOrigins"] ?? "http://localhost:3000")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

// A API pública é só leitura: o navegador só precisa de GET (o /migrate é chamada de servidor, sem CORS).
builder.Services.AddCors(options =>
    options.AddPolicy("App", policy => policy.WithOrigins(allowedOrigins).WithMethods("GET").WithHeaders("Accept", "Content-Type")));

builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Postgres")));

var port = Environment.GetEnvironmentVariable("PORT") ?? "5000";
builder.WebHost.UseUrls($"http://+:{port}");

var app = builder.Build();

app.UseForwardedHeaders();
// Cabeçalhos de segurança e CORS por fora do tratador de erro: a resposta de erro continua legível pelo frontend.
app.UseSecurityHeaders();
app.UseCors("App");
app.UseExceptionHandler();
app.UseRequestTiming();
app.UseRateLimiter();
app.UseOutputCache();

if (swaggerEnabled)
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

if (app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

app.MapControllers();

var migrationsEnabled = string.Equals(
    builder.Configuration["MigrateOnStartup"],
    "true",
    StringComparison.OrdinalIgnoreCase);

if (migrationsEnabled)
{
    await using var scope = app.Services.CreateAsyncScope();
    var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("DatabaseMigration");
    logger.LogInformation("Applying database migrations on startup...");
    await db.Database.MigrateAsync();
    logger.LogInformation("Database migrations applied successfully.");
}

// Migração manual (POST /migrate) só com MigrateOnStartup=true E o token Migrate:Token no cabeçalho X-Migrate-Token.
// Sem token configurado ou com token errado, o endpoint responde como se não existisse.
if (migrationsEnabled)
{
    var migrateToken = builder.Configuration["Migrate:Token"];
    app.MapPost("/migrate", async (HttpContext http, ApplicationDbContext db, ILogger<Program> logger) =>
    {
        if (!HttpPipeline.SecretEquals(http.Request.Headers["X-Migrate-Token"], migrateToken))
            return Results.NotFound();
        try
        {
            logger.LogInformation("Applying database migrations...");
            await db.Database.MigrateAsync();
            logger.LogInformation("Database migrations applied successfully.");
            return Results.Ok(new { status = "ok", message = "Migrations applied." });
        }
        catch (Exception ex)
        {
            logger.LogCritical(ex, "Migration failed.");
            return Results.Problem("Falha ao aplicar as migrations; veja os logs do serviço.", statusCode: 500);
        }
    }).DisableRateLimiting();
}

app.Run();

/// <summary>Visível para os testes de integração (WebApplicationFactory).</summary>
public partial class Program;
