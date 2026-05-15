# ADR-005 — ETL em Python com uv e Polars

**Status:** Aceito
**Data:** 2026-05-15

## Contexto

O ETL precisa coletar dados de dezenas de fontes governamentais com formatos
heterogêneos (CSV, JSON, XML, API REST), transformar e carregar no PostgreSQL
e Neo4j. A equipe fundadora tem familiaridade com Python para data engineering.

## Decisão

- **Python 3.12** como linguagem do ETL.
- **uv** como gerenciador de pacotes e ambientes virtuais (mais rápido que pip/poetry).
- **Polars** para transformação de dados (mais rápido que Pandas para datasets grandes).
- **Pydantic v2** para validação de schema de dados coletados.
- **httpx** para chamadas HTTP assíncronas às APIs governamentais.
- **Loguru** para logs estruturados nos pipelines.
- **Tenacity** para retry automático em falhas de rede.
- **pytest + ruff + mypy** para qualidade do código.

## Estrutura dos pipelines

Cada fonte implementa `BasePipeline` com três métodos: `collect()`, `transform()`, `load()`.

## Consequências

- Pipelines são independentes: falha em uma fonte não afeta outras.
- `uv sync` instala todas as dependências de forma determinística.
- Versão Python fixada em `.python-version` (3.12).
- Airflow/Dagster a avaliar na Fase 5 para orquestração.
