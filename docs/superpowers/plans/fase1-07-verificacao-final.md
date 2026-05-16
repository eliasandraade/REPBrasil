# REPBrasil Fase 1 — Bloco 7: Verificação Final Integrada

> **Para execução:** Use `superpowers:subagent-driven-development` ou `superpowers:executing-plans`.
> **Depende de:** Blocos 1–6 completos.

**Objetivo:** Verificar que o fluxo completo funciona de ponta a ponta — ETL popula o banco, API serve os dados, frontend busca e exibe perfil. Confirmar que todos os builds, testes e lints passam. Atualizar o roadmap.

> **⚠️ Escopo da Fase 1:** Os dados do TSE 2024 carregados nesta verificação são exclusivamente para validação técnica do fluxo (ETL real → PostgreSQL → API → frontend). Não representam a base eleitoral definitiva do REPBrasil 2026. A curadoria de quais eleições e cargos integrar é decisão de produto da Fase 2+.

---

## Checklist completo da Fase 1

### ETL

- [ ] `uv run ruff check .` — sem erros
- [ ] `uv run mypy src/` — `Success: no issues found`
- [ ] `uv run pytest tests/` — todos os testes passando
- [ ] `TseCandidatesPipeline` existe em `etl/src/sources/tse/candidates.py`
- [ ] `etl/src/db/connection.py` existe com `get_db()` context manager
- [ ] `data/raw/tse/` existe localmente (não versionado)

### Backend

- [ ] `dotnet build` — `Build succeeded. 0 Warning(s) 0 Error(s)`
- [ ] Migrations existem em `backend/src/RepBrasil.Infrastructure/Migrations/`
- [ ] `GET /api/v1/politicians?q=silva` — retorna JSON paginado
- [ ] `GET /api/v1/politicians/{id}` — retorna detalhes ou 404
- [ ] `GET /health` — HTTP 200
- [ ] `GET /api/v1/status` — JSON com status/version/environment/timestamp
- [ ] `IPoliticianRepository` interface em `RepBrasil.Application/Interfaces/`
- [ ] `PoliticianRepository` implementação em `RepBrasil.Infrastructure/Repositories/`
- [ ] `SearchPoliticiansQuery` e `GetPoliticianByIdQuery` em `RepBrasil.Application/Politicians/Queries/`
- [ ] `PagedResult<T>` em `RepBrasil.Application/Common/`

### Frontend

- [ ] `npm run typecheck` — sem erros
- [ ] `npm run lint` — sem warnings
- [ ] `npm run build` — compila sem erros
- [ ] Home: campo de busca funcional (não disabled)
- [ ] `/politicos?q=silva` — lista políticos com nome "silva"
- [ ] `/politico/{id}` — exibe perfil com dados reais
- [ ] UUID inexistente — exibe "Político não encontrado"
- [ ] Link "← Voltar à busca" presente no perfil
- [ ] Score placeholder visível com mensagem "Disponível na Fase 2"

### Infra

- [ ] `docker compose ps` — postgres, redis, neo4j `healthy`
- [ ] PostgreSQL: tabela `Politicians` tem registros reais do TSE

---

## Steps de verificação

- [ ] **1. Subir infra**

```bash
cd infra
docker compose up -d
# aguardar ~30s
docker compose ps
```

Todos os 3 serviços devem estar `healthy`.

- [ ] **2. Rodar ETL com dados de validação**

```bash
cd etl
uv run python -c "
from src.sources.tse.candidates import TseCandidatesPipeline
p = TseCandidatesPipeline(limit=200)
p.run()
"
```

Verificar contagem no banco:

```bash
docker exec repbrasil-postgres psql -U repbrasil -d repbrasil \
  -c 'SELECT COUNT(*) FROM "Politicians";'
```

Esperado: 200 (ou próximo — alguns podem ser filtrados por status de candidatura).

> Estes 200 registros são uma amostra técnica do TSE 2024, usada apenas para validar o fluxo completo. Não representam a base definitiva do produto.

- [ ] **3. Rodar API**

```bash
cd backend/src/RepBrasil.API
dotnet run &
```

- [ ] **4. Testar endpoints**

```bash
# Busca
curl -s "http://localhost:5000/api/v1/politicians?q=silva&pageSize=3" | python -m json.tool

# Health
curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/health

# Status
curl -s http://localhost:5000/api/v1/status | python -m json.tool
```

- [ ] **5. Testar frontend**

```bash
cd frontend
npm run dev &
```

Abrir `http://localhost:3000` e verificar fluxo completo:
1. Buscar "silva" → ver lista de políticos
2. Clicar em um → ver perfil
3. Clicar "← Voltar" → voltar à lista
4. Buscar termo sem resultados → ver mensagem

- [ ] **6. Rodar todos os testes e verificações**

```bash
# ETL
cd etl && uv run ruff check . && uv run mypy src/ && uv run pytest tests/ && cd ..

# Backend
cd backend && dotnet build && cd ..

# Frontend
cd frontend && npm run typecheck && npm run lint && npm run build && cd ..
```

- [ ] **7. Verificar que `.env` não está no git**

```bash
git ls-files infra/.env frontend/.env.local
```

Esperado: saída vazia (nenhum arquivo tracked).

- [ ] **8. Atualizar `docs/roadmap.md`**

Abrir `docs/roadmap.md` e marcar todos os itens da Fase 1 como `[x]`.

- [ ] **9. Verificar git log**

```bash
git log --oneline
```

Esperado: commits da Fase 1 após os da Fase 0.

- [ ] **10. Commit final se houver ajustes**

```bash
git add docs/roadmap.md
git commit -m "chore: revisão final Fase 1 — roadmap atualizado"
git push
```

---

## Critérios de sucesso

- [ ] ETL carrega políticos reais no banco com dados do TSE 2024
- [ ] Backend responde corretamente nos dois endpoints
- [ ] Frontend completa o fluxo busca → listagem → perfil sem erros
- [ ] Todos os builds, testes e lints passando
- [ ] Roadmap atualizado com Fase 1 concluída

---

## Próximos passos (Fase 2)

Com a Fase 1 completa, a Fase 2 focará em:

1. **Dados adicionais do TSE** — bens declarados (`TseAssetsPipeline`), resultados eleitorais (`TseResultsPipeline`)
2. **Dados da Câmara** — deputados, despesas, votações (`CamaraDeputadosPipeline`, `CamaraExpensesPipeline`)
3. **Score básico** — cálculo do score com os pilares de Integridade Pública e Transparência Patrimonial
4. **Perfil expandido** — abas no frontend: histórico eleitoral, patrimônio declarado
5. **Deploy** — Railway com domínio público

---

## Riscos residuais

| Risco | Status | Ação |
|-------|--------|------|
| ETL lento com volume completo (~500k candidatos) | Aceito para Fase 1 com `limit=200` | Otimizar com bulk insert na Fase 2 |
| Score não calculado | Planejado | Fase 2 |
| Dados de patrimônio ausentes | Planejado | Fase 2 |
| Neo4j não populado | Planejado | Fase 4 |
| LGPD — base legal não testada juridicamente | Risco aceito | Revisar com jurídico antes da Fase 3 |
