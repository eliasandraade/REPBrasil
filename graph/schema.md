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
