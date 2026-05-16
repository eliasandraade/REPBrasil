# Fase 2A — Enriquecimento do Perfil Base: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar dados eleitorais básicos (partido, cargo, UF, status de candidatura) ao perfil do político e à listagem, tornando o perfil TSE completo e a busca filtrável por esses campos.

**Architecture:** Propagação vertical de 5 novos campos da entidade `Politician` até o frontend: migration EF Core com extensão `pg_trgm` e índices GIN, novo UPSERT idempotente no ETL, filtros adicionais (`state`, `party`, `office`) no repositório e controller, e atualização dos componentes React de listagem e perfil.

**Tech Stack:** .NET 8 / EF Core 8 / PostgreSQL 16 (pg_trgm) / Npgsql EF Provider / Python 3 + Polars + psycopg2 / Next.js 15 App Router / TanStack Query v5 / Tailwind CSS

---

## Arquivos modificados / criados

| Arquivo | Ação |
|---|---|
| `backend/src/RepBrasil.Domain/Entities/Politician.cs` | Modificar — adicionar 5 propriedades |
| `backend/src/RepBrasil.Infrastructure/Migrations/XXXXXXXX_AddPoliticianElectoralFields.cs` | Criar (gerado + editado manualmente) |
| `backend/src/RepBrasil.Infrastructure/Migrations/ApplicationDbContextModelSnapshot.cs` | Atualizar (gerado automaticamente) |
| `backend/src/RepBrasil.Application/Politicians/DTOs/PoliticianSummaryDto.cs` | Modificar — adicionar party_acronym, office, state |
| `backend/src/RepBrasil.Application/Politicians/DTOs/PoliticianDetailDto.cs` | Modificar — adicionar todos os 5 campos |
| `backend/src/RepBrasil.Application/Interfaces/IPoliticianRepository.cs` | Modificar — novos params em SearchAsync |
| `backend/src/RepBrasil.Application/Politicians/Queries/SearchPoliticiansQuery.cs` | Modificar — receber e repassar state/party/office |
| `backend/src/RepBrasil.Infrastructure/Repositories/PoliticianRepository.cs` | Modificar — filtros por state/party/office |
| `backend/src/RepBrasil.API/Controllers/PoliticiansController.cs` | Modificar — novos query params |
| `backend/src/RepBrasil.API/appsettings.Development.json` | Modificar — Kestrel porta 5000 |
| `etl/src/sources/tse/candidates.py` | Modificar — novos campos no transform/load UPSERT |
| `etl/tests/sources/tse/test_candidates.py` | Modificar — testes para novos campos |
| `frontend/src/lib/types.ts` | Modificar — novos campos em PoliticianSummary e PoliticianDetail |
| `frontend/src/lib/api.ts` | Modificar — searchPoliticians com filtros state/party/office |
| `frontend/src/components/politicians/PoliticianCard.tsx` | Modificar — exibir partido/cargo/UF |
| `frontend/src/app/politicos/page.tsx` | Modificar — filtros na URL + UI de filtros |
| `frontend/src/components/politicians/PoliticianProfile.tsx` | Modificar — seção dados eleitorais |

---

## Bloco 1: Domain Entity + EF Core Migration

**Contexto:** Adicionar 5 propriedades nullable à entidade `Politician`, gerar a migration com EF CLI, e editar manualmente para incluir `pg_trgm` e índices GIN em `Name` e `BallotName`.

**Files:**
- Modify: `backend/src/RepBrasil.Domain/Entities/Politician.cs`
- Create: `backend/src/RepBrasil.Infrastructure/Migrations/<timestamp>_AddPoliticianElectoralFields.cs`

- [ ] **Passo 1: Adicionar propriedades ao `Politician`**

Substituir o conteúdo completo de `backend/src/RepBrasil.Domain/Entities/Politician.cs`:

```csharp
namespace RepBrasil.Domain.Entities;

public class Politician : AuditableEntity
{
    public string Name { get; set; } = string.Empty;
    public string BallotName { get; set; } = string.Empty;
    public string? TseId { get; set; }
    public string? CamaraId { get; set; }
    public string? SenateId { get; set; }
    public string? State { get; set; }
    public string? PartyAcronym { get; set; }
    public string? PartyName { get; set; }
    public string? Office { get; set; }
    public string? CandidacyStatus { get; set; }
}
```

- [ ] **Passo 2: Gerar a migration**

Executar a partir de `backend/src/RepBrasil.API/`:

```
dotnet ef migrations add AddPoliticianElectoralFields --project ../RepBrasil.Infrastructure
```

Saída esperada:
```
Build succeeded.
Done. To undo this action, use 'ef migrations remove'
```

- [ ] **Passo 3: Verificar o arquivo gerado**

Abrir o arquivo gerado em `backend/src/RepBrasil.Infrastructure/Migrations/<timestamp>_AddPoliticianElectoralFields.cs`. Confirmar que o método `Up()` contém chamadas `AddColumn` para `State`, `PartyAcronym`, `PartyName`, `Office` e `CandidacyStatus`, e o método `Down()` contém as chamadas `DropColumn` correspondentes.

- [ ] **Passo 4: Adicionar pg_trgm e índices GIN à migration**

Editar o método `Up()` para adicionar ao final (antes do fechamento `}`):

```csharp
migrationBuilder.Sql("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
migrationBuilder.Sql(
    @"CREATE INDEX ""IX_Politicians_Name_trgm"" ON ""Politicians"" USING gin (""Name"" gin_trgm_ops);");
migrationBuilder.Sql(
    @"CREATE INDEX ""IX_Politicians_BallotName_trgm"" ON ""Politicians"" USING gin (""BallotName"" gin_trgm_ops);");
```

Editar o método `Down()` para adicionar ao início (antes dos `DropColumn`):

```csharp
migrationBuilder.Sql(@"DROP INDEX IF EXISTS ""IX_Politicians_Name_trgm"";");
migrationBuilder.Sql(@"DROP INDEX IF EXISTS ""IX_Politicians_BallotName_trgm"";");
```

- [ ] **Passo 5: Aplicar a migration**

Com o Docker rodando (`docker compose up -d`), executar a partir de `backend/src/RepBrasil.API/`:

```
dotnet ef database update
```

Saída esperada:
```
Build succeeded.
Applying migration '..._AddPoliticianElectoralFields'.
Done.
```

- [ ] **Passo 6: Build para confirmar compilação**

```
cd backend && dotnet build
```

Saída esperada: `Build succeeded. 0 Warning(s) 0 Error(s)`

- [ ] **Passo 7: Commit**

```
git add backend/src/RepBrasil.Domain/Entities/Politician.cs
git add backend/src/RepBrasil.Infrastructure/Migrations/
git commit -m "feat(backend): adicionar campos eleitorais a Politician, pg_trgm + GIN indexes"
```

---

## Bloco 2: Application Layer — DTOs, Interface e Repositório

**Contexto:** Propagar os novos campos pelos DTOs, atualizar a interface do repositório para aceitar filtros `state`/`party`/`office`, e implementar a filtragem no `PoliticianRepository`. As queries existentes continuam funcionando — novos params são opcionais.

**Files:**
- Modify: `backend/src/RepBrasil.Application/Politicians/DTOs/PoliticianSummaryDto.cs`
- Modify: `backend/src/RepBrasil.Application/Politicians/DTOs/PoliticianDetailDto.cs`
- Modify: `backend/src/RepBrasil.Application/Interfaces/IPoliticianRepository.cs`
- Modify: `backend/src/RepBrasil.Application/Politicians/Queries/SearchPoliticiansQuery.cs`
- Modify: `backend/src/RepBrasil.Infrastructure/Repositories/PoliticianRepository.cs`

- [ ] **Passo 1: Atualizar `PoliticianSummaryDto`**

Substituir o conteúdo completo de `backend/src/RepBrasil.Application/Politicians/DTOs/PoliticianSummaryDto.cs`:

```csharp
using RepBrasil.Domain.Entities;

namespace RepBrasil.Application.Politicians.DTOs;

public record PoliticianSummaryDto(
    Guid Id,
    string Name,
    string BallotName,
    string? TseId,
    string? PartyAcronym,
    string? Office,
    string? State
)
{
    public static PoliticianSummaryDto FromEntity(Politician p) =>
        new(p.Id, p.Name, p.BallotName, p.TseId, p.PartyAcronym, p.Office, p.State);
}
```

- [ ] **Passo 2: Atualizar `PoliticianDetailDto`**

Substituir o conteúdo completo de `backend/src/RepBrasil.Application/Politicians/DTOs/PoliticianDetailDto.cs`:

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
    string? State,
    string? PartyAcronym,
    string? PartyName,
    string? Office,
    string? CandidacyStatus,
    DateTime CreatedAt,
    DateTime? SourceUpdatedAt
)
{
    public static PoliticianDetailDto FromEntity(Politician p) =>
        new(p.Id, p.Name, p.BallotName, p.TseId, p.CamaraId, p.SenateId,
            p.State, p.PartyAcronym, p.PartyName, p.Office, p.CandidacyStatus,
            p.CreatedAt, p.SourceUpdatedAt);
}
```

- [ ] **Passo 3: Atualizar `IPoliticianRepository`**

Substituir o conteúdo completo de `backend/src/RepBrasil.Application/Interfaces/IPoliticianRepository.cs`:

```csharp
using RepBrasil.Application.Common;
using RepBrasil.Domain.Entities;

namespace RepBrasil.Application.Interfaces;

public interface IPoliticianRepository
{
    Task<PagedResult<Politician>> SearchAsync(
        string? query,
        string? state,
        string? party,
        string? office,
        int page,
        int pageSize,
        CancellationToken ct = default);

    Task<Politician?> GetByIdAsync(Guid id, CancellationToken ct = default);
}
```

- [ ] **Passo 4: Atualizar `SearchPoliticiansQuery`**

Substituir o conteúdo completo de `backend/src/RepBrasil.Application/Politicians/Queries/SearchPoliticiansQuery.cs`:

```csharp
using RepBrasil.Application.Common;
using RepBrasil.Application.Interfaces;
using RepBrasil.Application.Politicians.DTOs;

namespace RepBrasil.Application.Politicians.Queries;

public class SearchPoliticiansQuery(IPoliticianRepository repository)
{
    public async Task<PagedResult<PoliticianSummaryDto>> ExecuteAsync(
        string? query,
        string? state,
        string? party,
        string? office,
        int page = 1,
        int pageSize = 20,
        CancellationToken ct = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var result = await repository.SearchAsync(query, state, party, office, page, pageSize, ct);
        var dtos = result.Items.Select(PoliticianSummaryDto.FromEntity).ToList();
        return new PagedResult<PoliticianSummaryDto>(dtos, result.TotalCount, page, pageSize);
    }
}
```

- [ ] **Passo 5: Atualizar `PoliticianRepository`**

Substituir o conteúdo completo de `backend/src/RepBrasil.Infrastructure/Repositories/PoliticianRepository.cs`:

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
        string? state,
        string? party,
        string? office,
        int page,
        int pageSize,
        CancellationToken ct = default)
    {
        var q = db.Politicians.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(query))
        {
            var escaped = query.Trim()
                .Replace(@"\", @"\\")
                .Replace("%", @"\%")
                .Replace("_", @"\_");
            var pattern = $"%{escaped}%";
            q = q.Where(p =>
                EF.Functions.ILike(p.Name, pattern, @"\") ||
                EF.Functions.ILike(p.BallotName, pattern, @"\"));
        }

        if (!string.IsNullOrWhiteSpace(state))
            q = q.Where(p => p.State != null &&
                EF.Functions.ILike(p.State, state.Trim()));

        if (!string.IsNullOrWhiteSpace(party))
            q = q.Where(p => p.PartyAcronym != null &&
                EF.Functions.ILike(p.PartyAcronym, party.Trim()));

        if (!string.IsNullOrWhiteSpace(office))
        {
            var escaped = office.Trim()
                .Replace(@"\", @"\\")
                .Replace("%", @"\%")
                .Replace("_", @"\_");
            var pattern = $"%{escaped}%";
            q = q.Where(p => p.Office != null &&
                EF.Functions.ILike(p.Office, pattern, @"\"));
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
        await db.Politicians.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id, ct);
}
```

- [ ] **Passo 6: Build para confirmar que não há erros de compilação**

```
cd backend && dotnet build
```

Saída esperada: `Build succeeded. 0 Warning(s) 0 Error(s)`

- [ ] **Passo 7: Commit**

```
git add backend/src/RepBrasil.Application/ backend/src/RepBrasil.Infrastructure/Repositories/
git commit -m "feat(backend): propagar campos eleitorais nos DTOs e repositório, filtros state/party/office"
```

---

## Bloco 3: Controller + Configuração de Porta Local

**Contexto:** Atualizar o controller para aceitar os novos parâmetros de filtro, e configurar o Kestrel para rodar em `http://localhost:5000` via `appsettings.Development.json` (o `launchSettings.json` é gitignored, então este arquivo é o ponto canônico para porta local).

**Files:**
- Modify: `backend/src/RepBrasil.API/Controllers/PoliticiansController.cs`
- Modify: `backend/src/RepBrasil.API/appsettings.Development.json`

- [ ] **Passo 1: Atualizar `PoliticiansController`**

Substituir o conteúdo completo de `backend/src/RepBrasil.API/Controllers/PoliticiansController.cs`:

```csharp
using Microsoft.AspNetCore.Mvc;
using RepBrasil.Application.Common;
using RepBrasil.Application.Politicians.DTOs;
using RepBrasil.Application.Politicians.Queries;

namespace RepBrasil.API.Controllers;

[ApiController]
[Route("api/v1/politicians")]
public class PoliticiansController(
    SearchPoliticiansQuery searchQuery,
    GetPoliticianByIdQuery getByIdQuery) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(PagedResult<PoliticianSummaryDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> Search(
        [FromQuery] string? q,
        [FromQuery] string? state,
        [FromQuery] string? party,
        [FromQuery] string? office,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken ct = default)
    {
        var result = await searchQuery.ExecuteAsync(q, state, party, office, page, pageSize, ct);
        return Ok(result);
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(PoliticianDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct = default)
    {
        var result = await getByIdQuery.ExecuteAsync(id, ct);
        if (result is null)
            return NotFound(new { message = $"Político {id} não encontrado." });
        return Ok(result);
    }
}
```

- [ ] **Passo 2: Configurar porta 5000 no `appsettings.Development.json`**

Substituir o conteúdo completo de `backend/src/RepBrasil.API/appsettings.Development.json`:

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Debug",
      "Microsoft.AspNetCore": "Information"
    }
  },
  "Kestrel": {
    "Endpoints": {
      "Http": {
        "Url": "http://localhost:5000"
      }
    }
  }
}
```

- [ ] **Passo 3: Build final do backend**

```
cd backend && dotnet build
```

Saída esperada: `Build succeeded. 0 Warning(s) 0 Error(s)`

- [ ] **Passo 4: Verificar Swagger em http://localhost:5000/swagger**

Iniciar o backend (`dotnet run --project backend/src/RepBrasil.API`), navegar até `http://localhost:5000/swagger` e confirmar que:
- `GET /api/v1/politicians` exibe os novos query params: `state`, `party`, `office`
- `GET /api/v1/politicians/{id}` response schema inclui `state`, `partyAcronym`, `partyName`, `office`, `candidacyStatus`

Encerrar o servidor.

- [ ] **Passo 5: Commit**

```
git add backend/src/RepBrasil.API/Controllers/PoliticiansController.cs
git add backend/src/RepBrasil.API/appsettings.Development.json
git commit -m "feat(backend): filtros state/party/office no controller, porta 5000 via appsettings"
```

---

## Bloco 4: ETL — Novos Campos + UPSERT Idempotente

**Contexto:** O `COLUMN_MAP` em `candidates.py` já mapeia os novos campos do CSV TSE. Precisamos: (1) incluí-los no dict de saída do `transform()`, e (2) mudar o `load()` de `DO NOTHING` para `DO UPDATE SET` para que re-execuções atualizem registros existentes com os novos campos. Os testes precisam verificar o mapeamento dos novos campos.

**Files:**
- Modify: `etl/src/sources/tse/candidates.py`
- Modify: `etl/tests/sources/tse/test_candidates.py`

- [ ] **Passo 1: Escrever o teste de regressão para novos campos antes de alterar o código**

Adicionar ao final de `etl/tests/sources/tse/test_candidates.py`:

```python
def test_transform_includes_electoral_fields(
    pipeline: TseCandidatesPipeline, sample_df: pl.DataFrame
) -> None:
    result = pipeline.transform(sample_df)
    assert result[0]["state"] == "SP"
    assert result[0]["party_acronym"] == "PT"
    assert result[0]["party_name"] == "Partido dos Trabalhadores"
    assert result[0]["office"] == "DEPUTADO FEDERAL"
    assert result[0]["candidacy_status"] == "APTO"


def test_transform_electoral_fields_none_when_columns_missing(
    pipeline: TseCandidatesPipeline,
) -> None:
    df = pl.DataFrame(
        {
            "SQ_CANDIDATO": ["555"],
            "NM_CANDIDATO": ["SEM PARTIDO"],
            "NM_URNA_CANDIDATO": ["SEM PARTIDO"],
            "DS_SITUACAO_CANDIDATURA": ["DEFERIDO"],
        }
    )
    result = pipeline.transform(df)
    assert result[0]["state"] is None
    assert result[0]["party_acronym"] is None
    assert result[0]["party_name"] is None
    assert result[0]["office"] is None


def test_transform_upsert_preserves_created_at_key(
    pipeline: TseCandidatesPipeline, sample_df: pl.DataFrame
) -> None:
    result = pipeline.transform(sample_df)
    assert "created_at" in result[0]
    assert "updated_at" in result[0]
```

- [ ] **Passo 2: Rodar os testes novos — devem falhar**

```
cd etl && .venv/Scripts/python -m pytest tests/sources/tse/test_candidates.py -v -k "electoral"
```

Saída esperada: `FAILED` com `KeyError: 'state'` ou similar.

- [ ] **Passo 3: Atualizar `candidates.py` — transform e load**

Substituir o conteúdo completo de `etl/src/sources/tse/candidates.py`:

```python
import uuid
from datetime import UTC, datetime
from typing import Any

import polars as pl
from loguru import logger

from src.db.connection import get_db
from src.pipeline.base import BasePipeline
from src.sources.tse.downloader import extract_candidates_csv

# "#NE" é o código TSE para registros sem status de situação definido no arquivo consulta_cand_2024_BRASIL.csv
VALID_STATUSES = {"APTO", "INAPTO", "DEFERIDO", "DEFERIDO COM RECURSO", "#NE"}

COLUMN_MAP = {
    "SQ_CANDIDATO": "tse_id",
    "NM_CANDIDATO": "name",
    "NM_URNA_CANDIDATO": "ballot_name",
    "SG_UF": "state",
    "SG_PARTIDO": "party_acronym",
    "NM_PARTIDO": "party_name",
    "DS_CARGO": "office",
    "DS_SITUACAO_CANDIDATURA": "candidacy_status",
}


class TseCandidatesPipeline(BasePipeline):
    """Pipeline de coleta de candidatos do TSE — eleição 2024 (validação técnica Fase 1)."""

    def __init__(self, limit: int | None = None) -> None:
        self.limit = limit

    def collect(self) -> pl.DataFrame:
        csv_path = extract_candidates_csv()
        logger.info(f"Lendo CSV: {csv_path}")
        df = pl.read_csv(
            csv_path,
            separator=";",
            encoding="latin1",
            infer_schema_length=0,
            truncate_ragged_lines=True,
        )
        logger.info(f"Registros brutos: {len(df)}")
        return df

    def transform(self, raw: pl.DataFrame) -> list[dict[str, Any]]:
        available = [c for c in COLUMN_MAP if c in raw.columns]
        missing = [c for c in COLUMN_MAP if c not in raw.columns]
        if missing:
            logger.warning(f"Colunas esperadas ausentes no CSV do TSE: {missing}")
        df = raw.select(available).rename({c: COLUMN_MAP[c] for c in available})

        if "candidacy_status" in df.columns:
            df = df.filter(pl.col("candidacy_status").is_in(list(VALID_STATUSES)))

        if self.limit:
            df = df.head(self.limit)

        now = datetime.now(UTC).isoformat()
        records = []
        for row in df.iter_rows(named=True):
            tse_id = str(row.get("tse_id") or "").strip() or None
            name = (row.get("name") or "").strip().title()
            ballot_name = (row.get("ballot_name") or "").strip().title()
            if tse_id is None:
                logger.warning(f"Registro ignorado: SQ_CANDIDATO vazio para '{name}'")
                continue
            records.append(
                {
                    "id": str(uuid.uuid4()),
                    "name": name,
                    "ballot_name": ballot_name,
                    "tse_id": tse_id,
                    "state": row.get("state") or None,
                    "party_acronym": row.get("party_acronym") or None,
                    "party_name": row.get("party_name") or None,
                    "office": row.get("office") or None,
                    "candidacy_status": row.get("candidacy_status") or None,
                    "created_at": now,
                    "updated_at": now,
                    "source_updated_at": now,
                }
            )

        logger.info(f"Registros após transformação: {len(records)}")
        return records

    def load(self, data: list[dict[str, Any]]) -> None:
        if not data:
            logger.warning("Nenhum registro para carregar.")
            return

        insert_sql = """
            INSERT INTO "Politicians"
                ("Id", "Name", "BallotName", "TseId",
                 "State", "PartyAcronym", "PartyName", "Office", "CandidacyStatus",
                 "CreatedAt", "UpdatedAt", "SourceUpdatedAt")
            VALUES
                (%(id)s, %(name)s, %(ballot_name)s, %(tse_id)s,
                 %(state)s, %(party_acronym)s, %(party_name)s, %(office)s, %(candidacy_status)s,
                 %(created_at)s, %(updated_at)s, %(source_updated_at)s)
            ON CONFLICT ("TseId") WHERE "TseId" IS NOT NULL DO UPDATE SET
                "Name" = EXCLUDED."Name",
                "BallotName" = EXCLUDED."BallotName",
                "State" = EXCLUDED."State",
                "PartyAcronym" = EXCLUDED."PartyAcronym",
                "PartyName" = EXCLUDED."PartyName",
                "Office" = EXCLUDED."Office",
                "CandidacyStatus" = EXCLUDED."CandidacyStatus",
                "UpdatedAt" = EXCLUDED."UpdatedAt",
                "SourceUpdatedAt" = EXCLUDED."SourceUpdatedAt"
        """

        with get_db() as conn:
            with conn.cursor() as cur:
                cur.executemany(insert_sql, data)
                logger.info(
                    f"Submetidos ao banco: {len(data)} registros"
                    " (novos inseridos, existentes atualizados)"
                )
```

- [ ] **Passo 4: Rodar todos os testes ETL**

```
cd etl && .venv/Scripts/python -m pytest tests/ -v
```

Saída esperada: todos os testes passando incluindo os 3 novos:
```
tests/sources/tse/test_candidates.py::test_transform_includes_electoral_fields PASSED
tests/sources/tse/test_candidates.py::test_transform_electoral_fields_none_when_columns_missing PASSED
tests/sources/tse/test_candidates.py::test_transform_upsert_preserves_created_at_key PASSED
```

- [ ] **Passo 5: Commit**

```
git add etl/src/sources/tse/candidates.py etl/tests/sources/tse/test_candidates.py
git commit -m "feat(etl): persistir campos eleitorais, UPSERT idempotente com DO UPDATE SET"
```

---

## Bloco 5: Frontend — Types e API Client

**Contexto:** Atualizar os tipos TypeScript e a função `searchPoliticians` para incluir os novos campos e filtros. Todos os callers de `searchPoliticians` precisam ser atualizados.

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/api.ts`

- [ ] **Passo 1: Atualizar `types.ts`**

Substituir o conteúdo completo de `frontend/src/lib/types.ts`:

```typescript
export interface PoliticianSummary {
  id: string;
  name: string;
  ballotName: string;
  tseId: string | null;
  partyAcronym: string | null;
  office: string | null;
  state: string | null;
}

export interface PoliticianDetail {
  id: string;
  name: string;
  ballotName: string;
  tseId: string | null;
  camaraId: string | null;
  senateId: string | null;
  state: string | null;
  partyAcronym: string | null;
  partyName: string | null;
  office: string | null;
  candidacyStatus: string | null;
  createdAt: string;
  sourceUpdatedAt: string | null;
}

export interface PagedResult<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface SearchFilters {
  state?: string;
  party?: string;
  office?: string;
}
```

- [ ] **Passo 2: Atualizar `api.ts`**

Substituir o conteúdo completo de `frontend/src/lib/api.ts`:

```typescript
import type { PagedResult, PoliticianDetail, PoliticianSummary, SearchFilters } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${path}${body ? ` — ${body}` : ""}`);
  }
  return res.json() as Promise<T>;
}

export function searchPoliticians(
  query: string,
  page: number,
  pageSize = 20,
  filters: SearchFilters = {},
): Promise<PagedResult<PoliticianSummary>> {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    pageSize: String(pageSize),
  });
  if (filters.state) params.set("state", filters.state);
  if (filters.party) params.set("party", filters.party);
  if (filters.office) params.set("office", filters.office);
  return fetchJson<PagedResult<PoliticianSummary>>(`/api/v1/politicians?${params}`);
}

export function getPolitician(id: string): Promise<PoliticianDetail> {
  return fetchJson<PoliticianDetail>(`/api/v1/politicians/${id}`);
}
```

- [ ] **Passo 3: Verificar compilação TypeScript**

```
cd frontend && npx tsc --noEmit
```

Saída esperada: nenhum erro. Se houver erros em `politicos/page.tsx` referentes ao `searchPoliticians`, eles serão corrigidos no Bloco 6.

- [ ] **Passo 4: Commit**

```
git add frontend/src/lib/types.ts frontend/src/lib/api.ts
git commit -m "feat(frontend): tipos e API client com campos eleitorais e filtros state/party/office"
```

---

## Bloco 6: Frontend — Listagem com Filtros e Card Atualizado

**Contexto:** Atualizar `PoliticianCard` para exibir partido/cargo/UF, e a página `/politicos` para ler e persistir filtros na URL como query params, incluindo UI de filtros abaixo do campo de busca.

**Files:**
- Modify: `frontend/src/components/politicians/PoliticianCard.tsx`
- Modify: `frontend/src/app/politicos/page.tsx`

- [ ] **Passo 1: Atualizar `PoliticianCard`**

Substituir o conteúdo completo de `frontend/src/components/politicians/PoliticianCard.tsx`:

```typescript
import Link from "next/link";
import type { PoliticianSummary } from "@/lib/types";

interface PoliticianCardProps {
  politician: PoliticianSummary;
}

export function PoliticianCard({ politician }: PoliticianCardProps) {
  const meta = [politician.office, politician.partyAcronym, politician.state]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href={`/politico/${politician.id}`}
      className="block p-4 border border-slate-200 rounded-lg hover:border-brand-500 hover:shadow-sm transition-all"
    >
      <p className="font-semibold text-slate-900">{politician.ballotName}</p>
      <p className="text-sm text-slate-500">{politician.name}</p>
      {meta && <p className="text-xs text-slate-400 mt-1">{meta}</p>}
    </Link>
  );
}
```

- [ ] **Passo 2: Atualizar `PoliticosPage` com filtros na URL**

Substituir o conteúdo completo de `frontend/src/app/politicos/page.tsx`:

```typescript
"use client";

import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PoliticianCard } from "@/components/politicians/PoliticianCard";
import { SearchInput } from "@/components/politicians/SearchInput";
import { searchPoliticians } from "@/lib/api";
import type { SearchFilters } from "@/lib/types";

const ESTADOS_BR = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA",
  "MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN",
  "RS","RO","RR","SC","SP","SE","TO",
];

function PoliticosContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const q = searchParams.get("q") ?? "";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const filters: SearchFilters = {
    state: searchParams.get("state") ?? undefined,
    party: searchParams.get("party") ?? undefined,
    office: searchParams.get("office") ?? undefined,
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ["politicians", q, page, filters.state, filters.party, filters.office],
    queryFn: () => searchPoliticians(q, page, 20, filters),
  });

  function buildParams(overrides: Record<string, string | undefined>) {
    const next = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      q,
      page: "1",
      state: filters.state,
      party: filters.party,
      office: filters.office,
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v) next.set(k, v);
    }
    return next.toString();
  }

  function goToPage(newPage: number) {
    router.push(`/politicos?${buildParams({ page: String(newPage) })}`);
  }

  function setFilter(key: keyof SearchFilters, value: string) {
    router.push(`/politicos?${buildParams({ [key]: value || undefined, page: "1" })}`);
  }

  const hasFilters = !!(filters.state || filters.party || filters.office);

  return (
    <main className="min-h-screen px-4 py-12 max-w-3xl mx-auto">
      <div className="mb-8 space-y-4">
        <Link href="/" className="text-sm text-slate-400 hover:text-slate-600">
          ← REPBrasil
        </Link>
        <SearchInput defaultValue={q} />

        {/* Filtros */}
        <div className="flex flex-wrap gap-3">
          <select
            value={filters.state ?? ""}
            onChange={(e) => setFilter("state", e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">Todos os estados</option>
            {ESTADOS_BR.map((uf) => (
              <option key={uf} value={uf}>{uf}</option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Partido (ex: PT)"
            value={filters.party ?? ""}
            onChange={(e) => setFilter("party", e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500 w-36"
          />

          <input
            type="text"
            placeholder="Cargo (ex: SENADOR)"
            value={filters.office ?? ""}
            onChange={(e) => setFilter("office", e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500 w-48"
          />

          {hasFilters && (
            <button
              type="button"
              onClick={() => router.push(`/politicos?${buildParams({ state: undefined, party: undefined, office: undefined })}`)}
              className="text-sm text-slate-400 hover:text-slate-600 px-3 py-2"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {isLoading && (
        <p className="text-slate-500 text-center py-12">Buscando...</p>
      )}

      {isError && (
        <p className="text-red-500 text-center py-12">
          Erro ao buscar políticos. Verifique se a API está rodando.
        </p>
      )}

      {data && (
        <>
          <p className="text-sm text-slate-400 mb-4">
            {data.totalCount} resultado{data.totalCount !== 1 ? "s" : ""}
            {q ? ` para "${q}"` : ""}
          </p>

          {data.items.length === 0 ? (
            <p className="text-slate-500 text-center py-12">
              Nenhum político encontrado{q ? ` para "${q}"` : ""}
              {hasFilters ? " com os filtros selecionados" : ""}.
            </p>
          ) : (
            <div className="space-y-2">
              {data.items.map((p) => (
                <PoliticianCard key={p.id} politician={p} />
              ))}
            </div>
          )}

          {(data.hasPrevious || data.hasNext) && (
            <div className="flex justify-between mt-8">
              <button
                type="button"
                onClick={() => goToPage(page - 1)}
                disabled={!data.hasPrevious}
                className="px-4 py-2 text-sm border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50"
              >
                ← Anterior
              </button>
              <span className="text-sm text-slate-400 self-center">
                Página {data.page} de {data.totalPages}
              </span>
              <button
                type="button"
                onClick={() => goToPage(page + 1)}
                disabled={!data.hasNext}
                className="px-4 py-2 text-sm border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50"
              >
                Próxima →
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}

export default function PoliticosPage() {
  return (
    <Suspense fallback={<p className="text-slate-500 text-center py-12">Carregando...</p>}>
      <PoliticosContent />
    </Suspense>
  );
}
```

- [ ] **Passo 3: Verificar compilação TypeScript**

```
cd frontend && npx tsc --noEmit
```

Saída esperada: nenhum erro.

- [ ] **Passo 4: Commit**

```
git add frontend/src/components/politicians/PoliticianCard.tsx
git add frontend/src/app/politicos/page.tsx
git commit -m "feat(frontend): card com partido/cargo/UF, filtros state/party/office na URL"
```

---

## Bloco 7: Frontend — Perfil Atualizado

**Contexto:** Atualizar `PoliticianProfile` para exibir os novos campos eleitorais em uma seção dedicada, melhorar o placeholder do Score Público, e tratar `#NE` como ausente de informação.

**Files:**
- Modify: `frontend/src/components/politicians/PoliticianProfile.tsx`

- [ ] **Passo 1: Atualizar `PoliticianProfile`**

Substituir o conteúdo completo de `frontend/src/components/politicians/PoliticianProfile.tsx`:

```typescript
import type { PoliticianDetail } from "@/lib/types";

interface PoliticianProfileProps {
  politician: PoliticianDetail;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
}

function formatStatus(status: string | null): string {
  if (!status || status === "#NE") return "—";
  return status
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function PoliticianProfile({ politician }: PoliticianProfileProps) {
  const partyLabel = [politician.partyAcronym, politician.partyName]
    .filter(Boolean)
    .join(" — ");

  return (
    <div className="space-y-8">
      {/* Identidade */}
      <section className="space-y-1">
        <h1 className="text-3xl font-bold text-slate-900">{politician.ballotName}</h1>
        <p className="text-lg text-slate-500">{politician.name}</p>
      </section>

      {/* Dados eleitorais */}
      <section className="border border-slate-200 rounded-lg divide-y divide-slate-100">
        <div className="px-4 py-3">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
            Dados eleitorais — TSE 2024
          </p>
        </div>
        <Row label="Cargo" value={politician.office} />
        <Row label="Partido" value={partyLabel || null} />
        <Row label="UF" value={politician.state} />
        <Row label="Situação da candidatura" value={formatStatus(politician.candidacyStatus)} />
      </section>

      {/* IDs externos */}
      <section className="border border-slate-200 rounded-lg divide-y divide-slate-100">
        <div className="px-4 py-3">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
            Identificadores externos
          </p>
        </div>
        <Row label="ID TSE" value={politician.tseId} />
        <Row label="ID Câmara" value={politician.camaraId} />
        <Row label="ID Senado" value={politician.senateId} />
      </section>

      {/* Metadados */}
      <section className="border border-slate-200 rounded-lg divide-y divide-slate-100">
        <div className="px-4 py-3">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
            Dados de coleta
          </p>
        </div>
        <Row label="Dados coletados em" value={formatDate(politician.sourceUpdatedAt)} />
        <Row label="Registrado em" value={formatDate(politician.createdAt)} />
      </section>

      {/* Score — placeholder */}
      <section className="border border-dashed border-slate-300 rounded-lg p-6 text-center">
        <p className="text-slate-400 text-sm font-medium">Score Público de Transparência</p>
        <p className="text-slate-300 text-4xl font-bold mt-1">—</p>
        <p className="text-slate-400 text-xs mt-2">
          Disponível quando votações e gastos forem integrados.
        </p>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="px-4 py-3 flex justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-900 font-medium">{value ?? "—"}</span>
    </div>
  );
}
```

- [ ] **Passo 2: Verificar compilação TypeScript completa**

```
cd frontend && npx tsc --noEmit
```

Saída esperada: nenhum erro.

- [ ] **Passo 3: Build de produção**

```
cd frontend && npm run build
```

Saída esperada: `✓ Compiled successfully` sem erros TypeScript.

- [ ] **Passo 4: Commit**

```
git add frontend/src/components/politicians/PoliticianProfile.tsx
git commit -m "feat(frontend): perfil com dados eleitorais TSE, formatação de status e partido"
```

---

## Bloco 8: Verificação Final E2E

**Contexto:** Rodar o stack completo (Docker + API + Frontend) e re-executar o ETL para popular os novos campos. Verificar o fluxo completo: busca com filtros → listagem → perfil com dados eleitorais.

**Files:** Nenhum — apenas verificação.

- [ ] **Passo 1: Iniciar o stack**

```
docker compose up -d
dotnet run --project backend/src/RepBrasil.API &
cd frontend && npm run dev &
```

Confirmar que API responde em `http://localhost:5000/health` e frontend em `http://localhost:3000`.

- [ ] **Passo 2: Re-executar o ETL**

```
cd etl && .venv/Scripts/python -m src.main
```

Aguardar conclusão. O log deve mostrar registros atualizados (não "0 registros"):
```
INFO | Submetidos ao banco: 463809 registros (novos inseridos, existentes atualizados)
```

- [ ] **Passo 3: Verificar API diretamente**

```
curl "http://localhost:5000/api/v1/politicians?q=lula&pageSize=1"
```

Confirmar que a resposta inclui `partyAcronym`, `office`, `state` com valores reais (não null).

```
curl "http://localhost:5000/api/v1/politicians?state=SP&party=PT&pageSize=3"
```

Confirmar que retorna apenas políticos do PT em SP.

- [ ] **Passo 4: Verificar frontend — busca com filtros**

Navegar para `http://localhost:3000/politicos`. Selecionar um estado no dropdown (ex: SP). Verificar que a URL muda para `?state=SP` e os cards mostram partido/cargo/UF.

- [ ] **Passo 5: Verificar frontend — perfil**

Clicar em um político. Verificar que a seção "Dados eleitorais" exibe cargo, partido, UF e situação da candidatura com valores reais.

- [ ] **Passo 6: Verificar filtro por partido**

Digitar "PT" no campo partido. Confirmar que os resultados são filtrados. Clicar em um perfil e confirmar que Partido mostra "PT — Partido dos Trabalhadores".

- [ ] **Passo 7: Commit final e push**

```
git push
```

---

## Notas de Implementação

**pg_trgm e performance:** Os índices GIN trigram aceleram automaticamente as queries `ILIKE '%pattern%'` em `Name` e `BallotName` sem mudança de código no repositório. O PostgreSQL usa o índice quando o padrão tem ≥ 3 caracteres.

**Filtro `party` por sigla:** O filtro `party` aplica `ILike` exato na coluna `PartyAcronym` (ex: `ILike(p.PartyAcronym, "PT")`). É case-insensitive. Usuários devem digitar a sigla (PT, MDB, PL) e não o nome completo.

**UPSERT idempotente:** A re-execução do ETL agora atualiza os campos eleitorais de registros existentes. `CreatedAt` nunca é sobrescrito (não está no `DO UPDATE SET`). `Id` nunca muda.

**`#NE` no frontend:** O status `#NE` ("Não especificado" no TSE) é tratado pela função `formatStatus` como `"—"`. Não expor a sigla interna para o usuário.
