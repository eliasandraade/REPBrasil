# Grupo 1 — Câmara dos Deputados: Roadmap de Integração

**Status:** Planejamento — Não implementado
**Pré-requisito:** Nordeste seed estabilizado + assets CE validados
**Data do planejamento:** 2026-05-17

---

## Contexto

O `Politician` já possui `CamaraId` (string nullable). Quando preenchido,
representa o ID do parlamentar na API da Câmara dos Deputados.

As migrations do Bloco 0 adicionaram `Person`, `Evidence`, `Source` expandido
e `TransformationChain` — fundação necessária para rastrear dados da Câmara.

---

## Dados Disponíveis na API da Câmara

A API da Câmara (https://dadosabertos.camara.leg.br/api/v2) oferece:

| Endpoint | Dados | Frequência |
|---|---|---|
| `/deputados` | Lista de deputados federais (mandato atual) | Diária |
| `/deputados/{id}` | Perfil completo, partido, estado, foto | Por demanda |
| `/deputados/{id}/despesas` | CEAP — reembolsos mensais | Mensal |
| `/deputados/{id}/votacoes` | Histórico de votações nominais | Por sessão |
| `/deputados/{id}/discursos` | Discursos em plenário | Por sessão |
| `/deputados/{id}/orgaos` | Comissões e órgãos | Por legislatura |
| `/partidos` | Lista de partidos com IDs | Estável |

---

## Entidades Existentes Afetadas

| Entidade | Campo | Uso Câmara |
|---|---|---|
| `Politician` | `CamaraId` | FK para `/deputados/{id}` |
| `Politician` | `Office` | "DEPUTADO FEDERAL" para filtrar |
| `ElectionResult` | `Elected` | Apenas eleitos terão CamaraId |
| `Source` | `OriginalUrl` | URL da API Câmara |
| `Evidence` | `SourceId`, `EvidenceType` | Para despesas e votações |

---

## Pipelines a Criar (Grupo 1)

### G1-1: CamaraDeputadosPipeline
- **Fonte:** `GET /deputados?itens=500&pagina=N`
- **Objetivo:** Preencher `CamaraId` nos Politicians com `Office = DEPUTADO FEDERAL`
- **Método:** JOIN por nome/partido/UF (TSE vs Câmara nomes divergem)
- **Risco:** Matching por nome é impreciso — requere heurística de normalização
- **Entidade afetada:** `Politician.CamaraId` (UPDATE, não INSERT)

### G1-2: CamaraDespesasPipeline (CEAP)
- **Fonte:** `GET /deputados/{id}/despesas?ano=YYYY&mes=MM`
- **Objetivo:** Armazenar reembolsos CEAP como evidências documentais
- **Entidade nova necessária:** `CeapExpense` (ou usar `Evidence` + `AssetItem` pattern)
- **Volume:** ~555 deputados × 12 meses × ~50 despesas = ~330k registros/ano
- **Risco:** API paginada, sem download em bulk

### G1-3: CamaraVotacoesPipeline
- **Fonte:** `GET /votacoes?idDeputado={id}`
- **Objetivo:** Registrar votações nominais como evidências
- **Entidade afetada:** `Evidence` (EvidenceType="Primary", DatasetId="camara-votacao")
- **Volume:** Alto — potencialmente 10k+ votações por legislatura

---

## Novas Entidades Necessárias (a definir em design)

| Entidade | Propósito |
|---|---|
| `CeapExpense` | Despesa CEAP mensal por categoria |
| `VotingRecord` | Voto nominal em proposição específica |
| `Mandate` | Mandato parlamentar com período e casa |

---

## Decisões Pendentes

1. **Matching TSE → Câmara:** Nome exact match falha (variações de acentuação, abreviações). Opções:
   - Match por (Nome normalizado + Partido + UF) com threshold fuzzy
   - Match manual para casos ambíguos
   - Usar CPF quando disponível publicamente

2. **CEAP como Evidence ou tabela própria:** Evidence é genérica (1 registro por fato). CEAP tem estrutura tabular própria (categoria, fornecedor, CNPJ, data, valor). Tabela própria é mais consultável.

3. **Votações: granularidade por proposição ou por sessão:** Por proposição permite análise de padrão de voto. Por sessão é mais simples de carregar.

4. **Deputados Estaduais:** As assembleias legislativas têm APIs próprias por estado — não padronizadas. Não incluir no Grupo 1.

---

## Cronograma Sugerido (após Nordeste estabilizado)

1. **Design:** Definir CeapExpense, VotingRecord, Mandate (1-2 dias)
2. **G1-1:** CamaraDeputadosPipeline — matching e preenchimento de CamaraId (3-5 dias)
3. **G1-2:** CamaraDespesasPipeline CEAP — um ano de dados (3-5 dias)
4. **G1-3:** CamaraVotacoesPipeline — legislatura atual (5-7 dias)

**Pré-requisito de cada etapa:** testes + seed local + smoke test staging antes de avançar.

---

## O Que NÃO Fazer no Grupo 1

- Não criar score automático baseado em votações
- Não classificar deputados por linha ideológica
- Não inferir padrões de comportamento
- Não raspar sites — usar apenas API oficial da Câmara
- Não integrar Senado ainda (API diferente, escopo separado)
