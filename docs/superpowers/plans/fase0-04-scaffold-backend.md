# REPBrasil Fase 0 — Bloco 4: Scaffold do Backend

> **Para execução:** Use `superpowers:subagent-driven-development` ou `superpowers:executing-plans`.
> **Depende de:** Bloco 1 (pasta `backend/` criada). .NET 8 SDK instalado.

**Objetivo:** Criar a solução .NET 8 com quatro projetos em Clean Architecture, entidades de domínio declaradas, `ApplicationDbContext` configurado, `HealthController` com dois endpoints funcionais e Swagger habilitado em desenvolvimento. O resultado deve compilar com `dotnet build` e responder em `GET /health`.

---

## Arquivos criados

```
backend/
├── Directory.Build.props
├── RepBrasil.sln
└── src/
    ├── RepBrasil.Domain/
    │   ├── RepBrasil.Domain.csproj
    │   └── Entities/
    │       ├── AuditableEntity.cs
    │       ├── Politician.cs
    │       ├── Election.cs
    │       ├── Party.cs
    │       ├── AssetDeclaration.cs
    │       ├── ElectionResult.cs
    │       ├── Company.cs
    │       ├── Contract.cs
    │       ├── Amendment.cs
    │       ├── Municipality.cs
    │       ├── LegalCase.cs
    │       ├── ScoreSnapshot.cs
    │       ├── Flag.cs
    │       ├── Source.cs
    │       ├── Evidence.cs
    │       └── Contestation.cs
    ├── RepBrasil.Application/
    │   └── RepBrasil.Application.csproj
    ├── RepBrasil.Infrastructure/
    │   ├── RepBrasil.Infrastructure.csproj
    │   └── Persistence/
    │       └── ApplicationDbContext.cs
    └── RepBrasil.API/
        ├── RepBrasil.API.csproj
        ├── Program.cs
        ├── appsettings.json
        ├── appsettings.Development.json
        └── Controllers/
            └── HealthController.cs
```

---

## Decisões arquiteturais

- **`Directory.Build.props`** na raiz de `backend/`: propaga `Nullable`, `ImplicitUsings`, `LangVersion` para todos os projetos sem repetir em cada `.csproj`.
- **`AuditableEntity`** como base abstrata: todas as entidades de domínio herdam dela. Garante `Guid Id`, `CreatedAt`, `UpdatedAt`, `DeletedAt`, `SourceUpdatedAt` em todos os registros.
- **Guid como identificador interno**: IDs externos de cada fonte (TSE, Câmara, etc.) ficam em campos separados (`TseId`, `CamaraId`) para rastreabilidade sem dependência de sistemas externos.
- **`ScoreSnapshot` imutável por design**: não tem setter em `Score` e `Version` — o construtor é a única forma de criar um snapshot.
- **`Source` expandida**: campos `SourceType`, `CollectedAt`, `OriginalUrl`, `Hash`, `License` garantem rastreabilidade completa de cada dado.
- **Swagger apenas em `Development`**: `IsDevelopment()` controla a ativação.
- **Versionamento `/api/v1/`**: todos os endpoints seguem essa convenção.
- **`RepBrasil.Application` vazio na Fase 0**: o projeto existe para estabelecer a camada — use cases virão na Fase 1.

---

## Steps

### Criar projetos .NET

- [ ] **1. Criar `backend/Directory.Build.props`**

```xml
<Project>
  <PropertyGroup>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <LangVersion>latest</LangVersion>
    <TreatWarningsAsErrors>false</TreatWarningsAsErrors>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>
```

- [ ] **2. Criar solução e projetos via CLI**

Executar a partir de `C:\Users\Elias\Documents\RepBrasil\backend\`:

```bash
dotnet new sln -n RepBrasil

dotnet new classlib -n RepBrasil.Domain -f net8.0 -o src/RepBrasil.Domain
dotnet new classlib -n RepBrasil.Application -f net8.0 -o src/RepBrasil.Application
dotnet new classlib -n RepBrasil.Infrastructure -f net8.0 -o src/RepBrasil.Infrastructure
dotnet new webapi -n RepBrasil.API -f net8.0 -o src/RepBrasil.API

dotnet sln add src/RepBrasil.Domain/RepBrasil.Domain.csproj
dotnet sln add src/RepBrasil.Application/RepBrasil.Application.csproj
dotnet sln add src/RepBrasil.Infrastructure/RepBrasil.Infrastructure.csproj
dotnet sln add src/RepBrasil.API/RepBrasil.API.csproj
```

Esperado: `Project added to the solution.` para cada projeto.

- [ ] **3. Adicionar referências entre projetos**

```bash
dotnet add src/RepBrasil.Application/RepBrasil.Application.csproj reference src/RepBrasil.Domain/RepBrasil.Domain.csproj

dotnet add src/RepBrasil.Infrastructure/RepBrasil.Infrastructure.csproj reference src/RepBrasil.Domain/RepBrasil.Domain.csproj
dotnet add src/RepBrasil.Infrastructure/RepBrasil.Infrastructure.csproj reference src/RepBrasil.Application/RepBrasil.Application.csproj

dotnet add src/RepBrasil.API/RepBrasil.API.csproj reference src/RepBrasil.Application/RepBrasil.Application.csproj
dotnet add src/RepBrasil.API/RepBrasil.API.csproj reference src/RepBrasil.Infrastructure/RepBrasil.Infrastructure.csproj
```

- [ ] **4. Adicionar pacotes NuGet**

```bash
dotnet add src/RepBrasil.Infrastructure/RepBrasil.Infrastructure.csproj package Microsoft.EntityFrameworkCore
dotnet add src/RepBrasil.Infrastructure/RepBrasil.Infrastructure.csproj package Npgsql.EntityFrameworkCore.PostgreSQL
dotnet add src/RepBrasil.Infrastructure/RepBrasil.Infrastructure.csproj package Microsoft.Extensions.Caching.StackExchangeRedis
dotnet add src/RepBrasil.API/RepBrasil.API.csproj package Swashbuckle.AspNetCore
```

- [ ] **5. Remover arquivos gerados desnecessários**

O `dotnet new classlib` e `dotnet new webapi` criam arquivos de exemplo. Remover:

```bash
rm src/RepBrasil.Domain/Class1.cs
rm src/RepBrasil.Application/Class1.cs
rm src/RepBrasil.Infrastructure/Class1.cs
# A webapi cria WeatherForecast.cs e seu controller — remover também:
rm src/RepBrasil.API/WeatherForecast.cs
rm src/RepBrasil.API/Controllers/WeatherForecastController.cs
```

### Entidades de domínio

- [ ] **6. Criar `src/RepBrasil.Domain/Entities/AuditableEntity.cs`**

```csharp
namespace RepBrasil.Domain.Entities;

public abstract class AuditableEntity
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? DeletedAt { get; set; }
    public DateTime? SourceUpdatedAt { get; set; }
}
```

- [ ] **7. Criar entidades de domínio (classes base)**

Criar cada arquivo dentro de `src/RepBrasil.Domain/Entities/`:

**`Politician.cs`**
```csharp
namespace RepBrasil.Domain.Entities;

public class Politician : AuditableEntity
{
    public string Name { get; set; } = string.Empty;
    public string BallotName { get; set; } = string.Empty;
    public string? TseId { get; set; }
    public string? CamaraId { get; set; }
    public string? SenateId { get; set; }
}
```

**`Party.cs`**
```csharp
namespace RepBrasil.Domain.Entities;

public class Party : AuditableEntity
{
    public string Name { get; set; } = string.Empty;
    public string Acronym { get; set; } = string.Empty;
    public string? TseNumber { get; set; }
}
```

**`Election.cs`**
```csharp
namespace RepBrasil.Domain.Entities;

public class Election : AuditableEntity
{
    public int Year { get; set; }
    public string Office { get; set; } = string.Empty;
    public string State { get; set; } = string.Empty;
    public string? City { get; set; }
}
```

**`ElectionResult.cs`**
```csharp
namespace RepBrasil.Domain.Entities;

public class ElectionResult : AuditableEntity
{
    public Guid PoliticianId { get; set; }
    public Guid ElectionId { get; set; }
    public Guid PartyId { get; set; }
    public long TotalVotes { get; set; }
    public bool Elected { get; set; }
}
```

**`AssetDeclaration.cs`**
```csharp
namespace RepBrasil.Domain.Entities;

public class AssetDeclaration : AuditableEntity
{
    public Guid PoliticianId { get; set; }
    public int ElectionYear { get; set; }
    public decimal TotalValue { get; set; }
    public string? TseSequential { get; set; }
}
```

**`Company.cs`**
```csharp
namespace RepBrasil.Domain.Entities;

public class Company : AuditableEntity
{
    public string Name { get; set; } = string.Empty;
    public string Cnpj { get; set; } = string.Empty;
    public string? LegalNature { get; set; }
    public string? Status { get; set; }
    public DateTime? OpenedAt { get; set; }
}
```

**`Contract.cs`**
```csharp
namespace RepBrasil.Domain.Entities;

public class Contract : AuditableEntity
{
    public Guid CompanyId { get; set; }
    public string ContractNumber { get; set; } = string.Empty;
    public decimal Value { get; set; }
    public DateTime SignedAt { get; set; }
    public string? PublicBody { get; set; }
}
```

**`Amendment.cs`**
```csharp
namespace RepBrasil.Domain.Entities;

public class Amendment : AuditableEntity
{
    public Guid PoliticianId { get; set; }
    public decimal Value { get; set; }
    public string? Destination { get; set; }
    public int Year { get; set; }
    public string? SiopCode { get; set; }
}
```

**`Municipality.cs`**
```csharp
namespace RepBrasil.Domain.Entities;

public class Municipality : AuditableEntity
{
    public string Name { get; set; } = string.Empty;
    public string State { get; set; } = string.Empty;
    public string? IbgeCode { get; set; }
}
```

**`LegalCase.cs`**
```csharp
namespace RepBrasil.Domain.Entities;

public class LegalCase : AuditableEntity
{
    public Guid PoliticianId { get; set; }
    public string CaseNumber { get; set; } = string.Empty;
    public string Court { get; set; } = string.Empty;
    public string? Subject { get; set; }
    public string Status { get; set; } = string.Empty;
    public bool HasFinalConviction { get; set; }
}
```

**`ScoreSnapshot.cs`**

> `ScoreSnapshot` é imutável: `Score` e `MethodologyVersion` só podem ser definidos no construtor.

```csharp
namespace RepBrasil.Domain.Entities;

public class ScoreSnapshot : AuditableEntity
{
    public Guid PoliticianId { get; init; }
    public decimal Score { get; init; }
    public string MethodologyVersion { get; init; } = string.Empty;
    public DateTime CalculatedAt { get; init; } = DateTime.UtcNow;
    public string? Notes { get; init; }
}
```

**`Flag.cs`**
```csharp
namespace RepBrasil.Domain.Entities;

public class Flag : AuditableEntity
{
    public Guid PoliticianId { get; set; }
    public string Type { get; set; } = string.Empty; // "Atenção" | "Atenção Alta" | "Atenção Crítica"
    public string Description { get; set; } = string.Empty;
    public Guid? EvidenceId { get; set; }
    public bool Resolved { get; set; }
    public DateTime? ResolvedAt { get; set; }
}
```

**`Source.cs`**
```csharp
namespace RepBrasil.Domain.Entities;

public class Source : AuditableEntity
{
    public string Name { get; set; } = string.Empty;
    public string SourceType { get; set; } = string.Empty;
    public string OriginalUrl { get; set; } = string.Empty;
    public DateTime CollectedAt { get; set; }
    public string? Hash { get; set; }
    public string? License { get; set; }
}
```

**`Evidence.cs`**
```csharp
namespace RepBrasil.Domain.Entities;

public class Evidence : AuditableEntity
{
    public Guid SourceId { get; set; }
    public string Description { get; set; } = string.Empty;
    public string? RawValue { get; set; }
    public string? DocumentUrl { get; set; }
}
```

**`Contestation.cs`**
```csharp
namespace RepBrasil.Domain.Entities;

public class Contestation : AuditableEntity
{
    public Guid PoliticianId { get; set; }
    public string DataField { get; set; } = string.Empty;
    public string CurrentValue { get; set; } = string.Empty;
    public string ClaimedValue { get; set; } = string.Empty;
    public string Status { get; set; } = "Recebida";
    public string? SupportingDocumentUrl { get; set; }
    public string? Resolution { get; set; }
}
```

### Infraestrutura

- [ ] **8. Criar `src/RepBrasil.Infrastructure/Persistence/ApplicationDbContext.cs`**

```csharp
using Microsoft.EntityFrameworkCore;
using RepBrasil.Domain.Entities;

namespace RepBrasil.Infrastructure.Persistence;

public class ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
    : DbContext(options)
{
    public DbSet<Politician> Politicians => Set<Politician>();
    public DbSet<Party> Parties => Set<Party>();
    public DbSet<Election> Elections => Set<Election>();
    public DbSet<ElectionResult> ElectionResults => Set<ElectionResult>();
    public DbSet<AssetDeclaration> AssetDeclarations => Set<AssetDeclaration>();
    public DbSet<Company> Companies => Set<Company>();
    public DbSet<Contract> Contracts => Set<Contract>();
    public DbSet<Amendment> Amendments => Set<Amendment>();
    public DbSet<Municipality> Municipalities => Set<Municipality>();
    public DbSet<LegalCase> LegalCases => Set<LegalCase>();
    public DbSet<ScoreSnapshot> ScoreSnapshots => Set<ScoreSnapshot>();
    public DbSet<Flag> Flags => Set<Flag>();
    public DbSet<Source> Sources => Set<Source>();
    public DbSet<Evidence> Evidences => Set<Evidence>();
    public DbSet<Contestation> Contestations => Set<Contestation>();
}
```

### API

- [ ] **9. Criar `src/RepBrasil.API/Controllers/HealthController.cs`**

```csharp
using Microsoft.AspNetCore.Mvc;

namespace RepBrasil.API.Controllers;

[ApiController]
public class HealthController : ControllerBase
{
    [HttpGet("/health")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public IActionResult Health() => Ok();

    [HttpGet("/api/v1/status")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public IActionResult Status() => Ok(new
    {
        status = "ok",
        version = "0.1.0",
        environment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Production",
        timestamp = DateTimeOffset.UtcNow
    });
}
```

- [ ] **10. Criar `src/RepBrasil.API/appsettings.json`**

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "AllowedHosts": "*",
  "ConnectionStrings": {
    "Postgres": "Host=localhost;Port=5432;Database=repbrasil;Username=repbrasil;Password=repbrasil",
    "Redis": "localhost:6379"
  },
  "Neo4j": {
    "Uri": "bolt://localhost:7687",
    "Username": "neo4j",
    "Password": "repbrasil"
  }
}
```

- [ ] **11. Criar `src/RepBrasil.API/appsettings.Development.json`**

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Debug",
      "Microsoft.AspNetCore": "Information"
    }
  }
}
```

- [ ] **12. Criar `src/RepBrasil.API/Program.cs`**

```csharp
using Microsoft.EntityFrameworkCore;
using RepBrasil.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();

// Swagger apenas em desenvolvimento
if (builder.Environment.IsDevelopment())
{
    builder.Services.AddSwaggerGen(c =>
    {
        c.SwaggerDoc("v1", new() { Title = "REPBrasil API", Version = "v1" });
    });
}

// PostgreSQL
builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Postgres")));

// Redis
builder.Services.AddStackExchangeRedisCache(options =>
{
    options.Configuration = builder.Configuration.GetConnectionString("Redis");
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.MapControllers();

app.Run();
```

### Verificação

- [ ] **13. Compilar a solução**

```bash
dotnet build
```

Esperado:
```
Build succeeded.
    0 Warning(s)
    0 Error(s)
```

- [ ] **14. Rodar a API localmente**

O docker-compose do infra deve estar rodando (Bloco 6), ou comentar temporariamente o EF Core no `Program.cs` para testar sem banco.

```bash
cd src/RepBrasil.API
dotnet run
```

Esperado: `Now listening on: http://localhost:5000`

- [ ] **15. Verificar `/health`**

```bash
curl http://localhost:5000/health
```

Esperado: HTTP 200, corpo vazio.

- [ ] **16. Verificar `/api/v1/status`**

```bash
curl http://localhost:5000/api/v1/status
```

Esperado:
```json
{
  "status": "ok",
  "version": "0.1.0",
  "environment": "Development",
  "timestamp": "2026-05-15T..."
}
```

- [ ] **17. Verificar Swagger**

Abrir `http://localhost:5000/swagger` no browser.
Esperado: UI do Swagger com os dois endpoints listados.

- [ ] **18. Commit**

```bash
cd ../../..
git add backend/
git commit -m "feat(backend): scaffold .NET 8 Clean Architecture, entidades de domínio, health check, Swagger"
git push
```

---

## Critérios de sucesso

- [ ] `dotnet build` sem erros
- [ ] `GET /health` retorna HTTP 200
- [ ] `GET /api/v1/status` retorna JSON com `status`, `version`, `environment`, `timestamp`
- [ ] Swagger acessível em desenvolvimento em `/swagger`
- [ ] Todas as 15 entidades existem em `RepBrasil.Domain/Entities/`
- [ ] `AuditableEntity` tem `Id`, `CreatedAt`, `UpdatedAt`, `DeletedAt`, `SourceUpdatedAt`
- [ ] `ScoreSnapshot` tem propriedades com `init` (imutável)
- [ ] `Source` tem `SourceType`, `CollectedAt`, `OriginalUrl`, `Hash`, `License`
- [ ] `ApplicationDbContext` tem `DbSet<>` para todas as entidades

---

## Riscos / Pontos de atenção

| Risco | Mitigação |
|-------|-----------|
| .NET 8 SDK não instalado | Verificar `dotnet --version` antes de começar |
| `dotnet new webapi` gera `Program.cs` mínimo sem controllers — conflito com nosso `Program.cs` | Sobrescrever o arquivo gerado com o conteúdo do Step 12 |
| EF Core reclamando de banco inexistente ao subir a API | Bloco 6 (infra) precisa estar rodando, ou usar `--no-build` e testar só o health check sem banco |
| `WeatherForecast.cs` não deletado gerando conflito de namespace | Garantir Step 5 executado |
| Swagger exposto em produção acidentalmente | Garantir que o `if (IsDevelopment())` está correto no `Program.cs` |
