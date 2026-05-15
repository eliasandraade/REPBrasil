# Design — REPBrasil Fase 0 (Fundação)

**Data:** 2026-05-15
**Status:** Aprovado
**Fase:** 0 — Fundação

---

## Objetivo

Criar a fundação técnica e documental do repositório REPBrasil.
Nenhuma feature de produto será implementada nesta fase.
O resultado deve permitir que qualquer desenvolvedor clone o repositório, suba o ambiente local com `docker compose up -d`, e encontre documentação institucional completa.

---

## Abordagem escolhida

**Fundação balanceada**: documentação institucional completa + scaffolds técnicos funcionais por stack.

Descartadas:
- Documentação-primeiro: não comunicaria maturidade técnica
- Estrutura mínima: não entregaria ambiente local funcional

---

## 1. Estrutura de Pastas

```
REPBrasil/
├── README.md
├── LICENSE                          # AGPL-3.0
├── .gitignore                       # Node, .NET, Python, Docker
├── CONTRIBUTING.md
│
├── docs/
│   ├── manifesto.md
│   ├── governanca.md
│   ├── auditoria.md
│   ├── contestacao.md
│   ├── matriz-de-fontes.md
│   ├── roadmap.md
│   ├── master-spec.md
│   ├── lgpd.md
│   ├── ux/
│   │   ├── home.md
│   │   └── perfil-politico.md
│   └── adrs/
│       ├── ADR-001-linguagens-e-stacks.md
│       ├── ADR-002-banco-de-dados.md
│       ├── ADR-003-arquitetura-backend.md
│       ├── ADR-004-grafo-neo4j.md
│       ├── ADR-005-etl-python.md
│       ├── ADR-006-frontend-nextjs.md
│       └── ADR-007-licenca-open-source.md
│
├── methodology/
│   ├── score-publico-v1.md
│   ├── pilares.md
│   ├── flags.md
│   └── changelog.md
│
├── frontend/
│   ├── package.json
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── .eslintrc.json
│   ├── .prettierrc
│   ├── .env.local.example
│   └── src/
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx
│       │   └── globals.css
│       └── components/
│           └── ui/
│
├── backend/
│   ├── Directory.Build.props
│   ├── RepBrasil.sln
│   └── src/
│       ├── RepBrasil.Domain/
│       ├── RepBrasil.Application/
│       ├── RepBrasil.Infrastructure/
│       └── RepBrasil.API/
│
├── etl/
│   ├── pyproject.toml
│   ├── .python-version
│   ├── README.md
│   └── src/
│       ├── sources/
│       │   ├── tse/
│       │   └── camara/
│       ├── models/
│       └── pipeline/
│
├── graph/
│   ├── README.md
│   ├── schema.md
│   └── queries/
│       └── exemplos.cypher
│
├── infra/
│   ├── docker-compose.yml
│   ├── .env.example
│   └── README.md
│
├── data/
│   ├── raw/
│   ├── processed/
│   └── README.md                    # Aviso: não versionar datasets grandes
│
├── deploy/
│   └── railway.md
│
└── scripts/
    └── README.md
```

### Convenções linguísticas

- Documentação institucional e metodológica: **Português (BR)**
- Código, entidades, nomenclaturas técnicas: **Inglês**
- Futuramente: `README.en.md`, CONTRIBUTING em inglês

---

## 2. Camada de Documentação

### README.md (raiz)
Seções: o que é o REPBrasil, slogan, manifesto resumido (3 linhas), stack técnica, como rodar localmente, estrutura do repositório, roadmap resumido, licença AGPL-3.0, como contribuir.

### docs/manifesto.md
Texto integral do manifesto conforme master spec. Sem alteração editorial.

### docs/governanca.md
Modelo de governança com seções:
- Estrutura do projeto
- Financiamento (doações públicas, sem interferência, prestação de contas pública)
- **Conflito de Interesses**: regras para doadores, colaboradores, mantenedores; vedação explícita de interferência na metodologia por políticos ou assessorias
- Processo de revisão
- Limites de poder editorial

### docs/auditoria.md
Política antimanipulação com seções:
- Logs imutáveis e snapshots versionados
- Hash de datasets processados
- Rastreamento de origem por item
- Trilha de contestação
- **Correções sem apagamento**: erro pode ser corrigido, histórico não é apagado, toda alteração relevante gera registro no changelog

### docs/contestacao.md
Processo público de contestação com:
- Como enviar contestação
- Documentação necessária
- Fluxo de análise
- Status padronizados: **Recebida → Em análise → Aceita / Parcialmente aceita / Rejeitada / Atualizada por decisão oficial posterior**
- Preservação de histórico

### docs/matriz-de-fontes.md
Tabela com colunas:
`Nome | Órgão | URL/API | Tipo de dado | Periodicidade | Uso (perfil/score/grafo) | Risco LGPD | Confiabilidade | Prioridade | Status pipeline | Licença/Termos | Base legal / justificativa de uso | Observações`

Fontes P0/P1/P2 conforme master spec.

### docs/lgpd.md
Documento de conformidade com seções:
- Bases legais de uso (interesse legítimo, transparência pública, art. 7º LGPD)
- Finalidade do tratamento de dados
- Princípios aplicados: transparência, minimização, necessidade
- Dados públicos vs. dados pessoais sensíveis
- Justificativa de uso de dados públicos oficiais
- Direito de contestação e retificação
- Limites do tratamento (sem dados não públicos, sem inferência indevida)

### docs/adrs/ (7 ADRs)
Formato padrão: Título, Status, Contexto, Decisão, Consequências.

| ADR | Decisão |
|-----|---------|
| 001 | PT-BR para docs, inglês para código |
| 002 | PostgreSQL + Redis + Neo4j |
| 003 | Clean Architecture com .NET 8 |
| 004 | Neo4j para grafo de conexões políticas |
| 005 | Python + uv + Polars para ETL |
| 006 | Next.js 15 + TypeScript + Tailwind + shadcn/ui |
| 007 | AGPL-3.0 (compatibilidade com br/acc, proteção SaaS) |

### methodology/score-publico-v1.md
Metodologia completa com disclaimers explícitos no início:
- O score **não** mede honestidade
- O score **não** mede ideologia
- O score **não** recomenda voto
- O score mede **sinais documentais verificáveis**

Seções: definição, escala 0–10, pilares com pesos, fórmula de cálculo, regras fundamentais.

### methodology/pilares.md
Detalhamento dos 5 pilares:
- Integridade Pública — 35%
- Transparência e Coerência Patrimonial — 25%
- Responsabilidade Fiscal — 15%
- Estrutura de Poder e Conexões — 15%
- Atividade Pública — 10%

### methodology/flags.md
Tipos (Atenção / Atenção Alta / Atenção Crítica) com exemplos de cada. Nota explícita: flags não representam culpa.

---

## 3. Scaffolds Técnicos

### Frontend (`frontend/`)

**Stack:** Next.js 15, TypeScript strict, Tailwind CSS, shadcn/ui, TanStack Query

**Dependências principais:**
```
next, react, react-dom, typescript
tailwindcss, postcss, autoprefixer
@tanstack/react-query
eslint, prettier
```

**Scripts em `package.json`:**
```
dev, build, start, lint, typecheck
```

**Arquivos notáveis:**
- `src/app/layout.tsx` — metadata com `lang="pt-BR"`, título "REPBrasil"
- `src/app/page.tsx` — placeholder com slogan, sem features
- `.env.local.example` — `NEXT_PUBLIC_API_URL=http://localhost:5000`
- `.eslintrc.json` + `.prettierrc` — configuração padrão

### Backend (`backend/`)

**Stack:** .NET 8, Clean Architecture, EF Core, Npgsql, Redis, Swagger

**`Directory.Build.props` (raiz de backend/):**
```xml
<Nullable>enable</Nullable>
<ImplicitUsings>enable</ImplicitUsings>
<LangVersion>latest</LangVersion>
<TreatWarningsAsErrors>false</TreatWarningsAsErrors>
```

**Projetos e responsabilidades:**

| Projeto | Responsabilidade |
|---------|-----------------|
| `RepBrasil.Domain` | Entidades, value objects, enums, interfaces de repositório |
| `RepBrasil.Application` | Use cases, DTOs, interfaces de serviço |
| `RepBrasil.Infrastructure` | EF Core, repositórios, `ApplicationDbContext`, Redis |
| `RepBrasil.API` | Controllers, Program.cs, middleware, Swagger |

**Convenções de domínio:**

- Todos os identificadores internos usam `Guid` (UUID), independente de IDs externos do TSE/Câmara/etc.
- IDs externos são armazenados como campos separados (ex: `TseId`, `CamaraId`) para rastreabilidade.
- Convenção de versionamento da API: `/api/v1/` — ex: `/api/v1/politicians`, `/api/v1/scores`, `/api/v1/elections`.

**Base auditável (`AuditableEntity`):**
Todas as entidades principais herdam de `AuditableEntity` com:
```csharp
Guid Id
DateTime CreatedAt
DateTime UpdatedAt
DateTime? DeletedAt
DateTime? SourceUpdatedAt
```

**`ScoreSnapshot` é imutável:** snapshots nunca são sobrescritos. Cada recálculo gera um novo registro versionado. O histórico completo é preservado para auditoria.

**Entidades declaradas em `RepBrasil.Domain` (classes vazias):**
`Politician`, `Election`, `Party`, `AssetDeclaration`, `ElectionResult`, `Company`, `Contract`, `Amendment`, `Municipality`, `LegalCase`, `ScoreSnapshot`, `Flag`, `Source`, `Evidence`, `Contestation`

**`Source` expandida com campos:**
`SourceType`, `CollectedAt`, `OriginalUrl`, `Hash`, `License`

**Pacotes NuGet:**
- `Microsoft.EntityFrameworkCore`
- `Npgsql.EntityFrameworkCore.PostgreSQL`
- `Microsoft.Extensions.Caching.StackExchangeRedis`
- `Swashbuckle.AspNetCore` (habilitado apenas em `Development`)

**Endpoints de saúde em `HealthController.cs`:**
- `GET /health` — status 200 simples
- `GET /api/v1/status` — JSON com versão e ambiente

### ETL (`etl/`)

**Stack:** Python 3.12, uv, httpx, Polars, Pydantic v2, Loguru, Tenacity

**`pyproject.toml` inclui:**
- dependências de produção: httpx, polars, pydantic, loguru, tenacity
- dependências de dev: pytest, ruff, mypy

**Scripts documentados no README:**
```
uv run ruff check .       # lint
uv run mypy src/          # typecheck
uv run pytest             # testes
```

**Estrutura de `src/`:**
```
sources/tse/__init__.py       # placeholder pipeline TSE
sources/camara/__init__.py    # placeholder pipeline Câmara
models/politician.py          # Schema Pydantic básico
pipeline/base.py              # Classe abstrata BasePipeline (collect/transform/load)
```

### Grafo (`graph/`)

**Arquivos:**
- `README.md` — justificativa de uso do Neo4j, princípio de expansão progressiva, sem inferência de culpa; **regra explícita: conexões indiretas aparecem visualmente no grafo mas NÃO impactam diretamente o score**
- `schema.md` — nós: `:Politician`, `:Party`, `:Company`, `:Municipality`, `:LegalCase`, `:Amendment`; arestas: `:BELONGS_TO`, `:OWNS`, `:RAN_IN`, `:ALLOCATED`, `:HAS_LEGAL_CASE`; propriedades, índices sugeridos e classificação de nível de confiança (Confirmado / Provável / Inconclusivo)
- `queries/exemplos.cypher` — 5 queries Cypher comentadas

### Infra (`infra/`)

**`docker-compose.yml`** com três serviços:
- `postgres:16` — porta 5432, volume persistente
- `redis:7-alpine` — porta 6379, **sem senha** (desenvolvimento local; senha em produção via Railway)
- `neo4j:5-community` — portas 7474 + 7687, volume persistente

**`.env.example`:**
```
POSTGRES_USER=repbrasil
POSTGRES_PASSWORD=repbrasil
POSTGRES_DB=repbrasil
NEO4J_AUTH=neo4j/repbrasil
```

**`README.md`** com passo a passo: `cp .env.example .env` → `docker compose up -d` → verificar portas.

### Deploy (`deploy/railway.md`)

Orientações para deploy futuro no Railway:
- Frontend como serviço separado apontando para `frontend/`
- Backend como serviço separado apontando para `backend/`
- PostgreSQL e Redis como serviços gerenciados do Railway
- Neo4j como serviço externo (Neo4j Aura) ou container dedicado

---

## 4. Decisões técnicas documentadas

### Estratégia de busca

- **MVP:** PostgreSQL Full Text Search (sem dependência nova, suficiente para Fase 1–2)
- **Futuro:** OpenSearch ou Meilisearch conforme volume e necessidade de relevância avançada

### Segurança e infraestrutura futura (roadmap técnico)

A documentar em fases posteriores, mas já registrado como decisão:
- **Rate limiting:** a ser configurado no API Gateway ou middleware .NET
- **Cloudflare:** proteção de borda, cache de CDN, anti-scraping abusivo
- **Cache:** Redis para respostas frequentes (perfil, score); TTL a definir por tipo de dado

### Observabilidade futura (roadmap técnico)

- **Serilog** para logs estruturados no backend
- **OpenTelemetry** para tracing distribuído
- **Sentry** para captura de erros em produção
- Métricas e dashboards a definir nas fases de deploy

---

## 5. Licença

**AGPL-3.0**

Justificativa (ADR-007):
- Protege abertura do código em uso como serviço web
- Compatível com br/acc (também AGPL-3.0)
- Garante que forks mantidos como serviço devem publicar suas modificações

---

## 6. Git e GitHub

- Inicializar com `git init` localmente
- Criar repositório público `REPBrasil` na conta `oeliasandraade` via `gh repo create`
- Primeiro commit: toda a estrutura da Fase 0
- Branch principal: `main`

---

## 7. O que esta fase NÃO entrega

- Busca de políticos
- Perfil de político
- Score calculado
- Pipelines de ETL funcionais
- Conexão com APIs governamentais
- Interface de usuário real
- Banco de dados populado

Tudo acima pertence às Fases 1–6.

---

## 8. Critério de conclusão da Fase 0

- [ ] Repositório criado no GitHub (público)
- [ ] Estrutura de pastas completa
- [ ] Todos os documentos institucionais escritos
- [ ] Metodologia v1.0.0 documentada
- [ ] 7 ADRs escritos
- [ ] Frontend inicializável (`npm run dev` funciona)
- [ ] Backend compilável (`dotnet build` funciona)
- [ ] ETL com estrutura de pacote válida (`uv sync` funciona)
- [ ] `docker compose up -d` sobe PostgreSQL, Redis e Neo4j
- [ ] `GET /health` retorna 200
- [ ] `GET /api/v1/status` retorna JSON com versão e ambiente
- [ ] `docs/lgpd.md` escrito
- [ ] Primeiro commit com mensagem clara no GitHub
