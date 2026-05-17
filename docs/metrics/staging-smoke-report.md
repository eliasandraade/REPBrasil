# Staging Smoke Report

**Data:** 2026-05-17
**Ambiente:** Railway staging
**Base URL:** `https://back-production-8d1d.up.railway.app`
**Versão:** v0.1.0
**Migrations aplicadas:** 11 (6 originais + 5 Bloco 0)
**Políticos CE disponíveis:** 13.234

---

## Resultados

| Rota | Método | Status HTTP | Resultado | OK? |
|---|---|---|---|---|
| `/health` | GET | 200 | Body vazio (ok) | ✅ |
| `/api/v1/status` | GET | 200 | `{"status":"ok","version":"0.1.0","environment":"Production"}` | ✅ |
| `/swagger` | GET | 200 | Swagger UI acessível | ✅ |
| `/api/v1/politicians?state=CE&pageSize=5` | GET | 200 | `totalCount=13234`, `totalPages=2647` | ✅ |
| `/api/v1/politicians/{id}` | GET | 200 | Perfil: Abelardo Alves Rodrigues, state=CE | ✅ |
| `/api/v1/politicians/{id}/elections` | GET | 200 | 1 resultado eleitoral | ✅ |
| `/api/v1/politicians/{id}/assets` | GET | 200 | 0 bens (pipeline falhou — esperado) | ⚠️ |
| `/api/v1/politicians/{id}/sources` | GET | 200 | 3 fontes | ✅ |
| `/api/v1/politicians/{id}/score` | GET | 200 | Placeholder `em_desenvolvimento` | ✅ |
| `/api/v1/politicians/{id}/score/history` | GET | 200 | Vazio (esperado) | ✅ |
| `/api/v1/politicians?q=jose&state=CE&pageSize=5` | GET | 200 | `totalCount=737` | ✅ |
| CORS `Origin: https://repbrasil.up.railway.app` | GET | 200 | Header correto | ✅ |

**Resultado: 11/12 ✅ — 1 ⚠️ (bens — pipeline de assets falhou no seed, não é bug de API)**

---

## Detalhes por Rota

### `/health` — 200 ✅
Retorna body vazio com status 200. Endpoint de liveness funcional.

### `/api/v1/status` — 200 ✅
```json
{"status":"ok","version":"0.1.0","environment":"Production","timestamp":"2026-05-17T19:37:49.8166694+00:00"}
```

### `/swagger` — 200 ✅
Swagger UI carregou sem erros.

### `/api/v1/politicians?state=CE&pageSize=5` — 200 ✅
```json
{
  "totalCount": 13234,
  "page": 1,
  "pageSize": 5,
  "totalPages": 2647,
  "hasNext": true,
  "hasPrevious": false
}
```
Campos presentes: id, name, ballotName, tseId, partyAcronym, office, state.

### `/api/v1/politicians/{id}` — 200 ✅
Politician: Abelardo Alves Rodrigues, PDT, VEREADOR, state=CE.

### `/api/v1/politicians/{id}/elections` — 200 ✅
1 resultado eleitoral. Rota `/elections` (não `/election-results`) confirmada.

### `/api/v1/politicians/{id}/assets` — 200 ⚠️
Retorna 0 bens. O TseAssetsPipeline falhou no seed por SSL timeout — sem dados de bens para este político. Não é bug de API.

### `/api/v1/politicians/{id}/sources` — 200 ✅
3 fontes: TSE Bens Declarados, TSE Candidatos, TSE Resultados.

### `/api/v1/politicians/{id}/score` — 200 ✅
```json
{
  "status": "em_desenvolvimento",
  "methodologyVersion": "v0",
  "generatedAt": null,
  "totalScore": null,
  "factors": [],
  "disclaimer": "Score Público em desenvolvimento. Não representa recomendação de voto, julgamento moral ou inferência automática."
}
```
Placeholder correto. Sem inferência automática.

### `/api/v1/politicians/{id}/score/history` — 200 ✅
Retorna array vazio. Esperado.

### Busca `?q=jose&state=CE` — 200 ✅
`totalCount=737` políticos CE com "jose" no nome. Busca funcional.

### CORS — ✅
`Access-Control-Allow-Origin: https://repbrasil.up.railway.app` — header correto.

---

## Migrações Aplicadas (Bloco 0)

| Migration | Status |
|---|---|
| `20260517190943_AddPersonEntity` | ✅ |
| `20260517191233_ExpandSourceFields` | ✅ |
| `20260517191622_AddTransformationChain` | ✅ |
| `20260517192632_ExpandEvidence` | ✅ |
| `20260517193049_ExpandContestation` | ✅ |

Novas tabelas: `Persons`, `TransformationChains`, `TransformationSteps`.

---

## Observações

1. **Assets vazios** — não é bug de rota; é consequência do TseAssetsPipeline ter falhado no seed por SSL timeout após 374s. Fix planejado: batch commit + keepalives.
2. **Score placeholder correto** — disclaimer presente e sem inferência.
3. **CORS configurado** — apenas `https://repbrasil.up.railway.app` permitido (sem `*`).
4. **Bloco 0 migrations** — todas aplicadas via `POST /migrate` em 2026-05-17 após limpeza de conexão idle-in-transaction do seed.

---

## Status Final

**STAGING OPERACIONAL** — 13.234 políticos CE, APIs funcionais, Bloco 0 aplicado.
Próximo passo: fix TseAssetsPipeline + re-seed assets CE.
