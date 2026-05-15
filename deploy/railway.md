# Deploy no Railway

Guia de deploy futuro da plataforma REPBrasil no Railway.

## Arquitetura de serviços

O Railway permite criar múltiplos serviços a partir do mesmo repositório,
cada um apontando para uma pasta diferente.

```
REPBrasil (monorepo)
├── frontend/    → Serviço: repbrasil-frontend
├── backend/     → Serviço: repbrasil-api
├── etl/         → Serviço: repbrasil-etl (jobs agendados)
└── infra/       → Apenas uso local — não faz deploy
```

## Serviços planejados

### repbrasil-frontend (Next.js)

- Root directory: `frontend`
- Build command: `npm run build`
- Start command: `npm start`
- Variáveis: `NEXT_PUBLIC_API_URL` apontando para o backend

### repbrasil-api (.NET 8)

- Root directory: `backend`
- Build command: `dotnet publish -c Release`
- Start command: `dotnet RepBrasil.API.dll`
- Variáveis: `ConnectionStrings__Postgres`, `ConnectionStrings__Redis`, `Neo4j__Uri`

### repbrasil-etl (Python)

- Root directory: `etl`
- Build command: `uv sync`
- Rodar como jobs agendados (Railway Cron)

## Serviços de dados (Railway managed)

- **PostgreSQL**: criado como plugin no Railway, string de conexão injetada automaticamente
- **Redis**: criado como plugin no Railway, string de conexão injetada automaticamente

## Neo4j

Opções:
1. **Neo4j Aura Free/Pro** (recomendado): gerenciado pela Neo4j, conectado via variável `NEO4J_URI`
2. **Container no Railway**: possível, mas Aura é mais simples para começar

## Variáveis de ambiente em produção

Nunca commitar `.env` com valores reais.
Todas as variáveis sensíveis são configuradas diretamente no painel do Railway.

## Status

**Fase 0** — Guia planejado. Deploy real ocorrerá na Fase 2 ou 3.
