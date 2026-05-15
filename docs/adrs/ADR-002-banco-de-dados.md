# ADR-002 — Estratégia de armazenamento de dados

**Status:** Aceito
**Data:** 2026-05-15

## Contexto

O REPBrasil precisa armazenar: dados relacionais (políticos, eleições, partidos),
cache de respostas frequentes, grafo de conexões políticas e dados de busca.
Cada necessidade tem características diferentes de acesso e escala.

## Decisão

- **PostgreSQL 16**: banco relacional principal. Armazena todas as entidades do domínio,
  snapshots de score, flags, fontes. Full Text Search para busca no MVP.
- **Redis 7**: cache de respostas da API (perfis, scores) e sessões futuras.
  Sem senha em desenvolvimento local; autenticação obrigatória em produção.
- **Neo4j 5 Community**: grafo de conexões políticas. Armazena nós e arestas tipadas
  com evidências e temporalidade. Expandido progressivamente conforme dados crescem.

## Alternativas consideradas

- **MongoDB**: descartado. Dados relacionais fortes (políticos ↔ partidos ↔ eleições)
  se beneficiam de schema rígido e joins.
- **Elasticsearch**: descartado para MVP. PostgreSQL FTS é suficiente para Fase 1–2.
  OpenSearch/Meilisearch a avaliar na Fase 5.
- **DynamoDB**: descartado. Sem justificativa de escala; adiciona complexidade operacional.

## Consequências

- Ambiente local exige três containers (docker-compose).
- Railway gerencia PostgreSQL e Redis como serviços nativos.
- Neo4j roda como Neo4j Aura (cloud) ou container dedicado em produção.
- Migrações do PostgreSQL via EF Core; schema do Neo4j versionado manualmente.
