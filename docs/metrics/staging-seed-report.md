# Staging Seed Report — TSE 2024 Ceará

**Data:** 2026-05-17 (seed_ce) · 2026-05-17 (re-seed assets CE com fix)
**Ambiente:** Railway staging (`back-production-8d1d.up.railway.app`)
**Banco:** `caboose.proxy.rlwy.net:30608/railway`
**Scripts:** `etl/scripts/seed_ce.py` + `etl/scripts/seed_assets_ce.py`
**Filtro:** `state_filter=CE` (candidatos/resultados) | `tse_ids_filter` (bens)

---

## Resumo Executivo

| Indicador | Valor |
|---|---|
| Status geral | ✅ COMPLETO — candidatos ✅ resultados ✅ bens ✅ |
| Politicians CE carregados | 13.234 |
| Resultados eleitorais CE | 12.096 (novos) |
| Eleitos CE | 2.378 |
| AssetDeclarations CE | 8.557 (re-seed com fix — 2026-05-17) |
| AssetItems CE | 23.231 |
| DB size pós re-seed | 34 MB |
| Tempo total (todos os pipelines) | ~174 min |

---

## Contagens Finais Pós-Seed Completo

| Tabela | Inicial | Pós seed_ce | Pós re-seed assets | Delta total |
|---|---|---|---|---|
| Politicians | 1.000 | 14.219 | 14.219 | +13.219 |
| Elections | 4.249 | 4.486 | 4.486 | +237 |
| ElectionResults | 7 | 12.103 | 12.103 | +12.096 |
| AssetDeclarations | 1 | 1 | 8.558 | +8.557 |
| AssetItems | 3 | 3 | 23.234 | +23.231 |
| Sources | 3 | 3 | 3 | 0 |
| **DB size** | ~20 MB | 26 MB | **34 MB** | +14 MB |

**Politicians CE total:** 13.234
**Eleitos CE:** 2.378
**AssetDeclarations CE:** 8.557 (65% dos políticos CE declararam bens — esperado)
**DB size pós-seed completo:** 34 MB

---

## Pipelines Executados

### seed_ce.py — 2026-05-17

| Pipeline | Filtro | Comportamento | Status | Tempo |
|---|---|---|---|---|
| TseCandidatesPipeline | state_filter=CE | 463.809 brutos → 13.242 CE | ✅ SUCESSO | 2317,7s (38,6 min) |
| TseResultsPipeline | state_filter=CE | SG_UF=CE | ✅ SUCESSO | 2174,3s (36,2 min) |
| TseAssetsPipeline (v1) | tse_ids_filter (IDs CE) | SSL timeout após 374s | ❌ FALHOU | 374,3s (6,2 min) |

### seed_assets_ce.py — 2026-05-17 (fix aplicado)

| Pipeline | Filtro | Comportamento | Status | Tempo |
|---|---|---|---|---|
| TseAssetsPipeline (v2) | 13.234 TseIds CE | 910.878 → 23.231 linhas CE → 8.557 decls | ✅ SUCESSO | 5537,2s (92,3 min) |

**Fix aplicado:** TCP keepalives + batch commits (batch_size=250). 35 batches commitados sem nenhum SSL timeout.

---

## Métricas de Throughput — Assets CE (re-seed)

| Métrica | Valor |
|---|---|
| Linhas CSV brutas | 910.878 |
| Linhas CE após filtro | 23.231 |
| Declarações transformadas | 8.557 |
| Políticos encontrados no DB | 8.557 / 8.557 (100%) |
| Ignorados (sem match) | 0 |
| AssetItems carregados | 23.231 |
| Batches (×250 decls) | 35 (34 completos + 1 final de 57) |
| Throughput médio | ~1,5 decls/s (90 decls/min) |
| Tempo total load | 5.537s (92,3 min) |
| SSL timeouts | 0 |

---

## Integridade Referencial (pós re-seed completo)

| Verificação | Resultado | Status |
|---|---|---|
| Orphan ElectionResults | 0 | ✅ OK |
| Orphan AssetDeclarations | 0 | ✅ OK |
| Orphan AssetItems | 0 | ✅ OK |
| TseId duplicados | 0 | ✅ OK |
| Duplicidades AssetDeclarations (PoliticianId+ElectionYear) | 0 | ✅ OK |

---

## Smoke Test API — Assets CE

| Rota | Político | Status | Resultado |
|---|---|---|---|
| `/api/v1/politicians/{id}/assets` | Glício Arruda Brito (CE) | 200 ✅ | 1 declaração, 73 itens, R$ 634.342,01 |

---

## Fontes Registradas

| Nome | Tipo | Coletado em |
|---|---|---|
| TSE Bens Declarados 2024 — bem_candidato_2024_BRASIL.csv | assets | 2026-05-17 (re-seed fix) |
| TSE Candidatos 2024 — consulta_cand_2024_BRASIL.csv | candidates | 2026-05-17 18:19 UTC |
| TSE Resultados Eleitorais 2024 — votacao_candidato_munzona_2024_BRASIL.csv | results | 2026-05-17 18:58 UTC |

---

## Histórico de Problemas

### ~~Assets CE — SSL timeout (374s)~~ — RESOLVIDO

**Causa original:** Transação única para todas as declarações. Railway derrubou a conexão SSL após ~374s.

**Fix implementado (2026-05-17):**
- `get_db_batch()` — context manager com TCP keepalives (`keepalives=1, idle=30s, interval=5s, count=5`)
- Batch commits a cada 250 declarações (`batch_size=250`, configurável)
- Re-seed executado com `seed_assets_ce.py` — 35 batches, 92,3 min, 0 timeouts

---

## Datasets Pendentes

| Dataset | Motivo |
|---|---|
| Nordeste (BA, PE, MA, PB, PI, RN, AL, SE) | Seed incremental — `seed_nordeste.py` pronto |
| TSE Filiações Partidárias | Pipeline não implementado — Roadmap G1-4 |
| TSE Doações de Campanha | Pipeline não implementado — Roadmap G2-2 |
| Câmara — Deputados federais | Pipeline não implementado — Roadmap G1-1 |
| Senado — Senadores | Pipeline não implementado — Roadmap G1-2 |
| Eleições 2018, 2020, 2022 | Seed histórico futuro |

---

## Limitações Atuais

1. Cobertura geográfica: CE completo + Nordeste pendente (seed_nordeste.py pronto)
2. Cobertura temporal: apenas eleição 2024
3. Entidade Person: implementada no schema, sem vínculos preenchidos
4. Filiações partidárias: sem pipeline
5. Neo4j: não populado — aguarda Fase 3 Grupo 3
6. Bloco 0 migrations: aplicadas em staging via POST /migrate em 2026-05-17

---

## Status Final

**CE: SEED COMPLETO** — 13.234 políticos, 12.096 resultados, 8.557 declarações de bens.
**Fix TseAssetsPipeline:** ✅ Validado em produção — 35 batches sem SSL timeout.
**Próximo passo:** `seed_nordeste.py` — BA, PE, MA, PB, PI, RN, AL, SE (~15–20h).
