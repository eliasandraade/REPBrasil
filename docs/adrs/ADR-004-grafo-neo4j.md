# ADR-004 — Grafo de conexões políticas com Neo4j

**Status:** Aceito
**Data:** 2026-05-15

## Contexto

Conexões políticas (político ↔ empresa ↔ partido ↔ município ↔ familiar)
são naturalmente um grafo. Consultas como "quais empresas receberam contratos
de municípios onde este político concentrou emendas?" são complexas em SQL
mas naturais em Cypher.

## Decisão

**Neo4j 5 Community** para o grafo de conexões políticas.

- Expansão progressiva: o grafo começa com conexões diretas e confirmadas.
- Níveis de confiança por aresta: `Confirmado` / `Provável` / `Inconclusivo`.
- Somente relações `Confirmado` impactam o score diretamente.
- Conexões indiretas aparecem visualmente no grafo mas **NÃO** impactam diretamente o score.
- Evidências são propriedades das arestas (fonte, data, URL).
- Temporalidade: cada aresta tem `startDate` e `endDate`.

## Alternativas consideradas

- **PostgreSQL com tabela de adjacências**: funciona para grafos pequenos, mas
  consultas de múltiplos saltos tornam-se impraticáveis.
- **Apache AGE (PostgreSQL extension)**: promissor, mas menos maduro e com menor
  ecossistema de ferramentas de visualização.

## Consequências

- Ambiente local requer Neo4j no docker-compose.
- Em produção: Neo4j Aura (opção gerenciada) ou container dedicado no Railway.
- Schema de grafo versionado manualmente em `graph/schema.md`.
- Visualização no frontend usa carregamento progressivo para não bloquear o render.
