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
