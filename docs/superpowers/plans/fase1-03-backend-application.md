# REPBrasil Fase 1 — Bloco 3: Backend — Application Layer

> **Para execução:** Use `superpowers:subagent-driven-development` ou `superpowers:executing-plans`.
> **Depende de:** Bloco 1 (migrations aplicadas). Banco populado pelo ETL (Bloco 2).

**Objetivo:** Implementar a camada Application com interface `IPoliticianRepository`, DTOs de resposta, e dois use cases: busca por nome/partido e busca por ID. A camada API não é tocada neste bloco — isso é o próximo bloco.

---

## Decisões arquiteturais

- **Repository interface no domínio**: `IPoliticianRepository` fica em `RepBrasil.Application` (ou `RepBrasil.Domain`) — a implementação EF Core fica em `RepBrasil.Infrastructure`.
- **DTOs simples**: sem AutoMapper na Fase 1. Mapeamento manual com método estático `FromEntity()`.
- **Busca por ILIKE**: PostgreSQL com `EF.Functions.ILike()` para busca case-insensitive por nome ou nome de urna. Full-text search (GIN/tsvector) fica para Fase 2.
- **Paginação offset**: simples `Skip()`/`Take()` para Fase 1. Cursor-based pagination na Fase 2.
- **Retorno tipado**: `PagedResult<T>` genérico para listas paginadas.

---

## Arquivos criados/modificados

```
backend/src/
├── RepBrasil.Application/
│   ├── RepBrasil.Application.csproj   (adicionar referência a EF Core para ILike)
│   ├── Common/
│   │   └── PagedResult.cs
│   ├── Politicians/
│   │   ├── DTOs/
│   │   │   ├── PoliticianSummaryDto.cs
│   │   │   └── PoliticianDetailDto.cs
│   │   └── Queries/
│   │       ├── SearchPoliticiansQuery.cs
│   │       └── GetPoliticianByIdQuery.cs
│   └── Interfaces/
│       └── IPoliticianRepository.cs
└── RepBrasil.Infrastructure/
    └── Repositories/
        └── PoliticianRepository.cs
```

---

## Steps

- [ ] **1. Criar `src/RepBrasil.Application/Common/PagedResult.cs`**

```csharp
namespace RepBrasil.Application.Common;

public record PagedResult<T>(
    IReadOnlyList<T> Items,
    int TotalCount,
    int Page,
    int PageSize
)
{
    public int TotalPages => (int)Math.Ceiling((double)TotalCount / PageSize);
    public bool HasNext => Page < TotalPages;
    public bool HasPrevious => Page > 1;
}
```

- [ ] **2. Criar `src/RepBrasil.Application/Politicians/DTOs/PoliticianSummaryDto.cs`**

```csharp
using RepBrasil.Domain.Entities;

namespace RepBrasil.Application.Politicians.DTOs;

public record PoliticianSummaryDto(
    Guid Id,
    string Name,
    string BallotName,
    string? TseId
)
{
    public static PoliticianSummaryDto FromEntity(Politician p) =>
        new(p.Id, p.Name, p.BallotName, p.TseId);
}
```

- [ ] **3. Criar `src/RepBrasil.Application/Politicians/DTOs/PoliticianDetailDto.cs`**

```csharp
using RepBrasil.Domain.Entities;

namespace RepBrasil.Application.Politicians.DTOs;

public record PoliticianDetailDto(
    Guid Id,
    string Name,
    string BallotName,
    string? TseId,
    string? CamaraId,
    string? SenateId,
    DateTime CreatedAt,
    DateTime? SourceUpdatedAt
)
{
    public static PoliticianDetailDto FromEntity(Politician p) =>
        new(p.Id, p.Name, p.BallotName, p.TseId, p.CamaraId, p.SenateId,
            p.CreatedAt, p.SourceUpdatedAt);
}
```

- [ ] **4. Criar `src/RepBrasil.Application/Interfaces/IPoliticianRepository.cs`**

```csharp
using RepBrasil.Application.Common;
using RepBrasil.Domain.Entities;

namespace RepBrasil.Application.Interfaces;

public interface IPoliticianRepository
{
    Task<PagedResult<Politician>> SearchAsync(
        string? query,
        int page,
        int pageSize,
        CancellationToken ct = default);

    Task<Politician?> GetByIdAsync(Guid id, CancellationToken ct = default);
}
```

- [ ] **5. Criar `src/RepBrasil.Application/Politicians/Queries/SearchPoliticiansQuery.cs`**

```csharp
using RepBrasil.Application.Common;
using RepBrasil.Application.Interfaces;
using RepBrasil.Application.Politicians.DTOs;

namespace RepBrasil.Application.Politicians.Queries;

public class SearchPoliticiansQuery(IPoliticianRepository repository)
{
    public async Task<PagedResult<PoliticianSummaryDto>> ExecuteAsync(
        string? query,
        int page = 1,
        int pageSize = 20,
        CancellationToken ct = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var result = await repository.SearchAsync(query, page, pageSize, ct);
        var dtos = result.Items.Select(PoliticianSummaryDto.FromEntity).ToList();
        return new PagedResult<PoliticianSummaryDto>(dtos, result.TotalCount, page, pageSize);
    }
}
```

- [ ] **6. Criar `src/RepBrasil.Application/Politicians/Queries/GetPoliticianByIdQuery.cs`**

```csharp
using RepBrasil.Application.Interfaces;
using RepBrasil.Application.Politicians.DTOs;

namespace RepBrasil.Application.Politicians.Queries;

public class GetPoliticianByIdQuery(IPoliticianRepository repository)
{
    public async Task<PoliticianDetailDto?> ExecuteAsync(Guid id, CancellationToken ct = default)
    {
        var politician = await repository.GetByIdAsync(id, ct);
        return politician is null ? null : PoliticianDetailDto.FromEntity(politician);
    }
}
```

- [ ] **7. Criar `src/RepBrasil.Infrastructure/Repositories/PoliticianRepository.cs`**

```csharp
using Microsoft.EntityFrameworkCore;
using RepBrasil.Application.Common;
using RepBrasil.Application.Interfaces;
using RepBrasil.Domain.Entities;
using RepBrasil.Infrastructure.Persistence;

namespace RepBrasil.Infrastructure.Repositories;

public class PoliticianRepository(ApplicationDbContext db) : IPoliticianRepository
{
    public async Task<PagedResult<Politician>> SearchAsync(
        string? query,
        int page,
        int pageSize,
        CancellationToken ct = default)
    {
        var q = db.Politicians.AsQueryable();

        if (!string.IsNullOrWhiteSpace(query))
        {
            var pattern = $"%{query.Trim()}%";
            q = q.Where(p =>
                EF.Functions.ILike(p.Name, pattern) ||
                EF.Functions.ILike(p.BallotName, pattern));
        }

        var total = await q.CountAsync(ct);
        var items = await q
            .OrderBy(p => p.Name)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct);

        return new PagedResult<Politician>(items, total, page, pageSize);
    }

    public async Task<Politician?> GetByIdAsync(Guid id, CancellationToken ct = default) =>
        await db.Politicians.FirstOrDefaultAsync(p => p.Id == id, ct);
}
```

- [ ] **8. Registrar no DI em `Program.cs`**

Adicionar em `src/RepBrasil.API/Program.cs`, após o `builder.Services.AddControllers()`:

```csharp
using RepBrasil.Application.Interfaces;
using RepBrasil.Application.Politicians.Queries;
using RepBrasil.Infrastructure.Repositories;

// ...
builder.Services.AddScoped<IPoliticianRepository, PoliticianRepository>();
builder.Services.AddScoped<SearchPoliticiansQuery>();
builder.Services.AddScoped<GetPoliticianByIdQuery>();
```

- [ ] **9. Compilar**

```bash
cd backend
dotnet build
```

Esperado: `Build succeeded. 0 Warning(s) 0 Error(s)`

- [ ] **10. Commit**

```bash
cd ..
git add backend/
git commit -m "feat(backend): application layer — IPoliticianRepository, DTOs, SearchPoliticians, GetPoliticianById"
git push
```

---

## Critérios de sucesso

- [ ] `dotnet build` — sem erros
- [ ] `IPoliticianRepository` tem `SearchAsync` e `GetByIdAsync`
- [ ] `PoliticianRepository` implementa busca por ILIKE em `Name` e `BallotName`
- [ ] `PagedResult<T>` tem `TotalPages`, `HasNext`, `HasPrevious`
- [ ] `PoliticianSummaryDto` e `PoliticianDetailDto` têm `FromEntity()` estático
- [ ] DI registrado no `Program.cs`

---

## Riscos / Pontos de atenção

| Risco | Mitigação |
|-------|-----------|
| `EF.Functions.ILike` requer Npgsql | Já instalado em Infrastructure |
| Application referenciando EF Core diretamente | `EF.Functions.ILike` está na interface do repositório — a query usa apenas a abstração `IPoliticianRepository` |
| Paginação com offset lenta em tabelas grandes | Aceitável para Fase 1 com volume pequeno de candidatos |
| `HasQueryFilter(DeletedAt == null)` filtra automaticamente | Correto — soft-deleted politicians não aparecem nas buscas |
