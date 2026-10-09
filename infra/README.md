# Infraestrutura Local

Docker Compose com PostgreSQL, Redis e Neo4j para desenvolvimento local.

## Pré-requisitos

- Docker Desktop (Windows/macOS) ou Docker Engine (Linux)
- Docker Compose v2

## Setup

```bash
cd infra

# 1. Copiar variáveis de ambiente
cp .env.example .env

# 2. Subir todos os serviços
docker compose up -d
```

O PostgreSQL usa a imagem `postgis/postgis:16-3.4` (mesma versão maior do PostgreSQL 16): a
migration `AddElectoralIntelligence` cria o schema `electoral` com PostGIS. Um volume criado com
`postgres:16` continua compatível — só passa a ter a extensão disponível.

## Verificar status

```bash
docker compose ps
```

Todos os serviços devem estar com status `healthy`.

## Portas

| Serviço | Porta | Uso |
|---------|-------|-----|
| PostgreSQL | 5432 | Backend (.NET) e ETL (Python) |
| Redis | 6379 | Cache da API |
| Neo4j Browser | 7474 | Interface visual do grafo |
| Neo4j Bolt | 7687 | Driver de aplicação |

## Acessar Neo4j Browser

Abrir `http://localhost:7474` no browser.
Login: usuário `neo4j`, senha `repbrasil` (conforme `.env`).

## Parar serviços

```bash
docker compose down
```

## Parar e remover dados (reset completo)

```bash
docker compose down -v
```

> **Atenção:** `-v` remove os volumes. Use apenas para reset total em desenvolvimento.

## Produção

Em produção (Railway):
- PostgreSQL e Redis são serviços gerenciados do Railway.
- Neo4j usa Neo4j Aura (gerenciado) ou container dedicado.
- Ver [deploy/railway.md](../deploy/railway.md).
