# REPBrasil Fase 0 — Bloco 1: Estrutura do Repositório

> **Para execução:** Use `superpowers:subagent-driven-development` ou `superpowers:executing-plans`.

**Objetivo:** Criar o repositório no GitHub, toda a hierarquia de pastas e os arquivos raiz de identidade do projeto.

**Pré-requisito:** `gh` CLI autenticado na conta `oeliasandraade`.

---

## Arquivos criados

```
REPBrasil/
├── README.md
├── LICENSE                    # AGPL-3.0 (gerado pelo gh)
├── .gitignore
├── CONTRIBUTING.md
├── docs/adrs/                 # vazio, aguarda Bloco 2
├── docs/ux/                   # vazio, aguarda Bloco 2
├── methodology/               # vazio, aguarda Bloco 2
├── frontend/                  # vazio, aguarda Bloco 3
├── backend/src/               # vazio, aguarda Bloco 4
├── etl/src/sources/tse/       # vazio, aguarda Bloco 5
├── etl/src/sources/camara/
├── etl/src/models/
├── etl/src/pipeline/
├── graph/queries/             # vazio, aguarda Bloco 6
├── infra/                     # vazio, aguarda Bloco 6
├── data/raw/
├── data/processed/
├── deploy/
└── scripts/
```

---

## Decisões arquiteturais

- **Licença AGPL-3.0**: protege abertura do código em uso como serviço web; compatível com br/acc.
- **Branch principal `main`**: convencional, sem `master`.
- **Repositório público desde o dia 1**: o projeto nasce open source; não há fase privada.
- **Estrutura de pastas separada por stack**: cada serviço tem sua pasta independente para deploy separado no Railway.
- **`.gitignore` cobre quatro stacks**: Node.js, .NET, Python, Docker — para não contaminar o histórico com artefatos de build.
- **`data/` no repo com aviso explícito**: apenas schemas e exemplos mínimos. Datasets reais vão para Object Storage (R2/S3). Pastas `raw/` e `processed/` existem para orientar a estrutura sem versionar dados grandes.

---

## Steps

- [ ] **1. Verificar autenticação do gh**

```bash
gh auth status
```

Esperado: `Logged in to github.com as oeliasandraade`

- [ ] **2. Inicializar repositório local**

```bash
cd "C:\Users\Elias\Documents\RepBrasil"
git init
git checkout -b main
```

Esperado: `Initialized empty Git repository`

- [ ] **3. Criar repositório no GitHub**

```bash
gh repo create oeliasandraade/REPBrasil \
  --public \
  --description "Plataforma open source de transparência política e reputação pública documental. Apenas dados. Sem discursos." \
  --license agpl-3.0 \
  --source=. \
  --remote=origin
```

Esperado: URL `https://github.com/oeliasandraade/REPBrasil` impressa no terminal.

- [ ] **4. Criar estrutura de pastas**

```bash
mkdir -p docs/adrs docs/ux docs/superpowers/specs docs/superpowers/plans
mkdir -p methodology
mkdir -p frontend/src/app frontend/src/components/ui
mkdir -p backend/src
mkdir -p etl/src/sources/tse etl/src/sources/camara etl/src/models etl/src/pipeline
mkdir -p graph/queries
mkdir -p infra
mkdir -p data/raw data/processed
mkdir -p deploy
mkdir -p scripts
```

- [ ] **5. Criar `.gitignore`**

Criar `C:\Users\Elias\Documents\RepBrasil\.gitignore` com o conteúdo:

```gitignore
# Node.js / Next.js
node_modules/
.next/
out/
.env.local
.env.*.local
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.pnpm-debug.log*

# .NET
bin/
obj/
*.user
*.suo
.vs/
TestResults/
*.nupkg
launchSettings.json

# Python
__pycache__/
*.py[cod]
*$py.class
*.pyc
.Python
.venv/
venv/
env/
.env
dist/
build/
*.egg-info/
.mypy_cache/
.ruff_cache/
.pytest_cache/
.coverage
htmlcov/

# Docker
.env

# Dados — nunca versionar datasets grandes
data/raw/*
data/processed/*
!data/raw/.gitkeep
!data/processed/.gitkeep

# OS
.DS_Store
Thumbs.db
desktop.ini

# IDEs
.idea/
.vscode/
*.swp
*.swo
```

- [ ] **6. Criar `.gitkeep` nas pastas de dados**

```bash
echo "" > data/raw/.gitkeep
echo "" > data/processed/.gitkeep
```

- [ ] **7. Criar `CONTRIBUTING.md`**

Criar `CONTRIBUTING.md`:

```markdown
# Como contribuir com o REPBrasil

Obrigado pelo interesse em contribuir. O REPBrasil é um projeto open source de transparência política.

## Princípios inegociáveis

- Apenas dados públicos oficiais verificáveis.
- Nenhuma fonte não aprovada (notícias, redes sociais, rumores).
- Neutralidade radical: sem opinião, militância ou interpretação partidária.
- Todo dado precisa de fonte, data de coleta e rastreabilidade.

## Como começar

1. Leia o [manifesto](docs/manifesto.md).
2. Leia a [metodologia](methodology/score-publico-v1.md).
3. Leia o [roadmap](docs/roadmap.md).
4. Escolha uma tarefa aberta nas Issues.
5. Abra um fork, faça suas alterações e abra um Pull Request.

## Padrões

- **Documentação**: Português (BR).
- **Código, entidades, variáveis**: Inglês.
- **Commits**: mensagens claras em português ou inglês, prefixo `feat:`, `fix:`, `docs:`, `chore:`.
- **Pull Requests**: descreva o que mudou, por que e como testar.

## O que não aceitamos

- Fontes não oficiais como base de dados.
- Score ideológico ou opinativo.
- Alterações na metodologia sem ADR e justificativa documentada.
- Remoção de histórico sem registro.

## Dúvidas

Abra uma Issue com a tag `question`.
```

- [ ] **8. Criar `README.md`**

Criar `README.md` (conteúdo no Bloco 1 — este arquivo deve existir antes do push inicial):

```markdown
# REPBrasil

**Apenas dados. Sem discursos.**

O REPBrasil é uma plataforma open source de transparência política e reputação pública documental.

Reunimos, organizamos, cruzamos e apresentamos dados públicos oficiais sobre políticos brasileiros — para que qualquer cidadão entenda quem são seus representantes, sem filtro ideológico, sem interpretação partidária.

## O que é

- Plataforma de dados públicos verificáveis
- Score Público documental e explicável (0–10)
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
| Backend    | .NET 8, Clean Architecture, PostgreSQL, Redis   |
| ETL        | Python 3.12, uv, Polars, Pydantic v2            |
| Grafo      | Neo4j 5                                         |
| Infra local| Docker Compose                                  |

## Rodar localmente

**Pré-requisitos:** Docker, Node.js 20+, .NET 8 SDK, Python 3.12, uv

```bash
# 1. Clonar
git clone https://github.com/oeliasandraade/REPBrasil
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

## Licença

[AGPL-3.0](LICENSE) — Software livre. Forks que rodam como serviço devem publicar suas modificações.

## Contribuir

Leia [CONTRIBUTING.md](CONTRIBUTING.md).
```

- [ ] **9. Criar `data/README.md`**

```markdown
# data/

Esta pasta contém schemas de referência e exemplos mínimos de dados.

## Regra fundamental

**Nunca versionar datasets grandes ou com dados pessoais sensíveis no Git.**

Datasets reais devem ser armazenados em Object Storage (Cloudflare R2, AWS S3 ou equivalente)
e referenciados por URL ou path de configuração.

## O que pode entrar aqui

- Schemas JSON/Pydantic de referência
- Exemplos mínimos anonimizados (< 10 registros)
- Fixtures de teste

## O que nunca entra aqui

- Dumps completos de fontes oficiais
- Arquivos CSV/Parquet com dados reais de políticos
- Qualquer dado que exceda alguns KB
```

- [ ] **10. Primeiro commit**

```bash
git add .
git commit -m "chore: fundação do repositório — estrutura de pastas, arquivos raiz, README, licença AGPL-3.0"
git push -u origin main
```

Esperado: push bem-sucedido, repositório visível em `https://github.com/oeliasandraade/REPBrasil`.

---

## Critérios de sucesso

- [ ] `gh repo view oeliasandraade/REPBrasil` retorna o repositório sem erro
- [ ] `git log --oneline` mostra o primeiro commit
- [ ] README renderiza corretamente no GitHub com o slogan
- [ ] LICENSE exibe texto AGPL-3.0 no GitHub
- [ ] Estrutura de pastas completa localmente (`ls -R` ou `tree`)
- [ ] `.gitignore` está cobrindo `node_modules/`, `bin/`, `.venv/`, `data/raw/*`

---

## Riscos / Pontos de atenção

| Risco | Mitigação |
|-------|-----------|
| `gh` não autenticado ou conta errada | Verificar `gh auth status` antes de criar o repo |
| `git init` feito dentro de subpasta errada | Garantir que o CWD é `C:\Users\Elias\Documents\RepBrasil` |
| Nome `REPBrasil` já existir no GitHub | Improvável na conta pessoal; verificar antes |
| Scaffolding de frontend/backend criar `.git` interno | Passar `--no-git` em `create-next-app`; criar projetos .NET dentro de pasta existente |
| `data/raw/` e `data/processed/` sendo ignorados pelo git sem `.gitkeep` | `.gitkeep` resolve — já contemplado nos steps |
