# REPBrasil Fase 0 — Bloco 7: Revisão Final

> **Para execução:** Use `superpowers:subagent-driven-development` ou `superpowers:executing-plans`.
> **Depende de:** Blocos 1–6 completos.

**Objetivo:** Verificar que todos os critérios da Fase 0 estão atendidos, que o repositório está consistente, que todos os comandos de execução funcionam e que o projeto está pronto para ser divulgado e para iniciar a Fase 1.

---

## Checklist completo da Fase 0

### Repositório e arquivos raiz

- [ ] Repositório `oeliasandraade/REPBrasil` existe e é público no GitHub
- [ ] `README.md` renderiza corretamente com slogan e tabela de stack
- [ ] `LICENSE` exibe texto AGPL-3.0
- [ ] `.gitignore` cobre Node.js, .NET, Python, Docker e `data/raw/*`
- [ ] `CONTRIBUTING.md` existe com princípios inegociáveis

### Documentação institucional

- [ ] `docs/manifesto.md` — contém manifesto integral sem alteração editorial
- [ ] `docs/governanca.md` — contém seção "Conflito de Interesses"
- [ ] `docs/auditoria.md` — contém seção "Correções sem apagamento"
- [ ] `docs/contestacao.md` — contém os 6 status padronizados (Recebida → Atualizada por decisão oficial posterior)
- [ ] `docs/lgpd.md` — contém bases legais (art. 7º LGPD), finalidade e limites do tratamento
- [ ] `docs/matriz-de-fontes.md` — contém fontes P0/P1/P2 com coluna "Base legal / justificativa de uso"
- [ ] `docs/roadmap.md` — contém Fases 0–6 em checklist com status correto
- [ ] `docs/master-spec.md` — contém o spec canônico do projeto
- [ ] `docs/ux/home.md` — documenta experiência da home
- [ ] `docs/ux/perfil-politico.md` — documenta as 9 abas do perfil

### ADRs

- [ ] `ADR-001` — Idioma PT-BR / inglês para código
- [ ] `ADR-002` — PostgreSQL + Redis + Neo4j
- [ ] `ADR-003` — Clean Architecture .NET 8 (inclui Guid, AuditableEntity, ScoreSnapshot imutável, `/api/v1/`)
- [ ] `ADR-004` — Neo4j (inclui regra de conexões indiretas vs. score)
- [ ] `ADR-005` — Python + uv + Polars
- [ ] `ADR-006` — Next.js 15 + TypeScript + Tailwind
- [ ] `ADR-007` — AGPL-3.0

### Metodologia

- [ ] `methodology/score-publico-v1.md` — disclaimers explícitos no topo (não mede honestidade / ideologia / voto)
- [ ] `methodology/pilares.md` — 5 pilares com pesos e fatores documentados
- [ ] `methodology/flags.md` — 3 tipos de flag, nota "flags não representam culpa" no topo
- [ ] `methodology/changelog.md` — entrada v1.0.0 com data 2026-05-15

### Frontend

- [ ] `npm run typecheck` — passa sem erros
- [ ] `npm run lint` — sem warnings
- [ ] `npm run build` — compila sem erros
- [ ] `http://localhost:3000` — home com slogan visível e campo de busca placeholder
- [ ] `<html lang="pt-BR">` — presente no HTML gerado

### Backend

- [ ] `dotnet build` — compila sem erros, 0 warnings
- [ ] `GET /health` — retorna HTTP 200
- [ ] `GET /api/v1/status` — retorna JSON com `status`, `version`, `environment`, `timestamp`
- [ ] `http://localhost:5000/swagger` — Swagger UI acessível em desenvolvimento
- [ ] 15 entidades existem em `RepBrasil.Domain/Entities/`
- [ ] `ScoreSnapshot` tem propriedades `init` (imutável)
- [ ] `Source` tem `SourceType`, `CollectedAt`, `OriginalUrl`, `Hash`, `License`

### ETL

- [ ] `uv sync --extra dev` — completa sem erro
- [ ] `uv run ruff check .` — sem erros de lint
- [ ] `uv run mypy src/` — `Success: no issues found`
- [ ] `uv run pytest` — executa sem crash

### Graph + Infra

- [ ] `docker compose up -d` — sobe 3 serviços sem erro
- [ ] `docker compose ps` — todos os 3 serviços com status `healthy`
- [ ] PostgreSQL aceita conexões em `localhost:5432`
- [ ] Redis responde `PONG` em `localhost:6379`
- [ ] Neo4j Browser acessível em `http://localhost:7474`
- [ ] `graph/schema.md` — documenta 6 nós e 6 arestas com propriedades
- [ ] `graph/queries/exemplos.cypher` — 5 queries comentadas

---

## Steps de verificação

- [ ] **1. Verificar estrutura de arquivos completa**

A partir de `C:\Users\Elias\Documents\RepBrasil`:

```bash
# Verificar que nenhuma pasta obrigatória está faltando
ls docs/adrs/        # deve ter 7 arquivos ADR-001 a ADR-007
ls methodology/      # deve ter 4 arquivos
ls docs/ux/          # deve ter 2 arquivos
ls graph/queries/    # deve ter 1 arquivo .cypher
```

- [ ] **2. Verificar que `.env` não está no repositório**

```bash
git status
# .env NÃO deve aparecer em nenhuma lista
git ls-files infra/.env
# deve retornar vazio
```

- [ ] **3. Rodar todos os comandos de verificação técnica**

```bash
# Frontend
cd frontend && npm run typecheck && npm run lint && npm run build && cd ..

# Backend
cd backend && dotnet build && cd ..

# ETL
cd etl && uv run ruff check . && uv run mypy src/ && uv run pytest && cd ..

# Infra (se não estiver rodando)
cd infra && docker compose up -d && cd ..
```

- [ ] **4. Verificar endpoints do backend**

Backend deve estar rodando (`dotnet run` em `backend/src/RepBrasil.API/`):

```bash
curl -s http://localhost:5000/health
# Esperado: HTTP 200, corpo vazio

curl -s http://localhost:5000/api/v1/status | python -m json.tool
# Esperado:
# {
#   "status": "ok",
#   "version": "0.1.0",
#   "environment": "Development",
#   "timestamp": "..."
# }
```

- [ ] **5. Verificar que o README principal está correto no GitHub**

```bash
gh repo view oeliasandraade/REPBrasil --web
```

Verificar visualmente:
- Título e slogan visíveis
- Tabela de stack renderizada
- Link para `CONTRIBUTING.md` funciona
- Licença AGPL-3.0 exibida

- [ ] **6. Verificar histórico de commits**

```bash
git log --oneline
```

Esperado (commits em ordem cronológica inversa, um por bloco):
```
feat(infra): docker-compose PostgreSQL+Redis+Neo4j, schema de grafo, guia Railway
feat(etl): scaffold Python com BasePipeline, schemas Pydantic, tooling ruff/mypy/pytest
feat(backend): scaffold .NET 8 Clean Architecture, entidades de domínio, health check, Swagger
feat(frontend): scaffold Next.js 15 com TypeScript, Tailwind, home placeholder
docs: documentação institucional completa — manifesto, governança, metodologia, ADRs, LGPD, UX
chore: fundação do repositório — estrutura de pastas, arquivos raiz, README, licença AGPL-3.0
```

- [ ] **7. Verificar que o roadmap reflete o estado atual**

Abrir `docs/roadmap.md` e confirmar que todos os itens da Fase 0 estão marcados como `[x]`.

- [ ] **8. Commit e push final (se houver ajustes pendentes)**

```bash
git add .
git commit -m "chore: revisão final Fase 0 — ajustes de consistência e verificações"
git push
```

---

## Próximos passos (Fase 1)

Com a Fase 0 completa, o próximo trabalho é:

### Prioridade P0 (Fase 1 — Dados básicos)

1. **Implementar `TseCandidatesPipeline`** em `etl/src/sources/tse/`
   - Coletar candidatos das últimas eleições (2022, 2024)
   - Validar com `PoliticianSchema`
   - Popular `Politicians` no PostgreSQL

2. **Implementar `TseAssetsPipeline`**
   - Coletar bens declarados por eleição
   - Popular `AssetDeclarations`

3. **Implementar `TseResultsPipeline`**
   - Coletar resultados eleitorais por município
   - Popular `ElectionResults`

4. **Criar endpoint `GET /api/v1/politicians/{id}`**
   - Retornar perfil básico com dados do TSE

5. **Criar endpoint `GET /api/v1/politicians/search?q=`**
   - Busca por nome/partido/estado via PostgreSQL FTS

6. **Criar página de perfil no frontend** (`/politico/[id]`)
   - Card de identidade
   - Dados eleitorais básicos

### Referências para a Fase 1

- Dados TSE: https://dados.tse.jus.br/
- API Câmara: https://dadosabertos.camara.leg.br/swagger/api.html
- Metodologia do score: `methodology/score-publico-v1.md`
- Schema de entidades: `backend/src/RepBrasil.Domain/Entities/`
- Interface dos pipelines: `etl/src/pipeline/base.py`

---

## Critérios de sucesso deste bloco

- [ ] Todos os 13 itens de checklist da Fase 0 marcados como completos
- [ ] `git log` mostra commits organizados por bloco
- [ ] Repositório GitHub público, README correto, AGPL-3.0
- [ ] Qualquer desenvolvedor pode clonar e subir o ambiente local sem instrução adicional
- [ ] `docs/roadmap.md` atualizado com Fase 0 concluída

---

## Riscos residuais

| Risco | Status | Ação |
|-------|--------|------|
| `dotnet build` falha se PostgreSQL não estiver rodando | Aceito para Fase 0 | Documentado: infra precisa estar ativa para testar endpoints |
| Neo4j não populado | Planejado | Fase 4 |
| Frontend sem dados reais | Planejado | Fase 1 |
| Pipelines ETL não funcionais | Planejado | Fase 1 |
| Score não calculado | Planejado | Fase 2 |
| LGPD — base legal não testada juridicamente | Risco aceito | Revisar com jurídico antes da Fase 3 (exposição pública) |
