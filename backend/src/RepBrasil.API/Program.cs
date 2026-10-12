using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using RepBrasil.API.Infrastructure;
using RepBrasil.Application.Assets.Queries;
using RepBrasil.Application.DataIntelligence;
using RepBrasil.Application.Electoral;
using RepBrasil.Application.ElectoralLive;
using RepBrasil.Application.ElectionResults.Queries;
using RepBrasil.Application.Interfaces;
using RepBrasil.Application.Overview;
using RepBrasil.Application.Parliament;
using RepBrasil.Application.Politicians.Queries;
using RepBrasil.Application.Parties;
using RepBrasil.Application.Rankings;
using RepBrasil.Application.Score.Queries;
using RepBrasil.Application.Search;
using RepBrasil.Application.Sources.Queries;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Repositories;

var builder = WebApplication.CreateBuilder(args);

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
builder.Services.AddScoped<IParliamentRepository, ParliamentRepository>();
builder.Services.AddScoped<ParliamentService>();
builder.Services.AddScoped<IElectoralLiveRepository, ElectoralLiveRepository>();
builder.Services.AddScoped<ElectoralLiveService>();

builder.Services.AddMemoryCache();
builder.Services.AddScoped<ISearchRepository, SearchRepository>();
builder.Services.AddScoped<SearchService>();
builder.Services.AddScoped<IOverviewRepository, OverviewRepository>();
builder.Services.AddScoped<OverviewService>();

builder.Services.AddScoped<AccountService>();
builder.Services.AddScoped<AuthExternalService>();
builder.Services.AddHttpClient("google-auth", client => client.Timeout = TimeSpan.FromSeconds(15));

builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = ctx =>
    ctx.ProblemDetails.Extensions["traceId"] = ctx.HttpContext.TraceIdentifier);
builder.Services.AddExceptionHandler<ApiExceptionHandler>();

builder.Services.AddApiRateLimits(builder.Configuration);
builder.Services.AddOutputCache(o =>
{
    o.SizeLimit = 128L * 1024 * 1024;
    o.AddPolicy(CachePolicies.PublicData, b => b.Expire(TimeSpan.FromMinutes(5)).SetVaryByQuery("*").SetVaryByHeader("Origin"));
    o.AddPolicy(CachePolicies.LiveData, b => b.Expire(TimeSpan.FromSeconds(15)).SetVaryByQuery("*").SetVaryByHeader("Origin"));
});

builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.ForwardLimit = 1;
    o.KnownNetworks.Clear();
    o.KnownProxies.Clear();
});

var swaggerEnabled = builder.Environment.IsDevelopment() || builder.Configuration.GetValue<bool>("Swagger:Enabled");
if (swaggerEnabled)
{
    builder.Services.AddEndpointsApiExplorer();
    builder.Services.AddSwaggerGen(c =>
    {
        c.SwaggerDoc("v1", new() { Title = "REPBrasil API", Version = "v1" });
        c.CustomSchemaIds(SwaggerSchemaIds.For);
    });
}

var allowedOrigins = (builder.Configuration["AllowedOrigins"] ?? "http://localhost:3000")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

builder.Services.AddCors(options =>
    options.AddPolicy("App", policy => policy
        .WithOrigins(allowedOrigins)
        .WithMethods("GET", "POST", "DELETE", "OPTIONS")
        .WithHeaders("Accept", "Content-Type", "X-RepBrasil-CSRF", "X-Api-Key", "X-Alerts-Token")
        .AllowCredentials()));

builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Postgres")));

var port = Environment.GetEnvironmentVariable("PORT") ?? "5000";
builder.WebHost.UseUrls($"http://+:{port}");

var app = builder.Build();

app.UseForwardedHeaders();
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

if (app.Environment.IsDevelopment()) app.UseHttpsRedirection();

app.MapControllers();

var migrationsEnabled = string.Equals(builder.Configuration["MigrateOnStartup"], "true", StringComparison.OrdinalIgnoreCase);
var applyMigrationsOnStartup = migrationsEnabled && !builder.Configuration.GetValue<bool>("Migrate:SkipStartupApply");

if (applyMigrationsOnStartup)
{
    await using var scope = app.Services.CreateAsyncScope();
    var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("DatabaseMigration");
    logger.LogInformation("Applying database migrations on startup...");
    await db.Database.MigrateAsync();
    logger.LogInformation("Database migrations applied successfully.");
}

if (migrationsEnabled)
{
    var migrateToken = builder.Configuration["Migrate:Token"];
    app.MapPost("/migrate", async (HttpContext http, ApplicationDbContext db, ILogger<Program> logger) =>
    {
        if (!HttpPipeline.SecretEquals(http.Request.Headers["X-Migrate-Token"], migrateToken)) return Results.NotFound();
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

public partial class Program;