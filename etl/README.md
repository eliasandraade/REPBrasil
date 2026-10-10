# REPBrasil ETL

Pipelines de coleta, transformação e carga de dados públicos oficiais.

## Stack

- Python 3.12
- uv (gerenciador de pacotes)
- Polars (transformação de dados)
- Pydantic v2 (validação de schema)
- httpx (chamadas HTTP)
- Loguru (logs estruturados)
- Tenacity (retry automático)

## Setup

```bash
# Instalar dependências
uv sync --extra dev

# Ativar ambiente virtual (opcional — uv run gerencia automaticamente)
source .venv/bin/activate   # Linux/macOS
.venv\Scripts\activate      # Windows
```

## Comandos

```bash
# Lint
uv run ruff check .

# Lint com correção automática
uv run ruff check . --fix

# Typecheck
uv run mypy src/

# Testes
uv run pytest
```

## Estrutura

```
src/
├── sources/          # Um subpacote por fonte de dados
│   ├── tse/          # Tribunal Superior Eleitoral
│   └── camara/       # Câmara dos Deputados
├── models/           # Schemas Pydantic para validação
└── pipeline/         # Classe base e orquestração
```

## Fase atual

**Fase 0 — Fundação.** Nenhum pipeline está funcional.
A estrutura existe para orientar os contribuidores da Fase 1.

## Inteligência eleitoral (`src/electoral`)

Pipeline eleitoral auditado (território TSE↔IBGE, cadastro, Boletim de Urna, sync estadual,
candidaturas e identidade). Escreve no schema `electoral` (conexão com
`search_path = electoral, public`). Comandos e fontes em
[../docs/ELECTORAL_DATA_SOURCES.md](../docs/ELECTORAL_DATA_SOURCES.md); identidade em
[../docs/TSE_IDENTITY.md](../docs/TSE_IDENTITY.md).

Testes de banco: `REPBRASIL_ELECTORAL_TEST_DATABASE_URL` aponta para um banco descartável cujo nome
termina em `_test`, com as migrations EF aplicadas. Sem ela, os testes de banco são pulados.

