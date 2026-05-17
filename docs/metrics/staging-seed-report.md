# Staging Seed Report — TSE 2024 Ceará

**Data:** 2026-05-17
**Ambiente:** Railway staging (`back-production-8d1d.up.railway.app`)
**Banco:** `caboose.proxy.rlwy.net:30608/railway`
**Script:** `etl/scripts/seed_ce.py`
**Filtro:** `state_filter=CE` (candidatos/resultados) | `tse_ids_filter` (bens)

---

## Resumo Executivo

| Indicador | Valor |
|---|---|
| Status geral | ⚠️ PARCIAL — candidatos ✅ resultados ✅ bens ❌ |
| Politicians CE carregados | 13.234 |
| Resultados eleitorais CE | 12.096 (novos) |
| Eleitos CE | 2.378 |
| Bens declarados | 0 novos (pipeline falhou — SSL timeout) |
| DB size pós-seed | 26 MB |
| Tempo total | 81,1 min |

---

## Contagens Pré/Pós-Seed

| Tabela | Pré-seed | Pós-seed | Delta |
|---|---|---|---|
| Politicians | 1.000 | 14.219 | +13.219 |
| Elections | 4.249 | 4.486 | +237 |
| ElectionResults | 7 | 12.103 | +12.096 |
| AssetDeclarations | 1 | 1 | 0 |
| AssetItems | 3 | 3 | 0 |
| Sources | 3 | 3 | 0 |
| **DB size** | ~20 MB | **26 MB** | +6 MB |

**Politicians CE total:** 13.234
**Eleitos CE:** 2.378
**Politicians CE com resultado eleitoral:** 13.234 (todos têm TseId mapeável)
**DB size pós-seed:** 26 MB

---

## Pipelines Executados

| Pipeline | Filtro | Comportamento | Status | Tempo |
|---|---|---|---|---|
| TseCandidatesPipeline | state_filter=CE | 463.809 brutos → 13.242 CE | ✅ SUCESSO | 2317,7s (38,6 min) |
| TseResultsPipeline | state_filter=CE | SG_UF=CE | ✅ SUCESSO | 2174,3s (36,2 min) |
| TseAssetsPipeline | tse_ids_filter (IDs CE) | SSL timeout após 374s | ❌ FALHOU | 374,3s (6,2 min) |
| **TOTAL** | | | ⚠️ PARCIAL | **4866,3s (81,1 min)** |

---

## Integridade Referencial

| Verificação | Resultado | Status |
|---|---|---|
| Orphan ElectionResults | 0 | ✅ OK |
| Orphan AssetDeclarations | 0 | ✅ OK |
| Orphan AssetItems | 0 | ✅ OK |
| TseId duplicados | 0 | ✅ OK |

---

## Fontes Registradas

| Nome | Tipo | Coletado em |
|---|---|---|
| TSE Bens Declarados 2024 — bem_candidato_2024_BRASIL.csv | assets | 2026-05-17 03:51 UTC (run anterior) |
| TSE Candidatos 2024 — consulta_cand_2024_BRASIL.csv | candidates | 2026-05-17 18:19 UTC |
| TSE Resultados Eleitorais 2024 — votacao_candidato_munzona_2024_BRASIL.csv | results | 2026-05-17 18:58 UTC |

---

## Problemas Encontrados

### Assets CE — SSL timeout (374s)

**Causa:** A conexão com o PostgreSQL Railway caiu por SSL timeout após ~374s de execução contínua do `TseAssetsPipeline`. O arquivo CSV de bens (`bem_candidato_2024_BRASIL.csv`) tem >460k linhas — o processamento levou mais tempo que o limite de conexão do Railway.

**Erro:**
```
OperationalError: SSL connection has been closed unexpectedly
psycopg2.InterfaceError: connection already closed
```

**Impacto:** 0 novas declarações carregadas para CE. As declarações existentes (1 registro de run anterior) não foram afetadas.

**Mitigação planejada:**
1. Implementar commit por batch no TseAssetsPipeline (ex.: COMMIT a cada 500 registros)
2. Usar `connect_timeout` e `keepalives` no psycopg2
3. Ou pré-filtrar o CSV localmente antes de carregar

---

## Datasets Pendentes

| Dataset | Motivo |
|---|---|
| TSE Bens Declarados CE 2024 | Pipeline falhou (SSL timeout) — re-executar com fix |
| TSE Filiações Partidárias | Pipeline não implementado — Roadmap G1-4 |
| TSE Doações de Campanha | Pipeline não implementado — Roadmap G2-2 |
| Câmara — Deputados federais | Pipeline não implementado — Roadmap G1-1 |
| Senado — Senadores | Pipeline não implementado — Roadmap G1-2 |
| Demais 25 UFs + DF | Seed incremental futuro |
| Eleições 2018, 2020, 2022 | Seed histórico futuro |

---

## Limitações Atuais

1. Cobertura geográfica: apenas CE — 25 UFs + DF pendentes
2. Cobertura temporal: apenas eleição 2024
3. Bens declarados: pipeline com problema de SSL timeout — 0 registros CE
4. Entidade Person: implementada no schema, sem vínculos preenchidos
5. Filiações partidárias: sem pipeline
6. Neo4j: não populado — aguarda Fase 3 Grupo 3
7. Bloco 0 migrations: aplicadas em staging via POST /migrate em 2026-05-17

---

## Recomendações

1. **Fix prioritário:** Corrigir TseAssetsPipeline com batch commit + keepalives antes de re-seed
2. Próximo seed: UFs nordestinas — mesmo padrão (state_filter=XX)
3. Eleições 2022: mesmo filtro por UF (mesmo esquema CSV)
4. Câmara API (G1-1): CamaraId já existe em Politician — conector pronto para implementar
5. Bloco 0 completo: todas as 5 migrations do Bloco 0 aplicadas em staging
