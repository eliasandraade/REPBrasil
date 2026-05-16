# REPBrasil Fase 1 — Bloco 2: ETL — TseCandidatesPipeline

> **Para execução:** Use `superpowers:subagent-driven-development` ou `superpowers:executing-plans`.
> **Depende de:** Bloco 1 (tabela `Politicians` no PostgreSQL). Python 3.12 + uv instalados.

**Objetivo:** Implementar o `TseCandidatesPipeline` que baixa o CSV de candidatos do TSE (eleição 2024), parseia com Polars, normaliza para `PoliticianSchema` e insere no PostgreSQL. Inclui logging com loguru, tratamento de erros e testes mínimos com pytest.

---

## Fonte de dados

**URL:** `https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2024.zip`

O ZIP contém o arquivo `consulta_cand_2024_BRASIL.csv` com:
- Separador: `;`
- Encoding: `ISO-8859-1` (Latin-1)
- ~30 colunas; as relevantes para Fase 1:

| Coluna TSE | Campo interno |
|---|---|
| `SQ_CANDIDATO` | `tse_id` |
| `NM_CANDIDATO` | `name` |
| `NM_URNA_CANDIDATO` | `ballot_name` |
| `SG_UF` | `state` (novo campo — ver abaixo) |
| `SG_PARTIDO` | `party_acronym` (novo campo) |
| `NM_PARTIDO` | `party_name` (novo campo) |
| `DS_CARGO` | `office` (novo campo) |
| `DS_SITUACAO_CANDIDATURA` | `candidacy_status` (novo campo) |
| `NR_CPF_CANDIDATO` | ignorado em Fase 1 (privacidade) |

---

## Decisões arquiteturais

- **Download via `httpx`**: async com retry via `tenacity`. O ZIP do TSE tem ~50MB — baixar uma vez e cachear em `data/raw/tse/`.
- **Parse via `Polars`**: lê o CSV diretamente do ZIP extraído. Filtra linhas com status de candidatura válido.
- **Inserção via `psycopg2`**: inserção direta no PostgreSQL sem ORM. Mais simples e rápido para carga em lote. Usa `ON CONFLICT DO NOTHING` baseado em `tse_id` para idempotência.
- **`PoliticianSchema` estendido**: adicionar campos de contexto eleitoral (`state`, `party_acronym`, `party_name`, `office`, `candidacy_status`). Esses campos existem na entidade `Politician` do backend como extensão futura — por ora, o ETL insere apenas os campos que o backend já tem.
- **Campos mapeados para a tabela `Politicians`**: `Id` (UUID gerado), `Name`, `BallotName`, `TseId`, `CreatedAt`, `UpdatedAt`, `SourceUpdatedAt`.
- **Limite de registros em teste**: usar `--limit N` para carregar apenas N políticos em desenvolvimento.
- **`data/raw/tse/`**: diretório de cache já no `.gitignore`. O pipeline verifica se o arquivo já existe antes de baixar novamente.

---

## Arquivos criados/modificados

```
etl/
├── pyproject.toml          (adicionar psycopg2-binary, pytest-mock)
├── src/
│   ├── sources/
│   │   └── tse/
│   │       ├── __init__.py     (substituir placeholder)
│   │       ├── candidates.py   (TseCandidatesPipeline)
│   │       └── downloader.py   (download e extração do ZIP)
│   ├── models/
│   │   └── politician.py       (estender PoliticianSchema)
│   └── db/
│       ├── __init__.py
│       └── connection.py       (conexão PostgreSQL)
└── tests/
    └── sources/
        └── tse/
            ├── __init__.py
            └── test_candidates.py
```

---

## Steps

- [ ] **1. Adicionar dependências ao `etl/pyproject.toml`**

Em `dependencies`:
```toml
"psycopg2-binary>=2.9.0",
```

Em `[project.optional-dependencies] dev`:
```toml
"pytest-mock>=3.12.0",
```

Rodar: `uv sync --extra dev`

- [ ] **2. Criar `etl/src/db/__init__.py`**

```python
```
(arquivo vazio)

- [ ] **3. Criar `etl/src/db/connection.py`**

```python
import os
from contextlib import contextmanager
from typing import Generator

import psycopg2
from psycopg2.extensions import connection as PgConnection


def get_connection_string() -> str:
    return os.environ.get(
        "DATABASE_URL",
        "host=localhost port=5432 dbname=repbrasil user=repbrasil password=repbrasil",
    )


@contextmanager
def get_db() -> Generator[PgConnection, None, None]:
    conn = psycopg2.connect(get_connection_string())
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
```

- [ ] **4. Criar `etl/src/sources/tse/downloader.py`**

```python
import zipfile
from pathlib import Path

import httpx
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential

TSE_CANDIDATES_URL = (
    "https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2024.zip"
)
RAW_DIR = Path(__file__).parents[5] / "data" / "raw" / "tse"
ZIP_PATH = RAW_DIR / "consulta_cand_2024.zip"
CSV_PATH = RAW_DIR / "consulta_cand_2024_BRASIL.csv"


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=30))
def download_candidates_zip() -> Path:
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    if ZIP_PATH.exists():
        logger.info(f"ZIP já existe em cache: {ZIP_PATH}")
        return ZIP_PATH

    logger.info(f"Baixando candidatos TSE 2024 de {TSE_CANDIDATES_URL}")
    with httpx.stream("GET", TSE_CANDIDATES_URL, follow_redirects=True, timeout=120) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        downloaded = 0
        with open(ZIP_PATH, "wb") as f:
            for chunk in r.iter_bytes(chunk_size=8192):
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded / total * 100
                    logger.debug(f"Download: {pct:.1f}%")

    logger.info(f"Download concluído: {ZIP_PATH}")
    return ZIP_PATH


def extract_candidates_csv() -> Path:
    if CSV_PATH.exists():
        logger.info(f"CSV já extraído: {CSV_PATH}")
        return CSV_PATH

    zip_path = download_candidates_zip()
    logger.info("Extraindo CSV do ZIP...")
    with zipfile.ZipFile(zip_path, "r") as zf:
        names = zf.namelist()
        brasil_csv = next((n for n in names if "BRASIL" in n.upper() and n.endswith(".csv")), None)
        if not brasil_csv:
            raise FileNotFoundError(f"CSV BRASIL não encontrado no ZIP. Arquivos: {names}")
        zf.extract(brasil_csv, RAW_DIR)
        extracted = RAW_DIR / brasil_csv
        if extracted != CSV_PATH:
            extracted.rename(CSV_PATH)

    logger.info(f"CSV extraído: {CSV_PATH}")
    return CSV_PATH
```

- [ ] **5. Criar `etl/src/sources/tse/candidates.py`**

```python
import uuid
from datetime import datetime, UTC
from typing import Any

import polars as pl
from loguru import logger

from src.db.connection import get_db
from src.pipeline.base import BasePipeline
from src.sources.tse.downloader import extract_candidates_csv

VALID_STATUSES = {"APTO", "INAPTO", "DEFERIDO", "DEFERIDO COM RECURSO"}

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
    """Pipeline de coleta de candidatos do TSE — eleição 2024."""

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
        df = raw.select(available).rename({c: COLUMN_MAP[c] for c in available})

        if "candidacy_status" in df.columns:
            df = df.filter(pl.col("candidacy_status").is_in(list(VALID_STATUSES)))

        if self.limit:
            df = df.head(self.limit)

        now = datetime.now(UTC).isoformat()
        records = []
        for row in df.iter_rows(named=True):
            records.append(
                {
                    "id": str(uuid.uuid4()),
                    "name": (row.get("name") or "").strip().title(),
                    "ballot_name": (row.get("ballot_name") or "").strip().title(),
                    "tse_id": str(row.get("tse_id") or "").strip() or None,
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
            INSERT INTO "Politicians" ("Id", "Name", "BallotName", "TseId", "CreatedAt", "UpdatedAt", "SourceUpdatedAt")
            VALUES (%(id)s, %(name)s, %(ballot_name)s, %(tse_id)s, %(created_at)s, %(updated_at)s, %(source_updated_at)s)
            ON CONFLICT ("TseId") DO NOTHING
        """

        with get_db() as conn:
            with conn.cursor() as cur:
                cur.executemany(insert_sql, data)
                logger.info(f"Inseridos/ignorados: {len(data)} registros")
```

- [ ] **6. Atualizar `etl/src/sources/tse/__init__.py`**

```python
from .candidates import TseCandidatesPipeline

__all__ = ["TseCandidatesPipeline"]
```

- [ ] **7. Criar `etl/tests/__init__.py`**

```python
```
(arquivo vazio)

- [ ] **8. Criar `etl/tests/sources/__init__.py`**

```python
```
(arquivo vazio)

- [ ] **9. Criar `etl/tests/sources/tse/__init__.py`**

```python
```
(arquivo vazio)

- [ ] **10. Criar `etl/tests/sources/tse/test_candidates.py`**

```python
import polars as pl
import pytest

from src.sources.tse.candidates import TseCandidatesPipeline


@pytest.fixture
def pipeline() -> TseCandidatesPipeline:
    return TseCandidatesPipeline(limit=10)


@pytest.fixture
def sample_df() -> pl.DataFrame:
    return pl.DataFrame(
        {
            "SQ_CANDIDATO": ["123456", "789012"],
            "NM_CANDIDATO": ["JOAO DA SILVA", "MARIA SOUZA"],
            "NM_URNA_CANDIDATO": ["JOAO SILVA", "MARIA SOUZA"],
            "SG_UF": ["SP", "RJ"],
            "SG_PARTIDO": ["PT", "PSDB"],
            "NM_PARTIDO": ["Partido dos Trabalhadores", "PSDB"],
            "DS_CARGO": ["DEPUTADO FEDERAL", "SENADOR"],
            "DS_SITUACAO_CANDIDATURA": ["APTO", "DEFERIDO"],
        }
    )


def test_transform_returns_list(pipeline: TseCandidatesPipeline, sample_df: pl.DataFrame) -> None:
    result = pipeline.transform(sample_df)
    assert isinstance(result, list)
    assert len(result) == 2


def test_transform_normalizes_names(
    pipeline: TseCandidatesPipeline, sample_df: pl.DataFrame
) -> None:
    result = pipeline.transform(sample_df)
    assert result[0]["name"] == "Joao Da Silva"
    assert result[0]["ballot_name"] == "Joao Silva"


def test_transform_sets_tse_id(
    pipeline: TseCandidatesPipeline, sample_df: pl.DataFrame
) -> None:
    result = pipeline.transform(sample_df)
    assert result[0]["tse_id"] == "123456"


def test_transform_filters_invalid_status(pipeline: TseCandidatesPipeline) -> None:
    df = pl.DataFrame(
        {
            "SQ_CANDIDATO": ["111"],
            "NM_CANDIDATO": ["CANDIDATO INVALIDO"],
            "NM_URNA_CANDIDATO": ["INVALIDO"],
            "DS_SITUACAO_CANDIDATURA": ["INDEFERIDO"],
        }
    )
    result = pipeline.transform(df)
    assert len(result) == 0


def test_transform_generates_uuid(
    pipeline: TseCandidatesPipeline, sample_df: pl.DataFrame
) -> None:
    result = pipeline.transform(sample_df)
    assert len(result[0]["id"]) == 36
```

- [ ] **11. Verificar ferramentas**

```bash
cd etl
uv run ruff check .
uv run mypy src/
uv run pytest tests/
```

Esperado: sem erros de lint/mypy; testes passando.

- [ ] **12. Testar pipeline localmente com limite**

Com Docker rodando:
```bash
uv run python -c "
from src.sources.tse.candidates import TseCandidatesPipeline
p = TseCandidatesPipeline(limit=50)
p.run()
"
```

Esperado: logs mostrando download, transformação e inserção de 50 registros.

Verificar no banco:
```bash
docker exec repbrasil-postgres psql -U repbrasil -d repbrasil \
  -c 'SELECT "Id", "Name", "BallotName", "TseId" FROM "Politicians" LIMIT 5;'
```

- [ ] **13. Adicionar constraint UNIQUE em TseId via migration**

Para o `ON CONFLICT ("TseId")` funcionar, é necessário um índice único. Criar uma nova migration:

```bash
dotnet ef migrations add AddPoliticianTseIdUniqueIndex \
  --project src/RepBrasil.Infrastructure \
  --startup-project src/RepBrasil.API \
  --output-dir Migrations
```

Editar o arquivo de migration gerado para adicionar manualmente:

```csharp
migrationBuilder.CreateIndex(
    name: "IX_Politicians_TseId",
    table: "Politicians",
    column: "TseId",
    unique: true,
    filter: "\"TseId\" IS NOT NULL");
```

Aplicar:
```bash
dotnet ef database update \
  --project src/RepBrasil.Infrastructure \
  --startup-project src/RepBrasil.API
```

- [ ] **14. Commit**

```bash
cd ..
git add etl/ backend/src/RepBrasil.Infrastructure/Migrations/
git commit -m "feat(etl): TseCandidatesPipeline — download TSE 2024, parse Polars, carga PostgreSQL"
git push
```

---

## Critérios de sucesso

- [ ] `uv run ruff check .` — sem erros
- [ ] `uv run mypy src/` — `Success: no issues found`
- [ ] `uv run pytest tests/` — todos os testes passando
- [ ] Pipeline carrega ≥50 políticos no banco com `limit=50`
- [ ] `ON CONFLICT DO NOTHING` funciona (rodar duas vezes não duplica registros)
- [ ] Logs claros com contagem de registros em cada etapa

---

## Riscos / Pontos de atenção

| Risco | Mitigação |
|-------|-----------|
| URL do TSE muda ou arquivo offline | Retry com tenacity; o arquivo 2024 é estável |
| Encoding do CSV (Latin-1) | `encoding="latin1"` no `pl.read_csv()` |
| Nome da coluna diferente do esperado | `available = [c for c in COLUMN_MAP if c in raw.columns]` |
| `ON CONFLICT` falha sem constraint UNIQUE | Step 13 cria o índice via migration |
| Testes falham por dependência do banco | Testes usam apenas a lógica de transformação (sem banco) |
| ZIP muito grande para CI | Testes não fazem download real — apenas transformação com dados mock |
