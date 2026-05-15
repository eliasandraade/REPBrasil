# REPBrasil Fase 0 — Bloco 6: Graph + Infra

> **Para execução:** Use `superpowers:subagent-driven-development` ou `superpowers:executing-plans`.
> **Depende de:** Bloco 1 (pastas `graph/`, `infra/`, `data/`, `deploy/`, `scripts/` criadas). Docker instalado.

**Objetivo:** Documentar o modelo de grafo Neo4j, criar o `docker-compose.yml` com PostgreSQL + Redis + Neo4j e verificar que `docker compose up -d` sobe todos os três serviços com sucesso. Criar também os documentos de suporte restantes (`deploy/railway.md`, `scripts/README.md`).

---

## Arquivos criados

```
graph/
├── README.md
├── schema.md
└── queries/
    └── exemplos.cypher

infra/
├── docker-compose.yml
├── .env.example
└── README.md

deploy/
└── railway.md

scripts/
└── README.md
```

---

## Decisões arquiteturais

**Graph:**
- Schema documentado antes de qualquer código Neo4j: nós, arestas, propriedades e índices sugeridos.
- Níveis de confiança nas arestas (`Confirmado` / `Provável` / `Inconclusivo`): apenas `Confirmado` influencia o score.
- Conexões indiretas aparecem visualmente no grafo mas **não** impactam diretamente o score — explicitado no `README.md` e no `schema.md`.
- Temporalidade nas arestas: `startDate` e `endDate` em todas as relações.

**Infra:**
- Redis **sem senha** em desenvolvimento local: evita configuração adicional para contribuidores. Senha obrigatória em produção (gerenciada pelo Railway).
- PostgreSQL com volume nomeado: dados persistem entre `docker compose down` e `docker compose up`.
- Neo4j Community Edition: gratuita, sem limitações para o volume de dados da Fase 0.
- `.env.example` versionado; `.env` no `.gitignore`. Contribuidor deve fazer `cp .env.example .env`.

---

## Steps

### Graph — Documentação Neo4j

- [ ] **1. Criar `graph/README.md`**

```markdown
# Grafo de Conexões Políticas — Neo4j

## Por que Neo4j?

Conexões políticas são naturalmente um grafo. Consultas como:

- "Quais empresas receberam contratos de municípios onde este político concentrou emendas?"
- "Quais políticos estão conectados a este fornecedor por mais de um caminho?"
- "Qual é a rede de sócios de empresas que receberam emendas deste deputado?"

São complexas em SQL (múltiplos JOINs com tabelas de adjacência) mas naturais em Cypher.

## Princípios do grafo

### Expansão progressiva

O grafo começa com conexões diretas e confirmadas.
Conexões de segundo e terceiro nível são adicionadas progressivamente conforme os dados chegam.

### Níveis de confiança

Toda aresta (relação) tem um nível de confiança:

| Nível | Significado | Impacto no score |
|-------|-------------|-----------------|
| `Confirmado` | Relação verificada em fonte oficial | Pode impactar diretamente |
| `Provável` | Relação com evidência forte mas não definitiva | Não impacta o score |
| `Inconclusivo` | Relação com evidência fraca | Não impacta o score |

### Conexões indiretas e o score

**Conexões indiretas aparecem visualmente no grafo mas NÃO impactam diretamente o score.**

Esta é uma regra fundamental do REPBrasil. O objetivo é informar, não acusar.
Conexões de segundo grau (amigo do amigo) são informação para o cidadão — não evidência de irregularidade.

### Evidências nas arestas

Toda relação carrega:
- `source`: URL ou identificador da fonte que confirma a relação
- `collectedAt`: data da coleta
- `confidence`: nível de confiança
- `startDate`: início da relação (quando conhecido)
- `endDate`: fim da relação (quando conhecido)

## Status

**Fase 0 — Fundação.** O esquema está documentado mas o Neo4j não está populado.
Implementação do grafo prevista para a Fase 4.
```

- [ ] **2. Criar `graph/schema.md`**

```markdown
# Schema do Grafo — Neo4j

**Versão:** 1.0
**Status:** Documentado (Fase 0) — implementação na Fase 4

---

## Nós (Nodes)

### `:Politician`
Representa um político ou candidato.

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `id` | String (UUID) | Identificador interno |
| `name` | String | Nome completo |
| `ballotName` | String | Nome de urna |
| `tseId` | String? | ID no TSE |
| `camaraId` | String? | ID na Câmara |

### `:Party`
Representa um partido político.

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `id` | String (UUID) | Identificador interno |
| `name` | String | Nome completo |
| `acronym` | String | Sigla |
| `tseNumber` | String? | Número do partido no TSE |

### `:Company`
Representa uma pessoa jurídica.

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `id` | String (UUID) | Identificador interno |
| `name` | String | Razão social |
| `cnpj` | String | CNPJ |
| `status` | String? | Situação cadastral na Receita |

### `:Municipality`
Representa um município brasileiro.

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `id` | String (UUID) | Identificador interno |
| `name` | String | Nome do município |
| `state` | String | UF |
| `ibgeCode` | String? | Código IBGE |

### `:LegalCase`
Representa um processo judicial.

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `id` | String (UUID) | Identificador interno |
| `caseNumber` | String | Número do processo |
| `court` | String | Tribunal |
| `hasFinalConviction` | Boolean | Trânsito em julgado |

### `:Amendment`
Representa uma emenda parlamentar.

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `id` | String (UUID) | Identificador interno |
| `value` | Float | Valor em reais |
| `year` | Integer | Ano |
| `siopCode` | String? | Código no SIOP |

---

## Arestas (Relationships)

### `:BELONGS_TO`
`(:Politician)-[:BELONGS_TO]->(:Party)`

Político filiado a partido.

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `startDate` | Date | Data de filiação |
| `endDate` | Date? | Data de desfiliação (null = atual) |
| `confidence` | String | `Confirmado` |
| `source` | String | Fonte (ex: TSE filiados) |
| `collectedAt` | DateTime | Data de coleta |

### `:OWNS`
`(:Politician)-[:OWNS]->(:Company)`

Político é sócio ou proprietário de empresa.

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `role` | String? | Papel (sócio, administrador) |
| `startDate` | Date? | Data de entrada na empresa |
| `endDate` | Date? | Data de saída |
| `confidence` | String | `Confirmado` / `Provável` |
| `source` | String | Fonte (Receita Federal CNPJ) |
| `collectedAt` | DateTime | Data de coleta |

### `:RAN_IN`
`(:Politician)-[:RAN_IN]->(:Municipality)`

Político candidatou-se em município.

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `year` | Integer | Ano da eleição |
| `office` | String | Cargo disputado |
| `result` | String | `Eleito` / `Não eleito` |
| `confidence` | String | `Confirmado` |
| `source` | String | Fonte (TSE resultados) |

### `:ALLOCATED`
`(:Politician)-[:ALLOCATED]->(:Amendment)`

Político destinou emenda.

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `confidence` | String | `Confirmado` |
| `source` | String | Fonte (SIOP/TransfereGov) |
| `collectedAt` | DateTime | Data de coleta |

### `:BENEFITS`
`(:Amendment)-[:BENEFITS]->(:Municipality)`

Emenda beneficia município.

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `confidence` | String | `Confirmado` |
| `source` | String | Fonte (TransfereGov) |

### `:HAS_LEGAL_CASE`
`(:Politician)-[:HAS_LEGAL_CASE]->(:LegalCase)`

Político aparece em processo judicial.

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `role` | String? | Papel no processo (réu, autor) |
| `confidence` | String | `Confirmado` |
| `source` | String | Fonte (DataJud/CNJ) |
| `collectedAt` | DateTime | Data de coleta |

---

## Índices sugeridos

```cypher
CREATE INDEX politician_id FOR (p:Politician) ON (p.id);
CREATE INDEX politician_tse_id FOR (p:Politician) ON (p.tseId);
CREATE INDEX company_cnpj FOR (c:Company) ON (c.cnpj);
CREATE INDEX municipality_ibge FOR (m:Municipality) ON (m.ibgeCode);
CREATE INDEX party_acronym FOR (p:Party) ON (p.acronym);
```

---

## Regras de integridade

1. Toda aresta tem `confidence`, `source` e `collectedAt`.
2. Apenas arestas `Confirmado` são usadas no cálculo do score.
3. Arestas `Provável` e `Inconclusivo` aparecem no grafo visual com marcação distinta.
4. Nenhuma aresta é criada sem evidência documentada.
5. `endDate` nulo significa relação ativa.
```

- [ ] **3. Criar `graph/queries/exemplos.cypher`**

```cypher
// ============================================================
// REPBrasil — Exemplos de queries Cypher
// ============================================================
// Estas queries ilustram como navegar o grafo de conexões políticas.
// Todas assumem que o grafo está populado (Fase 4+).

// ------------------------------------------------------------
// 1. Partidos de um político (histórico completo)
// ------------------------------------------------------------
MATCH (p:Politician {id: $politicianId})-[r:BELONGS_TO]->(party:Party)
RETURN party.name AS partido,
       party.acronym AS sigla,
       r.startDate AS inicio,
       r.endDate AS fim
ORDER BY r.startDate DESC;

// ------------------------------------------------------------
// 2. Empresas vinculadas a um político
// ------------------------------------------------------------
MATCH (p:Politician {id: $politicianId})-[r:OWNS]->(c:Company)
RETURN c.name AS empresa,
       c.cnpj AS cnpj,
       r.role AS papel,
       r.startDate AS inicio,
       r.endDate AS fim,
       r.confidence AS confianca,
       r.source AS fonte
ORDER BY r.confidence, r.startDate DESC;

// ------------------------------------------------------------
// 3. Municípios que receberam emendas de um político
// ------------------------------------------------------------
MATCH (p:Politician {id: $politicianId})-[:ALLOCATED]->(a:Amendment)-[:BENEFITS]->(m:Municipality)
RETURN m.name AS municipio,
       m.state AS estado,
       sum(a.value) AS total_emendas,
       count(a) AS num_emendas
ORDER BY total_emendas DESC;

// ------------------------------------------------------------
// 4. Processos judiciais com condenação transitada
// ------------------------------------------------------------
MATCH (p:Politician {id: $politicianId})-[r:HAS_LEGAL_CASE]->(lc:LegalCase)
WHERE lc.hasFinalConviction = true
RETURN lc.caseNumber AS processo,
       lc.court AS tribunal,
       r.source AS fonte,
       r.collectedAt AS coletado_em;

// ------------------------------------------------------------
// 5. Rede de conexões diretas de um político (1 salto)
//    Útil para renderizar o grafo visual inicial
// ------------------------------------------------------------
MATCH (p:Politician {id: $politicianId})-[r]-(connected)
WHERE r.confidence = 'Confirmado'
RETURN p, r, connected
LIMIT 50;
```

---

### Infra — Docker Compose

- [ ] **4. Criar `infra/.env.example`**

```env
# PostgreSQL
POSTGRES_USER=repbrasil
POSTGRES_PASSWORD=repbrasil
POSTGRES_DB=repbrasil

# Neo4j
# Formato: usuario/senha
NEO4J_AUTH=neo4j/repbrasil
```

- [ ] **5. Criar `infra/docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    container_name: repbrasil-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: repbrasil-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  neo4j:
    image: neo4j:5-community
    container_name: repbrasil-neo4j
    restart: unless-stopped
    environment:
      NEO4J_AUTH: ${NEO4J_AUTH}
    ports:
      - "7474:7474"   # Neo4j Browser (HTTP)
      - "7687:7687"   # Bolt (driver)
    volumes:
      - neo4j_data:/data
      - neo4j_logs:/logs
    healthcheck:
      test: ["CMD-SHELL", "wget -q --spider http://localhost:7474 || exit 1"]
      interval: 15s
      timeout: 10s
      retries: 5

volumes:
  postgres_data:
  redis_data:
  neo4j_data:
  neo4j_logs:
```

- [ ] **6. Criar `infra/README.md`**

```markdown
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
```

### Arquivos de suporte

- [ ] **7. Criar `deploy/railway.md`**

```markdown
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
```

- [ ] **8. Criar `scripts/README.md`**

```markdown
# scripts/

Esta pasta contém scripts auxiliares para uso local.

## Fase atual

**Fase 0 — Vazia.** Scripts serão adicionados conforme necessidade.

## Exemplos de scripts futuros

- `scripts/reset-db.sh` — apaga e recria o banco de desenvolvimento
- `scripts/seed-db.sh` — popula o banco com dados de exemplo
- `scripts/check-sources.sh` — verifica disponibilidade das fontes oficiais
- `scripts/export-score.sh` — exporta snapshot de scores para auditoria

## Convenção

- Scripts Bash para operações Linux/macOS
- Scripts PowerShell para operações Windows
- Documentar argumentos no topo do arquivo
```

### Verificação

- [ ] **9. Subir infraestrutura local**

```bash
cd infra
cp .env.example .env
docker compose up -d
```

Esperado: três containers criados e iniciados.

- [ ] **10. Verificar status dos serviços**

```bash
docker compose ps
```

Esperado (todos `healthy`):
```
NAME                    STATUS
repbrasil-postgres      Up (healthy)
repbrasil-redis         Up (healthy)
repbrasil-neo4j         Up (healthy)
```

> Os healthchecks do Neo4j podem demorar 30–60s para ficar `healthy`. Aguardar.

- [ ] **11. Verificar PostgreSQL**

```bash
docker exec repbrasil-postgres pg_isready -U repbrasil -d repbrasil
```

Esperado: `localhost:5432 - accepting connections`

- [ ] **12. Verificar Redis**

```bash
docker exec repbrasil-redis redis-cli ping
```

Esperado: `PONG`

- [ ] **13. Verificar Neo4j Browser**

Abrir `http://localhost:7474` no browser.
Fazer login com usuário `neo4j` e senha `repbrasil`.
Esperado: painel do Neo4j Browser carrega sem erro.

- [ ] **14. Commit**

```bash
cd ..
git add graph/ infra/ deploy/ scripts/
git commit -m "feat(infra): docker-compose PostgreSQL+Redis+Neo4j, schema de grafo, guia Railway"
git push
```

---

## Critérios de sucesso

- [ ] `docker compose up -d` completa sem erros
- [ ] `docker compose ps` mostra todos os 3 serviços `healthy`
- [ ] PostgreSQL aceita conexões na porta 5432
- [ ] Redis responde `PONG` ao `ping`
- [ ] Neo4j Browser acessível em `http://localhost:7474`
- [ ] `graph/schema.md` documenta todos os 6 nós e 6 arestas
- [ ] `graph/queries/exemplos.cypher` contém 5 queries comentadas
- [ ] `infra/.env.example` versionado; `.env` no `.gitignore`

---

## Riscos / Pontos de atenção

| Risco | Mitigação |
|-------|-----------|
| Docker Desktop não iniciado no Windows | Iniciar o Docker Desktop antes de rodar `docker compose up` |
| Porta 5432 já ocupada por PostgreSQL local | Mudar a porta no `docker-compose.yml` para `5433:5432` |
| Porta 7474 ou 7687 ocupada | Verificar processos na porta antes de subir |
| Neo4j demorando para ficar `healthy` | Aguardar 60s; healthcheck tem retries configurados |
| `.env` commitado acidentalmente | Verificar que `.gitignore` inclui `.env` (feito no Bloco 1) |
| Neo4j Community sem suporte a clustering | Suficiente para Fase 0–4; reavaliar na Fase 5 com volume real |
