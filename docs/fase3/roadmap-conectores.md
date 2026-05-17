# Roadmap de Conectores — REPBrasil

> Ordem de implementação dos conectores da Fase de Expansão.
> **Versão:** 1.0 | **Data:** 2026-05-17 | **Status:** Vigente
>
> Baseado na análise da [`matriz-nacional-de-fontes.md`](matriz-nacional-de-fontes.md),
> [`ontologia-repbrasil.md`](ontologia-repbrasil.md) e [`camada-de-evidencia.md`](camada-de-evidencia.md).

---

## Pré-requisito: Bloco 0 — Completar a Camada de Evidência

**Antes de qualquer conector novo, a camada de evidência precisa ser completada.**

Nenhum conector da Fase de Expansão deve ser implementado sem que as seguintes migrations existam:

| Migration | Descrição | Impacto |
|---|---|---|
| `AddSourceMetadata` | Adiciona `CollectionMethod`, `SchemaVersion`, `DatasetVersion`, `ConfidenceLevel` à `Source` | Todos os conectores existentes e novos |
| `AddEvidenceFields` | Adiciona `EvidenceType`, `ConfidenceLevel`, `ConfidenceGrade`, `TransformationLog`, `ContestationStatus`, `Hash` à `Evidence` | Todos os conectores existentes e novos |
| `AddContestationReferences` | Adiciona `EntityType`, `EntityId`, `EvidenceId`, `SubmittedAt`, `ResolvedAt` à `Contestation` | Sistema de contestação |
| `AddPersonEntity` | Cria entidade `Person` (base de CompanyPartnership, CampaignDonation, PEP) | Conectores que geram pessoas não-políticas |

Estes são pré-requisitos hard — implementar conectores sem eles produz dados sem rastreabilidade adequada.

---

## Dimensões de Avaliação

Cada conector é avaliado em 7 dimensões:

| Dimensão | Escala | Descrição |
|---|---|---|
| **Impacto no sistema** | Alto / Médio / Baixo | Quanto novas entidades/relações o conector adiciona ao modelo |
| **Valor investigativo** | Alto / Médio / Baixo | Relevância documental para transparência — independente de complexidade técnica |
| **Complexidade técnica** | Alta / Média / Baixa | Dificuldade de implementação do ETL (formato, volume, parsing, autenticação) |
| **Risco jurídico** | Alto / Médio / Baixo | LGPD, termos de uso, base legal, risco de contestação jurídica |
| **Custo computacional** | Alto / Médio / Baixo | Volume de dados, frequência de atualização, necessidade de infraestrutura especial |
| **Dependências** | Lista de conectores ou entidades necessárias antes |
| **Fase de infraestrutura** | Postgres-only / Precisa Neo4j / Precisa job contínuo / Precisa NLP |

---

## Matriz de Priorização Completa

| # | Conector | Impacto | Valor Inv. | Complexidade | Risco Jurídico | Custo Computacional | Dependências | Infra | Grupo |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Camada de Evidência (Bloco 0) | Alto | — | Baixa | Baixo | Baixo | — | Postgres | PRÉ |
| 2 | TSE — Filiações Partidárias | Médio | Alto | Alta | Baixo | Alto | TSE Candidatos | Postgres | 1 |
| 3 | Câmara — Deputados Completo | Alto | Alto | Baixa | Baixo | Baixo | — | Postgres | 1 |
| 4 | Câmara — CEAP (Gastos) | Alto | Alto | Média | Baixo | Médio | Câmara Deputados | Postgres | 1 |
| 5 | Senado — Senadores Completo | Alto | Alto | Média | Baixo | Baixo | — | Postgres | 1 |
| 6 | CEIS / CNEP | Alto | Muito alto | Baixa | Baixo | Baixo | — | Postgres | 1 |
| 7 | CGU PEP | Médio | Alto | Baixa | Médio | Baixo | Person entity | Postgres | 1 |
| 8 | TSE — Doações de Campanha | Alto | Muito alto | Média | Baixo | Médio | TSE + Company | Postgres | 2 |
| 9 | SIOP / TransfereGov (Emendas) | Alto | Alto | Alta | Baixo | Médio | Câmara/Senado | Postgres | 2 |
| 10 | Receita Federal CNPJ | Muito alto | Muito alto | Muito alta | Baixo | Muito alto | Company entity | Postgres | 2 |
| 11 | Portal da Transparência — Contratos | Alto | Alto | Média-alta | Baixo | Alto | Company + PublicAgency | Postgres | 2 |
| 12 | Câmara — Votações | Médio | Alto | Média | Baixo | Alto | Câmara Deputados + Vote entity | Postgres | 2 |
| 13 | Senado — Gastos (SAPS) | Médio | Alto | Média | Baixo | Médio | Senado | Postgres | 2 |
| 14 | PNCP — Contratos Novos | Médio | Alto | Baixa-média | Baixo | Médio | Company + PublicAgency | Postgres | 2 |
| 15 | CNPJ — Vínculos Societários | Muito alto | Muito alto | Muito alta | Baixo | Muito alto | CNPJ base + Person | Neo4j | 3 |
| 16 | Doações → Contratos (cruzamento) | Alto | Muito alto | Alta | Baixo | Médio | Doações + Contratos | Neo4j | 3 |
| 17 | Emendas → Beneficiário Municipal | Alto | Alto | Alta | Baixo | Médio | Emendas + Municipality | Neo4j | 3 |
| 18 | TCU — Sanções | Alto | Muito alto | Alta | Baixo | Baixo | — | Postgres | 4 |
| 19 | CNJ — DataJud (Processos) | Muito alto | Muito alto | Alta | Médio | Alto | LegalCase entity | Postgres | 4 |
| 20 | Portal da Transparência — Atualizações | Médio | Médio | Média | Baixo | Alto | Contratos | Job contínuo | 5 |
| 21 | CEIS/CNEP — Atualizações | Alto | Alto | Baixa | Baixo | Baixo | CEIS/CNEP base | Job contínuo | 5 |
| 22 | DataJud — Movimentações | Alto | Alto | Alta | Médio | Alto | DataJud base | Job contínuo | 5 |
| 23 | DOU — Nomeações | Alto | Alto | Muito alta | Baixo | Alto | PublicAgency + NLP | NLP | 6 |
| 24 | Querido Diário | Médio | Médio | Alta | Baixo | Alto | NLP | NLP | 6 |
| 25 | TCEs Estaduais | Médio | Alto | Muito alta | Baixo | Alto | Scraping infra | Scraping | 6 |
| 26 | TREs | Baixo | Baixo | Muito alta | Baixo | Médio | TSE base | Scraping | 7 |

---

## Grupo PRÉ — Bloco 0: Infraestrutura de Evidência

**Deve ser concluído antes de qualquer conector do Grupo 1.**

### PRÉ-1: Migrations da Camada de Evidência

**O que é:** 4 migrations que completam a infraestrutura documental do sistema.

**Por que primeiro:** Sem elas, todos os novos conectores produzem dados sem rastreabilidade completa. Retroativamente aplicar `ConfidenceLevel`, `EvidenceType` e `TransformationLog` a dados já existentes é muito mais custoso.

**Migrations:**
1. `AddSourceMetadata` — campos adicionais em `Source`
2. `AddEvidenceFields` — campos adicionais em `Evidence`
3. `AddContestationReferences` — campos adicionais em `Contestation`
4. `AddPersonEntity` — nova entidade `Person`

**Impacto nos conectores existentes:** Os pipelines existentes (TseCandidatesPipeline, etc.) precisam ser atualizados para popular os novos campos obrigatórios.

**Tempo estimado:** 1 sessão de implementação

---

## Grupo 1 — Batch ETL Independentes

**Podem ser implementados agora, sem dependências críticas.**
**Requerem apenas PostgreSQL.**
**Rodagem: batch periódica (não job contínuo).**

---

### G1-1: Câmara — Deputados Completo

**O que adiciona:** Todos os deputados federais com IDs da Câmara, histórico de mandatos, comissões.

**Valor investigativo:** Alto — base para CEAP, votações e emendas.

**Por que primeiro no Grupo 1:** API REST bem documentada, sem dependências, baixa complexidade. ETL direto.

**Pipeline:** `CamaraPoliticiansPipeline`
- Endpoint: `GET /api/v2/deputados` (paginado)
- Atualiza: `Politician.CamaraId`, valida se eleito por resultado eleitoral
- Nova entidade: `Mandate` (requer migration adicional)
- Frequência: trimestral ou a cada mudança de legislatura

**Dependências de código:** migration `AddMandateEntity`

---

### G1-2: Senado — Senadores Completo

**O que adiciona:** Todos os senadores com IDs do Senado, histórico de mandatos.

**Valor investigativo:** Alto — base para gastos e votações do Senado.

**Pipeline:** `SenadoPoliticiansPipeline`
- Endpoint: `GET /dadosabertos/senador/lista/atual` + histórico
- Atualiza: `Politician.SenateId`
- Frequência: trimestral

**Dependências de código:** nenhuma

---

### G1-3: CEIS e CNEP

**O que adiciona:** Flags de sanção administrativa para empresas e pessoas físicas.

**Valor investigativo:** Muito alto — um dos dados com maior impacto documental e menor custo técnico.

**Pipeline:** `CeisCnepPipeline`
- Endpoint: API Portal da Transparência (chave gratuita)
- Cria/atualiza: `Flag` com `FlagType = "CEIS"` ou `"CNEP"`
- Cruza: CNPJ com `Company`, CPF com `Politician`
- Frequência: mensal

**Dependências de código:** nenhuma para empresas; CPF de Politicians para pessoas físicas

**Observação:** Sanções podem ter status `ATIVO`, `SUSPENSO_POR_LIMINAR` ou `EXPIRADO`. O pipeline deve capturar o status e vigência, não apenas a existência da sanção.

---

### G1-4: Câmara — CEAP (Gastos Parlamentares)

**O que adiciona:** Todos os gastos reembolsados de deputados, com CNPJ dos fornecedores.

**Valor investigativo:** Alto — permite identificar empresas que prestam serviços a parlamentares.

**Pipeline:** `CamaraCeapPipeline`
- Endpoint: download mensal XML/CSV + API v2
- Cria: relação implícita `Politician ↔ Company` via CNPJ do fornecedor
- Popula: `Company` com CNPJs de fornecedores (enriquecimento posterior via Receita Federal)
- Frequência: mensal

**Dependências de código:** `Câmara Deputados Completo` (G1-1) + `Company` entity (já existe)

---

### G1-5: CGU PEP

**O que adiciona:** Lista de Pessoas Expostas Politicamente, com referência ao político relacionado.

**Valor investigativo:** Alto — identifica familiares e assessores próximos de políticos com exposição regulatória.

**Pipeline:** `CguPepPipeline`
- Endpoint: API Portal da Transparência
- Cria: `Person` (para PEPs que não são políticos) ou flag em `Politician`
- Frequência: mensal

**Dependências de código:** `Person` entity (migration do Bloco 0)

**Restrição LGPD:** Familiares de políticos exibidos apenas em contexto de vínculo com o político. Nota explicativa obrigatória: "PEP por relação familiar com agente político — não implica participação em atos públicos".

---

## Grupo 2 — Batch ETL com Dependências

**Requerem conectores do Grupo 1 como pré-requisito.**
**Ainda apenas PostgreSQL.**

---

### G2-1: Receita Federal CNPJ

**O que adiciona:** Dados completos de empresas brasileiras — razão social, situação, natureza jurídica, capital social, CNAEs, sócios.

**Valor investigativo:** Muito alto — fundação do grafo de vínculos societários.

**Dependências:** `Company` entity já existente + `Person` entity

**Pipeline:** `ReceitaCnpjPipeline`
- Fonte: dump mensal bulk (20+ GB comprimido)
- Processa em fases:
  1. Empresas com CNPJ já no sistema (priority fill)
  2. Empresas com CNPJ de fornecedores CEAP/Contratos
  3. Empresas onde candidatos TSE aparecem como sócios (via CPF parcial)
- **NÃO importar o dump completo** — filtrar por relevância (empresa com vínculo identificado)
- Frequência: mensal (apenas delta de CNPJs relevantes)

**Complexidade técnica:** Muito alta
- Formato de largura fixa (não CSV padrão)
- Volume muito grande — processamento em chunks
- CPF parcial dificulta matching exato com candidatos

**Advertência:** A identificação de sócio por CPF parcial é Grau 3 de certeza (relação indireta). O pipeline deve registrar explicitamente o método de matching e o grau de confiança.

---

### G2-2: TSE — Doações de Campanha (SPCE)

**O que adiciona:** Doadores (PF e PJ) para candidatos e partidos, por eleição.

**Valor investigativo:** Muito alto — permite documentar vínculos financeiros entre empresas/pessoas e políticos.

**Dependências:** TSE Candidatos (G0) + `Company` entity + `Person` entity + `CampaignDonation` entity (nova migration)

**Pipeline:** `TseDoacoesPipeline`
- Fonte: CSV bulk por eleição
- Cria: `CampaignDonation` com FK para `Politician` (recipient) e `Person` ou `Company` (donor)
- Cruza: CNPJ do doador com `Company` (para enriquecer se já importado via Receita)
- Frequência: por eleição (não contínua) + verificação de atualizações pós-eleição

**Advertência de exibição:** A proximidade temporal entre doação e contrato é documentável. A causalidade não pode ser afirmada. O frontend deve exibir ambos os fatos separadamente, sem texto que sugira nexo causal.

---

### G2-3: SIOP / TransfereGov — Emendas Parlamentares

**O que adiciona:** Emendas de deputados e senadores, valor, beneficiário, execução orçamentária.

**Valor investigativo:** Alto — permite visualizar o padrão de alocação de emendas por parlamentar.

**Dependências:** Câmara/Senado completos (G1-1, G1-2) + `Amendment` entity (já existe, mas requer campos adicionais)

**Pipeline:** `SiopEmendasPipeline`
- Fonte: download SIOP + API TransfereGov
- Atualiza: `Amendment` com campos faltantes (tipo, execução, classificação)
- Cruza: parlamentar autor via CPF/ID interno
- Frequência: mensal (execução orçamentária é atualizada mensalmente)

**Advertência:** Emenda individual de alto valor para município da base eleitoral é dado documentável. Não é, por si só, indicação de irregularidade.

---

### G2-4: Portal da Transparência — Contratos Federais

**O que adiciona:** Contratos federais com CNPJ contratado, valor, órgão, objeto.

**Valor investigativo:** Alto — base do cruzamento doação → contrato.

**Dependências:** `Company` entity + `PublicAgency` entity (nova migration) + chave de API do Portal da Transparência

**Pipeline:** `PortalTransparenciaContratosPipeline`
- Fonte: API REST (chave gratuita, rate limitada)
- Cria: `Contract` com FK para `Company` (via CNPJ) e `PublicAgency` normalizada
- Normalização de órgão: `PublicBody` (texto livre atual) → `PublicAgency` (entidade)
- Frequência: mensal

---

### G2-5: Câmara — Votações em Plenário

**O que adiciona:** Registro de votos de deputados em proposições.

**Valor investigativo:** Alto — ato público parlamentar por excelência.

**Dependências:** Câmara Deputados completo (G1-1) + `Vote` entity + `Proposal` entity (novas migrations)

**Pipeline:** `CamaraVotacoesPipeline`
- Fonte: API REST `/api/v2/votacoes` + `/api/v2/votacoes/{id}/votos`
- Cria: `Vote` (um por deputado por votação) + `Proposal` (proposição votada)
- Volume: alto — paginação por período recomendada
- Frequência: semanal

---

### G2-6: PNCP — Contratos (Lei 14.133/2021)

**O que adiciona:** Contratos sob a nova lei de licitações, complementar ao Portal da Transparência.

**Dependências:** `Company` entity + `PublicAgency` entity

**Pipeline:** `PncpContratosPipeline`
- Fonte: API PNCP
- Frequência: mensal
- Nota: sistema novo, histórico limitado. Importância crescente com a migração dos órgãos.

---

### G2-7: Senado — Gastos (SAPS)

**O que adiciona:** Gastos dos senadores com verba de gabinete, identificação de fornecedores.

**Dependências:** Senado completo (G1-2) + `Company` entity

**Pipeline:** `SenadoGastosPipeline`
- Fonte: download CSV Senado
- Similar ao CEAP — cria relação implícita `Senator ↔ Company` via CNPJ fornecedor
- Frequência: mensal

---

## Grupo 3 — Conectores de Grafo (Ativam Neo4j)

**Requerem Neo4j em produção e conectores do Grupo 2 populados.**
**São as relações N:M entre entidades — o valor central do grafo.**

---

### G3-1: Vínculos Societários (CNPJ → Person → Politician)

**O que adiciona:** Relações entre políticos e empresas via participação societária.

**Valor investigativo:** Muito alto — núcleo do grafo de relacionamentos.

**Por que precisa de Neo4j:** Relações N:M entre Person, Company e Politician com atributos temporais (data de entrada/saída, percentual) são ineficientes em Postgres puro. No Neo4j, são relações nativas com propriedades.

**Dependências:** Receita Federal CNPJ (G2-1) + `Person` entity + `CompanyPartnership` entity + Neo4j com schema de grafo

**Nó de atenção:** Matching entre CPF de sócio na Receita e candidato no TSE deve usar apenas CPF — nunca apenas nome. Sócio identificado apenas por nome não deve ser vinculado ao político sem confirmação por identificador.

---

### G3-2: Doações → Contratos (Cruzamento Temporal)

**O que adiciona:** Relação documentada entre doador de campanha e empresa com contrato com órgão público.

**Valor investigativo:** Muito alto — documentação de padrões temporais financeiros.

**Dependências:** Doações (G2-2) + Contratos (G2-4) + Neo4j

**Nota crítica de exibição:** Este cruzamento documenta coincidência temporal entre dois fatos públicos. O sistema **jamais** deve usar textos como "empresa que financiou e foi beneficiada". O texto correto é: "empresa X doou R$ Y para candidato Z em eleição AAAA; empresa X celebrou contrato de R$ W com órgão Q em data DD/MM/AAAA". O cidadão interpreta.

---

### G3-3: Emendas → Beneficiário → Município

**O que adiciona:** Mapeamento geográfico e temático de emendas parlamentares.

**Dependências:** Emendas (G2-3) + Municipality entity + Neo4j

---

## Grupo 4 — Parsing Pesado e Estruturação Complexa

**Requerem infraestrutura de processamento de texto ou APIs complexas.**

---

### G4-1: TCU — Sanções e Acórdãos

**O que adiciona:** Flags de sanção do TCU (inabilitação, multa, débito) para pessoas e empresas.

**Valor investigativo:** Muito alto — decisão de órgão de controle externo com força normativa.

**Abordagem recomendada:** Começar pela API de sancionados (estruturada) antes de parsing de acórdãos em PDF.

**Pipeline fase 1:** `TcuSancionadosPipeline`
- Fonte: API estruturada de sancionados TCU
- Cria: `Flag` com `FlagType = "TCU"` + referência ao número do acórdão

**Pipeline fase 2 (posterior):** parsing de PDF de acórdãos completos (requer NLP)

**Advertência de exibição:** Decisão do TCU é administrativa, não penal. O status de recurso deve ser verificado. "Contas julgadas irregulares" ≠ "condenação".

---

### G4-2: CNJ — DataJud (Processos Judiciais)

**O que adiciona:** Processos judiciais públicos onde o político é parte.

**Valor investigativo:** Muito alto — dado de maior sensibilidade e maior impacto.

**Dependências:** `LegalCase` entity (já existe) + policy de exibição aprovada + chave API CNJ

**Pipeline:** `DatajudProcessosPipeline`
- Fonte: Elasticsearch API DataJud (sintaxe específica)
- Query: processos onde CPF do político aparece como parte
- Cria: `LegalCase` com número CNJ, tribunal, classe, natureza, status
- Frequência: semanal (processos mudam com movimentações)

**Restrições de implementação:**
1. Identificação somente por CPF — nunca apenas por nome
2. Natureza do processo sempre exibida (criminal, cível, eleitoral, trabalhista, administrativo)
3. Status atual deve ser sincronizado regularmente
4. Nota explicativa obrigatória: "processo em andamento não tem resultado definitivo"
5. `HasFinalConviction = true` somente após trânsito em julgado confirmado

**Risco jurídico:** Médio — publicidade processual é princípio constitucional, mas exibição descontextualizada pode gerar contestação. Policy de exibição deve ser aprovada antes da implementação.

---

## Grupo 5 — Jobs Contínuos

**Requerem scheduler/job runner — não são ETL batch único.**
**Dependem de conectores do Grupo 1-4 já populados.**

---

### G5-1: Atualização CEIS/CNEP

**Frequência:** mensal
**O que faz:** Verifica sanções novas, atualizações de vigência, suspensões por liminar
**Infraestrutura:** job mensal agendado + diff com estado anterior

---

### G5-2: Atualização Portal da Transparência — Contratos

**Frequência:** mensal
**O que faz:** Novos contratos, aditivos, rescisões
**Infraestrutura:** job mensal + detecção de novos registros por data de publicação

---

### G5-3: Atualizações DataJud — Movimentações

**Frequência:** semanal
**O que faz:** Novas movimentações em processos já catalogados, mudanças de status
**Infraestrutura:** job semanal por conjunto de números de processos conhecidos

**Nota:** Não é busca de novos processos — é atualização dos já catalogados. Busca de novos processos é G4-2.

---

## Grupo 6 — Parsing de Linguagem Natural e Scraping

**Requerem infraestrutura adicional (NLP, headless browser, normalização pesada).**
**Menor confiabilidade histórica. Alta complexidade. Para fases posteriores.**

---

### G6-1: DOU — Nomeações e Exonerações

**O que adiciona:** Nomeações para cargos públicos, exonerações, portarias relevantes.

**Valor investigativo:** Alto — identifica quando político ocupa ou indica ocupação de cargo público.

**Complexidade:** Muito alta — texto livre, requer NLP para identificação de entidades.

**Abordagem recomendada:** Começar com NER (Named Entity Recognition) treinado em atos de nomeação específicos, não em todo o DOU.

**Dependência:** infraestrutura de NLP, `PublicAgency` entity normalizada

---

### G6-2: TCEs Estaduais (Fase inicial: SP e MG)

**O que adiciona:** Sanções e irregularidades em contas municipais e estaduais.

**Abordagem recomendada:** TCE-SP e TCE-MG têm melhores dados estruturados — começar por eles.

**Nota:** Altíssima variabilidade entre TCEs. Risco de quebra elevado. Cada TCE é essencialmente um conector diferente.

---

## Grupo 7 — Baixa Prioridade

### G7-1: TREs Estaduais

**Justificativa de baixa prioridade:** A esmagadora maioria dos dados relevantes dos TREs já está consolidada no TSE. O custo de manter 27 conectores diferentes para ganho marginal de dados não justifica o investimento.

**Exceção:** Se um TRE específico tiver dado relevante não disponível no TSE, avaliar caso a caso.

---

## Dependências de Infraestrutura

### Para iniciar (Grupos PRÉ e 1)
- PostgreSQL (já em produção)
- Python ETL com `BasePipeline` (já scaffoldado)
- Chave API gratuita: Portal da Transparência (cadastro simples)
- Chave API: CNJ DataJud (para Grupo 4, mas obter cedo)

### Para Grupo 3 (Grafo)
- Neo4j em produção no Railway (atualmente apenas no docker-compose local)
- Schema de grafo Neo4j documentado (já em `infra/neo4j/`)
- Driver Neo4j no ETL Python (biblioteca `neo4j`)

### Para Grupo 4
- CNJ DataJud: familiaridade com Elasticsearch API
- TCU: acesso à API estruturada de sancionados

### Para Grupo 5
- Scheduler de jobs (Railway tem suporte a Cron Jobs)
- Lógica de diff para detectar mudanças sem reimportar tudo

### Para Grupo 6
- Biblioteca de NLP (spaCy com modelo pt-BR, ou similar)
- Infraestrutura de OCR se necessário (para PDFs)
- Scraping: Playwright/Selenium para portais sem API

---

## Cronograma Indicativo de Grupos

| Grupo | Quando | Pré-requisitos | Observação |
|---|---|---|---|
| **PRÉ** | Imediatamente | — | Blocking para tudo |
| **1** | Após PRÉ | Migrations completas | Qualquer ordem dentro do grupo |
| **2** | Após Grupo 1 | Entidades base populadas | Priorizar CNPJ e Doações |
| **3** | Após Grupo 2 + Neo4j live | Neo4j em produção no Railway | Requer planejamento de infra |
| **4** | Paralelo com Grupo 3 | Infraestrutura de parsing | TCU antes de DataJud |
| **5** | Após Grupos 1-4 respectivos | Dados iniciais para diff | Scheduler no Railway |
| **6** | Fase posterior | NLP + scraping infra | Avaliar ROI antes de iniciar |
| **7** | Fase muito posterior | Todos anteriores | Baixa prioridade indefinida |

---

## Critérios de Conclusão de um Conector

Um conector está **concluído** quando:

1. Pipeline ETL implementado e testado
2. Dados carregados no staging com sample verificado
3. `Source` registrada com todos os campos obrigatórios (incluindo os do Bloco 0)
4. `Evidence` criada com `ConfidenceLevel`, `EvidenceType`, `TransformationLog`
5. Grau de certeza atribuído e documentado para cada tipo de relação criada
6. ADR criado documentando decisões arquiteturais do conector
7. `matriz-de-fontes.md` atualizado com `Status = ativo`
8. Nota metodológica no frontend definida (o que o dado comprova e o que não comprova)

Um conector que popula dados sem rastreabilidade completa **não está concluído**.
