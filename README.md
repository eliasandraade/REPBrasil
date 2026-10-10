# REPBrasil

**Apenas dados. Sem discursos.**

O REPBrasil é uma plataforma open source de transparência política e reputação pública documental.

Reunimos, organizamos, cruzamos e apresentamos dados públicos oficiais sobre políticos brasileiros — para que qualquer cidadão entenda quem são seus representantes, sem filtro ideológico, sem interpretação partidária.

## O que é

- Plataforma de dados públicos verificáveis
- Score Público documental e explicável (0–10)
- Inteligência eleitoral: resultado oficial por seção, do Brasil à urna, ligado ao perfil do político
- Grafo de conexões políticas
- Metodologia aberta, versionada e auditável
- Código 100% aberto (AGPL-3.0)

## O que não é

- Partido, imprensa ou tribunal
- Ferramenta de campanha eleitoral
- Sistema de denúncia não verificada
- Avaliação ideológica ou moral

## Stack

| Camada     | Tecnologia                                      |
|------------|-------------------------------------------------|
| Frontend   | Next.js 15, TypeScript, Tailwind CSS, shadcn/ui |
| Backend    | .NET 8, Clean Architecture, PostgreSQL + PostGIS, Redis |
| ETL        | Python 3.12, uv, Polars, Pydantic v2, psycopg 3 |
| Mapas      | MapLibre GL + malhas oficiais do IBGE           |
| Grafo      | Neo4j 5                                         |
| Infra local| Docker Compose                                  |

## Rodar localmente

**Pré-requisitos:** Docker, Node.js 20+, .NET 8 SDK, Python 3.12, uv

```bash
# 1. Clonar
git clone https://github.com/eliasandraade/REPBrasil
cd REPBrasil

# 2. Subir banco, cache e grafo
cd infra
cp .env.example .env
docker compose up -d
cd ..

# 3. Backend
cd backend
dotnet restore
dotnet run --project src/RepBrasil.API
# Acesse: http://localhost:5000/health

# 4. Frontend
cd frontend
npm install
npm run dev
# Acesse: http://localhost:3000
```

## Inteligência eleitoral

`/eleicoes` navega Brasil → UF → município → zona → seção → resultado oficial (Boletim de Urna do
TSE) → candidatura → perfil REPBrasil. A pessoa é uma só (`Person`); a candidatura é uma relação
dessa pessoa com uma disputa; o voto pertence à eleição; o Score não usa dado eleitoral.
Vertical slice: Ceará 2026, 1º turno.

- Arquitetura: [docs/ELECTORAL_ARCHITECTURE.md](docs/ELECTORAL_ARCHITECTURE.md)
- Fontes e execução do ETL: [docs/ELECTORAL_DATA_SOURCES.md](docs/ELECTORAL_DATA_SOURCES.md)
- Identificadores do TSE e identidade: [docs/TSE_IDENTITY.md](docs/TSE_IDENTITY.md)
- Origem técnica (Urnaí): [docs/URNAI_MIGRATION.md](docs/URNAI_MIGRATION.md)

## Testes

```bash
cd backend && dotnet test                     # REPBRASIL_ELECTORAL_DB=... habilita a integração
cd frontend && npm test && npm run typecheck && npm run build
cd etl && uv run pytest                       # REPBRASIL_ELECTORAL_TEST_DATABASE_URL=... (banco *_test)
```

## Estrutura

```
REPBrasil/
├── docs/          # Documentação institucional e técnica
├── methodology/   # Metodologia do Score Público
├── frontend/      # Interface web (Next.js)
├── backend/       # API e domínio (.NET 8)
├── etl/           # Pipelines de coleta (Python)
├── graph/         # Documentação do grafo (Neo4j)
├── infra/         # Docker Compose e configuração local
├── data/          # Schemas e exemplos (sem datasets reais)
├── deploy/        # Guias de deploy (Railway)
└── scripts/       # Utilitários locais
```

## Roadmap

- [x] **Fase 0** — Fundação: repositório, documentação, scaffolds, ambiente local
- [ ] **Fase 1** — Dados básicos: importação TSE, busca simples, perfil básico
- [ ] **Fase 2** — Score v0: pilares, flags, explicabilidade
- [ ] **Fase 3** — Interface: home, perfil, breakdown do score
- [ ] **Fase 4** — Grafo: Neo4j, conexões, visualização
- [ ] **Fase 5** — Dados avançados: gastos, emendas, processos
- [ ] **Fase 6** — Auditoria pública: contestação, API pública, changelog
- [ ] **Inteligência eleitoral** — vertical slice CE 2026 entregue; demais UFs e eleições em seguida (ver [docs/roadmap.md](docs/roadmap.md))

## Licença

[AGPL-3.0](LICENSE) — Software livre. Forks que rodam como serviço devem publicar suas modificações.

## Contribuir

Leia [CONTRIBUTING.md](CONTRIBUTING.md).
