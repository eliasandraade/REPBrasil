using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Assets.Queries;
using RepBrasil.Application.Electoral;
using RepBrasil.Application.ElectionResults.Queries;
using RepBrasil.Application.Interfaces;
using RepBrasil.Application.Politicians.Queries;
using RepBrasil.Application.Score.Queries;
using RepBrasil.Application.Sources.Queries;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Repositories;

var builder = WebApplication.CreateBuilder(args);

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

// Inteligência eleitoral (schema electoral, somente leitura)
builder.Services.AddScoped<IElectoralReadRepository, ElectoralReadRepository>();
builder.Services.AddScoped<ElectoralCatalogService>();
builder.Services.AddScoped<SectionResultsService>();
builder.Services.AddScoped<CandidacyService>();
builder.Services.AddScoped<IElectoralXrayRepository, ElectoralXrayRepository>();
builder.Services.AddScoped<XrayService>();
builder.Services.AddScoped<TerritoryService>();
builder.Services.AddScoped<ComparisonService>();

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new() { Title = "REPBrasil API", Version = "v1" });
});

var allowedOrigins = (builder.Configuration["AllowedOrigins"] ?? "http://localhost:3000")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

builder.Services.AddCors(options =>
{
    options.AddPolicy("App", policy =>
    {
        policy
            .WithOrigins(allowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Postgres")));

// Bind to Railway-injected PORT (fallback 5000 for local dev)
var port = Environment.GetEnvironmentVariable("PORT") ?? "5000";
builder.WebHost.UseUrls($"http://+:{port}");

var app = builder.Build();

// Swagger active in staging — temporary, will be protected or removed before public launch
app.UseSwagger();
app.UseSwaggerUI();
app.UseCors("App");

// UseHttpsRedirection omitted in Production — Railway terminates TLS at the proxy layer
if (app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

app.MapControllers();

// Expose a manual migrate endpoint — call POST /migrate after deployment if needed.
// Avoids blocking startup with a potentially slow DB connection at Railway.
if (string.Equals(builder.Configuration["MigrateOnStartup"], "true", StringComparison.OrdinalIgnoreCase))
{
    app.MapPost("/migrate", async (ApplicationDbContext db, ILogger<Program> logger) =>
    {
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
            return Results.Problem(ex.Message, statusCode: 500);
        }
    });
}

app.Run();
