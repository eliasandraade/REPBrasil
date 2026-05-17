using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Assets.Queries;
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

// Run EF Core migrations at startup when MIGRATE_ON_STARTUP=true (safe for staging — migrations are idempotent)
if (string.Equals(builder.Configuration["MigrateOnStartup"], "true", StringComparison.OrdinalIgnoreCase))
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
    app.Logger.LogInformation("Applying database migrations...");
    await db.Database.MigrateAsync();
    app.Logger.LogInformation("Database migrations applied.");
}

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

app.Run();
