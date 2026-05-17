# Ontologia REPBrasil

> Modelagem conceitual oficial do sistema.
> **Versão:** 1.0 | **Data:** 2026-05-17 | **Status:** Vigente
>
> Este documento define entidades, propriedades, relações, cardinalidade e graus de confiança.
> É derivado do domínio implementado e expande-o de forma conservadora e incremental.

---

## Princípio Arquitetural Central: Person ≠ Politician

**Este é o princípio mais importante desta ontologia.**

O REPBrasil distingue explicitamente entre:

### `Person` — Pessoa física genérica
Uma pessoa física que aparece em registros documentais relevantes ao sistema, mas que não é necessariamente um agente político.

Exemplos de `Person` no sistema:
- Sócio de empresa que tem contrato público
- Cônjuge de político listado como co-titular de bem declarado
- Doador de campanha (pessoa física)
- Familiar de político identificado como PEP (CGU)
- Administrador de empresa contratada pelo governo
- Representante legal de entidade

### `Politician` — Agente político
Uma `Person` que tem ou teve mandato eletivo, candidatura registrada no TSE, ou cargo de direção em partido político.

**`Politician` é uma especialização de `Person`, não uma entidade separada e incompatível.**

```
Person (entidade base)
  └─ Politician (especialização com atributos eleitorais)
```

### Por que isso importa

Sem essa distinção:
- Não é possível modelar relações entre políticos e pessoas do seu entorno sem torná-las políticos também
- Vínculos documentais com familiares, sócios e assessores desaparecem do grafo
- O sistema perde capacidade de rastrear conexões não-eleitorais relevantes
- Doadores de campanha, sócios de empresas contratadas e familiares ficam invisíveis

Com essa distinção:
- `Person João` pode ser sócio de `Company X` e cônjuge de `Politician Maria` — sem implicar que João é político
- Relações documentais entre pessoas e políticos ficam explícitas e auditáveis
- O grafo de relacionamentos tem substância real

### Regra de não-implicação

Ser `Person` relacionada a um `Politician` **não implica** nenhuma forma de responsabilidade, cumplicidade ou intenção compartilhada. A relação é puramente documental.

---

## Entidades do Núcleo Implementado

> Marcação: `[IMPLEMENTADO]` = entidade com migration e dados no sistema atual.

### `AuditableEntity` — Base de todas as entidades

```
Id:         Guid (PK, gerado pelo sistema)
CreatedAt:  DateTime (UTC, imutável)
UpdatedAt:  DateTime (UTC, atualizado automaticamente)
DeletedAt:  DateTime? (soft delete — registro nunca é removido fisicamente)
```

Todas as entidades herdam `AuditableEntity`. O soft delete garante que nenhum registro é destruído — apenas marcado como inativo.

---

### `Politician` `[IMPLEMENTADO]`

Agente político com candidatura registrada ou mandato eletivo.

```
Id:               Guid (PK)
Name:             string (nome completo conforme TSE)
BallotName:       string (nome de urna)
TseId:            string? (número sequencial TSE — identificador primário eleitoral)
CamaraId:         string? (ID interno da API da Câmara dos Deputados)
SenateId:         string? (ID interno da API do Senado Federal)
State:            string? (UF do mandato/candidatura)
PartyAcronym:     string? (sigla do partido na candidatura)
PartyName:        string? (nome completo do partido)
Office:           string? (cargo: DEPUTADO FEDERAL, SENADOR, VEREADOR, etc.)
CandidacyStatus:  string? (situação: DEFERIDO, INDEFERIDO, CASSADO)
```

**Lacunas identificadas para expansão:**
- `CpfPartial`: string? — dígitos visíveis do CPF (para cruzamento com CNPJ)
- `DateOfBirth`: DateOnly? — data de nascimento (para desambiguação de homônimos)
- `Gender`: string? — gênero declarado
- `EducationLevel`: string? — grau de instrução autodeclarado (TSE)
- `Occupation`: string? — ocupação declarada

---

### `Party` `[IMPLEMENTADO]`

Partido político registrado no TSE.

```
Id:         Guid
Name:       string (nome completo)
Acronym:    string (sigla oficial TSE)
Number:     int (número eleitoral)
```

**Lacunas:**
- `TsePartyId`: string? — identificador interno TSE
- `FoundedAt`: DateOnly? — data de fundação
- `Status`: string? — situação (ativo, em fusão, extinto)
- `IdeologicalSpectrum`: — **não implementar** (inferência subjetiva)

---

### `Election` `[IMPLEMENTADO]`

Evento eleitoral (eleição municipal 2024, eleição geral 2022, etc.).

```
Id:       Guid
Year:     int
Round:    int
Type:     string (municipal, geral, suplementar)
```

**Lacunas:**
- `TseElectionCode`: string? — código interno TSE do pleito
- `Date`: DateOnly? — data da eleição

---

### `ElectionResult` `[IMPLEMENTADO]`

Resultado de um candidato em uma eleição.

```
Id:           Guid
PoliticianId: Guid (FK → Politician)
ElectionId:   Guid (FK → Election)
PartyId:      Guid? (FK → Party)
Round:        int (1 ou 2)
TotalVotes:   long
Percentage:   decimal?
Situation:    string? (ELEITO, NÃO ELEITO, SUPLENTE, ELEITO POR QP, etc.)
Elected:      bool
```

Índice único: `(PoliticianId, ElectionId, Round)` — um resultado por candidato por eleição por turno.

---

### `AssetDeclaration` `[IMPLEMENTADO]`

Declaração de bens de um candidato em uma eleição.

```
Id:                 Guid
PoliticianId:       Guid (FK → Politician)
ElectionYear:       int
SourceElectionYear: string? (ano de referência conforme TSE)
TotalValue:         decimal
TseSequential:      string? (número sequencial TSE da candidatura)
Items:              ICollection<AssetItem>
```

Índice único: `(PoliticianId, ElectionYear)` — uma declaração por candidato por eleição.

---

### `AssetItem` `[IMPLEMENTADO]`

Item individual de um bem declarado.

```
Id:             Guid
DeclarationId:  Guid (FK → AssetDeclaration)
Order:          int (ordem na declaração original)
AssetType:      string (tipo de bem conforme TSE)
Description:    string (texto livre autodeclarado)
Value:          decimal
```

---

### `Company` `[IMPLEMENTADO]`

Pessoa jurídica identificada por CNPJ.

```
Id:           Guid
Name:         string (razão social)
Cnpj:         string (14 dígitos, sem formatação)
LegalNature:  string? (natureza jurídica)
Status:       string? (situação cadastral: ATIVA, BAIXADA, INAPTA)
OpenedAt:     DateTime? (data de abertura)
```

**Lacunas para expansão:**
- `TradeName`: string? — nome fantasia
- `MainActivity`: string? — CNAE principal
- `CapitalStock`: decimal? — capital social
- `Size`: string? — porte (MEI, ME, EPP, DEMAIS)
- `ClosedAt`: DateTime? — data de encerramento

---

### `Contract` `[IMPLEMENTADO]`

Contrato público celebrado por empresa com órgão público.

```
Id:             Guid
CompanyId:      Guid (FK → Company)
ContractNumber: string
Value:          decimal
SignedAt:       DateTime
PublicBody:     string? (órgão contratante — texto livre, a normalizar)
```

**Lacunas para expansão:**
- `PublicAgencyId`: Guid? — FK para entidade `PublicAgency` (planejada)
- `Object`: string? — objeto do contrato
- `Modality`: string? — modalidade de licitação
- `SourceContractId`: string? — ID na fonte original (Portal da Transparência, PNCP)
- `ValidFrom`: DateTime? — início de vigência
- `ValidUntil`: DateTime? — fim de vigência

---

### `Amendment` `[IMPLEMENTADO]`

Emenda parlamentar ao Orçamento Geral da União.

```
Id:           Guid
PoliticianId: Guid (FK → Politician)
Value:        decimal
Destination:  string? (beneficiário — texto livre)
Year:         int
SiopCode:     string? (código SIOP)
```

**Lacunas para expansão:**
- `AmendmentType`: string? — tipo (individual, bancada, comissão)
- `ExecutionStatus`: string? — situação de execução (empenhado, liquidado, pago)
- `MunicipalityId`: Guid? — FK para destino municipal (quando aplicável)
- `Program`: string? — classificação orçamentária

---

### `Municipality` `[IMPLEMENTADO]`

Município brasileiro.

```
Id:       Guid
Name:     string
State:    string (UF)
IbgeCode: string? (código IBGE 7 dígitos)
```

---

### `LegalCase` `[IMPLEMENTADO]`

Processo judicial de conhecimento público.

```
Id:                 Guid
PoliticianId:       Guid (FK → Politician)
CaseNumber:         string (número CNJ)
Court:              string (tribunal)
Subject:            string? (assunto — texto livre)
Status:             string (status processual)
HasFinalConviction: bool
```

**Lacunas para expansão:**
- `ProcessClass`: string? — classe processual CNJ (ação penal, ação civil pública, etc.)
- `ProcessNature`: string? — natureza (criminal, cível, eleitoral, trabalhista)
- `LatestMovement`: DateTime? — última movimentação
- `Parties`: — lista de partes (planejado)

---

### `ScoreSnapshot` `[IMPLEMENTADO]`

Snapshot imutável do score de um político em um momento. Cada cálculo gera um novo registro.

```
Id:                   Guid (init)
PoliticianId:         Guid (init)
Score:                decimal (init) [RESERVADO — não expor como nota ativa]
MethodologyVersion:   string (init)
CalculatedAt:         DateTime (init)
Notes:                string? (init)
Factors:              List<ScoreFactor>
```

Score é imutável por design: não é atualizado, é substituído por novo snapshot.

---

### `ScoreFactor` `[IMPLEMENTADO]`

Fator individual que compõe um ScoreSnapshot. Rastreável até a evidência.

```
Id:                 Guid (init)
ScoreSnapshotId:    Guid (init, FK → ScoreSnapshot)
FactorKey:          string (chave técnica do fator)
FactorCategory:     string (categoria: eleitoral, patrimonial, judicial, etc.)
FactorLabel:        string (rótulo legível ao usuário)
FactorValue:        decimal? (valor numérico do fator)
FactorWeight:       decimal? (peso no cálculo total)
EvidenceId:         Guid? (FK → Evidence — quando vinculado)
SourceId:           Guid? (FK → Source — fonte do dado)
EvidenceReference:  string? (referência textual enquanto FK não está disponível)
SourceReference:    string? (referência textual enquanto FK não está disponível)
Explanation:        string? (explicação legível do fator)
```

---

### `Flag` `[IMPLEMENTADO]`

Marcador documental de uma condição relevante para um político.

```
Id:           Guid
PoliticianId: Guid (FK → Politician)
FlagType:     string (tipo: CEIS, CNEP, TCU, INELEGIVEL, etc.)
Description:  string
IsActive:     bool
ValidFrom:    DateTime?
ValidUntil:   DateTime?
```

---

### `Source` `[IMPLEMENTADO]`

Fonte de dados que originou informações no sistema.

```
Id:             Guid
Name:           string (nome da fonte)
Organization:   string (órgão responsável)
SourceType:     string (tipo: API, CSV, PDF, etc.)
OriginalUrl:    string (URL de origem)
CollectedAt:    DateTime (timestamp de coleta)
Hash:           string? (SHA-256 do arquivo coletado)
FileSizeBytes:  long? (tamanho do arquivo)
License:        string? (licença de uso)
```

**Lacunas para expansão** (ver [`camada-de-evidencia.md`](camada-de-evidencia.md)):
- `CollectionMethod`: string? — método de coleta (API, bulk download, scraping)
- `DatasetVersion`: string? — versão do dataset conforme publicado pela fonte
- `ConfidenceLevel`: int — nível de confiança da fonte (1-5)
- `SchemaVersion`: string? — versão do schema do arquivo coletado

---

### `Evidence` `[IMPLEMENTADO]`

Registro documental que suporta um fato ou relação no sistema.

```
Id:          Guid
SourceId:    Guid (FK → Source)
Description: string
RawValue:    string? (valor bruto conforme fonte)
DocumentUrl: string? (URL do documento específico)
```

**Lacunas significativas** (ver [`camada-de-evidencia.md`](camada-de-evidencia.md)):
- `EvidenceType`: string — tipo (PRIMÁRIA, DERIVADA, DOCUMENTAL)
- `ConfidenceLevel`: int — nível 1-5
- `CollectionMethod`: string — como foi coletado
- `DatasetVersion`: string? — versão do dataset de origem
- `Hash`: string? — hash do trecho de evidência
- `TransformationLog`: string? — log das transformações aplicadas
- `ContestationStatus`: string — ATIVO, CONTESTADO, CORRIGIDO

---

### `Contestation` `[IMPLEMENTADO]`

Contestação formal de um dado pelo público ou pelo próprio político.

```
Id:           Guid
Description:  string
Status:       string (ABERTA, EM_ANÁLISE, ACEITA, REJEITADA)
Resolution:   string?
```

**Lacunas para expansão:**
- `EntityType`: string — tipo da entidade contestada (Politician, LegalCase, etc.)
- `EntityId`: Guid — ID da entidade contestada
- `EvidenceId`: Guid? — evidência contestada
- `SubmittedAt`: DateTime
- `ResolvedAt`: DateTime?
- `ResolutionEvidence`: string? — evidência da resolução

---

## Entidades Planejadas

> Marcação: `[PLANEJADA]` = não implementada, requer conector + migration.
> `[EXPERIMENTAL]` = em avaliação metodológica.
> `[DEPENDENTE]` = requer outra entidade ou conector como prerequisito.

---

### `Person` `[PLANEJADA]`

Pessoa física não-política que aparece em registros documentais.

```
Id:            Guid
Name:          string (nome conforme fonte)
CpfPartial:    string? (dígitos visíveis do CPF — não armazenar CPF completo)
DateOfBirth:   DateOnly?
SourceId:      Guid (FK → Source — de onde veio essa pessoa)
```

**Relação com Politician:**
```
Person
  └─ se tem candidatura TSE: é também Politician (relação is-a conceitual)
  └─ se aparece apenas como sócio/doador/familiar: permanece como Person
```

**Restrição LGPD:** `Person` que não é figura pública deve ter exibição limitada. O sistema exibe `Person` apenas quando documentalmente vinculada a um `Politician` e quando o vínculo é relevante para transparência pública.

**Prioridade:** `P1` — necessária para grafo completo
**Dependências:** Receita Federal CNPJ, TSE Doações, CGU PEP

---

### `Mandate` `[PLANEJADA]`

Mandato eletivo exercido por um político (distinto de candidatura).

```
Id:           Guid
PoliticianId: Guid (FK → Politician)
Office:       string (cargo exercido)
StartDate:    DateOnly
EndDate:      DateOnly?
IsActive:     bool
State:        string
Municipality: string? (para cargos municipais)
SourceId:     Guid (FK → Source)
```

**Por que separado de Politician:**
- Politician pode ter múltiplos mandatos (deputado 2018, senador 2022)
- Candidatura ≠ mandato (pode ser eleito mas não tomar posse)
- Licença do mandato, cassação e renúncia devem ser modeladas no mandato, não no político

**Prioridade:** `P1`
**Dependências:** Câmara API + Senado API

---

### `PublicAgency` `[PLANEJADA]`

Órgão público contratante ou sancionador.

```
Id:       Guid
Name:     string
Acronym:  string?
Type:     string (federal, estadual, municipal, autarquia, fundação)
CNPJ:     string? (CNPJ do órgão quando disponível)
```

**Por que necessária:**
- Atualmente `Contract.PublicBody` é texto livre — impossível agregar contratos por órgão
- Cruzamento órgão → emenda → contrato → político requer entidade normalizada

**Prioridade:** `P1`
**Dependências:** normalização de `Contract.PublicBody` existente

---

### `Vote` `[PLANEJADA]`

Voto de um parlamentar em uma proposição legislativa.

```
Id:           Guid
PoliticianId: Guid (FK → Politician)
ProposalId:   Guid (FK → Proposal — entidade planejada)
VoteDate:     DateTime
VoteValue:    string (SIM, NÃO, ABSTENÇÃO, OBSTRUÇÃO, ART17, AUSENTE)
Session:      string?
SourceId:     Guid (FK → Source)
```

**Restrição:** Vote é registro de ato público — não implica posição ideológica. Exibição deve ser puramente factual.

**Prioridade:** `P1`
**Dependências:** Câmara API + Senado API

---

### `Proposal` `[PLANEJADA]`

Proposição legislativa (PL, PEC, MP, etc.).

```
Id:           Guid
ExternalId:   string (ID na API da Câmara ou Senado)
Type:         string (PL, PEC, MP, PDL, etc.)
Title:        string
Description:  string?
Year:         int
House:        string (CÂMARA, SENADO)
SourceId:     Guid (FK → Source)
```

**Prioridade:** `P1` (dependente de Vote)

---

### `CampaignDonation` `[PLANEJADA]`

Doação de campanha eleitoral.

```
Id:            Guid
ElectionId:    Guid (FK → Election)
RecipientId:   Guid (FK → Politician ou Party)
DonorPersonId: Guid? (FK → Person — doador pessoa física)
DonorCompanyId: Guid? (FK → Company — doador pessoa jurídica)
Amount:        decimal
DonationDate:  DateTime?
ResourceType:  string (tipo de recurso)
SourceId:      Guid (FK → Source)
```

**Restrição:** doação documentada não implica favorecimento futuro. Exibição deve ser factual.

**Prioridade:** `P1`
**Dependências:** TSE SPCE + Person (para doadores PF) + Company (para doadores PJ)

---

### `CompanyPartnership` `[PLANEJADA]` `[DEPENDENTE: Receita Federal]`

Vínculo societário entre pessoa e empresa.

```
Id:            Guid
CompanyId:     Guid (FK → Company)
PersonId:      Guid? (FK → Person — sócio PF)
PartnerCompanyId: Guid? (FK → Company — sócio PJ)
Role:          string (SÓCIO, ADMINISTRADOR, REPRESENTANTE LEGAL)
EntryDate:     DateOnly?
ExitDate:      DateOnly?
SharePercentage: decimal?
SourceId:      Guid (FK → Source)
```

**Restrição:** ser sócio não implica gestão ativa. Saída da sociedade deve ser sempre exibida com data quando disponível.

**Prioridade:** `P1`
**Dependências:** Receita Federal CNPJ + Person

---

### `Relationship` `[EXPERIMENTAL]`

Relação documentada entre duas entidades quaisquer do sistema.

```
Id:              Guid
FromEntityType:  string
FromEntityId:    Guid
ToEntityType:    string
ToEntityId:      Guid
RelationType:    string (enum de tipos — ver taxonomia abaixo)
ConfidenceGrade: int (1-6 — ver graus de certeza)
EvidenceId:      Guid? (FK → Evidence)
SourceId:        Guid? (FK → Source)
ValidFrom:       DateTime?
ValidUntil:      DateTime?
Notes:           string?
```

**Status experimental:** esta entidade genérica é poderosa mas arriscada. Só deve ser ativada após as relações específicas (CompanyPartnership, CampaignDonation, Vote) estarem maduras. Risco de uso incorreto para criar relações implícitas ou especulativas.

**Prioridade:** `P2` — dependente de Neo4j em produção

---

## Taxonomia de Relações

### Relações entre `Politician` e outras entidades

| Relação | De | Para | Cardinalidade | Grau típico | Evidência necessária |
|---|---|---|---|---|---|
| `TEM_CANDIDATURA` | Politician | Election | N:M (via ElectionResult) | 1 — fato confirmado | TSE número sequencial |
| `PERTENCE_A_PARTIDO` | Politician | Party | N:M temporal | 1-2 | TSE filiações |
| `DECLAROU_BENS` | Politician | AssetDeclaration | 1:N | 1 — fato confirmado | TSE bens |
| `EXERCEU_MANDATO` | Politician | Mandate | 1:N | 1-2 | Câmara/Senado API |
| `APRESENTOU_EMENDA` | Politician | Amendment | 1:N | 1 — fato confirmado | SIOP/TransfereGov |
| `VOTOU_EM` | Politician | Vote | 1:N | 1 — fato confirmado | Câmara/Senado API |
| `TEM_PROCESSO` | Politician | LegalCase | 1:N | 1-2 | DataJud CNJ |
| `TEM_FLAG` | Politician | Flag | 1:N | 1-2 | CEIS/CNEP/TCU |

### Relações entre `Person` e outras entidades

| Relação | De | Para | Cardinalidade | Grau típico | Evidência necessária |
|---|---|---|---|---|---|
| `É_SÓCIO_DE` | Person | Company | N:M temporal | 1-2 | CNPJ Receita |
| `DOOU_PARA` | Person | Politician | N:M | 1 — fato confirmado | TSE SPCE |
| `É_PEP_RELACIONADO_A` | Person | Politician | N:M | 2 | CGU PEP |

### Relações entre `Company` e outras entidades

| Relação | De | Para | Cardinalidade | Grau típico | Evidência necessária |
|---|---|---|---|---|---|
| `CELEBROU_CONTRATO` | Company | PublicAgency | N:M | 1 — fato confirmado | Portal Transparência / PNCP |
| `DOOU_PARA` | Company | Politician | N:M | 1 — fato confirmado | TSE SPCE |
| `TEM_SANÇÃO` | Company | Flag | 1:N | 1 — fato confirmado | CEIS/CNEP |
| `TEM_SÓCIO` | Company | Person | N:M temporal | 1-2 | CNPJ Receita |

---

## Graus de Certeza do Sistema

**Este é o mecanismo central de conservadorismo metodológico do REPBrasil.**

O sistema atribui um grau de certeza a cada informação ou relação. Nenhuma informação desce abaixo do Grau 3 sem ser marcada como não-exposta ao usuário final.

### Tabela de Graus

| Grau | Nome | Definição | Exibição no Frontend | Cor sugerida |
|---|---|---|---|---|
| **1** | Fato confirmado | Dado estruturado diretamente de fonte oficial primária, sem transformação de sentido, sem ambiguidade. Identificador compartilhado forte. | Público, sem ressalvas | Verde |
| **2** | Vínculo documental | Dado em fonte oficial sujeito a atualização, recurso pendente, ou identificação por campo secundário (nome, não CPF). | Público com indicador de data de referência | Azul |
| **3** | Relação indireta | Inferível por cruzamento documentado de 2 ou mais fontes com identificador compartilhado. Requer normalização. | Público com nota metodológica explícita | Amarelo |
| **4** | Hipótese não confirmada | Padrão detectável nos dados mas sem evidência documental primária suficiente para afirmar. | **Não exposto ao usuário** | — |
| **5** | Ausência de evidência | Nenhum registro encontrado na fonte consultada. **≠ inexistência real.** | Interno apenas (pode gerar "sem registros") | — |
| **6** | Conflito de evidência | Duas ou mais fontes oficiais divergem sobre o mesmo fato. Schema mudou. Dataset apresenta inconsistência interna. | **Público — conflito exibido de forma transparente** | Laranja/Vermelho |

### Grau 6 — Conflito de Evidência: Detalhe

O Grau 6 é tratamento especial: **conflitos não são ocultados, são exibidos**.

Quando um conflito é detectado:
1. Ambas as versões conflitantes são armazenadas com suas fontes
2. O registro recebe `ConfidenceGrade = 6`
3. No frontend: ambas as versões são exibidas com suas fontes, com nota "fontes divergem"
4. Um log de auditoria registra quando o conflito foi detectado e por qual pipeline

Exemplos de conflitos esperados:
- TSE registra politician como eleito, mas Câmara não tem registro de posse
- Bem declarado em 2022 de X reais, mas declaração de 2024 omite o bem (remoção vs. venda)
- CNPJ ativo na Receita Federal, mas CEIS registra empresa como inidônea com data futura inconsistente
- DataJud registra processo encerrado, mas tribunal regional ainda registra como ativo

### Regras de aplicação

1. **Todo dado começa em Grau 2** — somente sobe para Grau 1 quando o identificador primário é confirmavelmente único e a fonte é API oficial sem transformação
2. **Cruzamento sempre desce pelo menos um grau** — dado que passou por normalização de nome vai de Grau 1 para Grau 2 ou 3
3. **Relações entre fontes diferentes nunca sobem acima de Grau 3** sem identificador primário compartilhado
4. **Grau 4 não é exibido** — serve para análise interna e desenvolvimento de novos conectores
5. **Grau 5 não é ausência de dado** — é resultado de busca sem retorno (diferente de "dado não coletado")
6. **Grau 6 é sempre exibido** — transparência sobre conflito é mais honesta que silêncio

---

## Lacunas Identificadas no Modelo Atual

### Lacunas de entidade (entidades faltando)
- `Person` — separação de Politician não implementada
- `Mandate` — mandato distinto de candidatura
- `PublicAgency` — normalização de órgãos contratantes
- `Vote` — votos parlamentares
- `Proposal` — proposições legislativas
- `CampaignDonation` — doações de campanha
- `CompanyPartnership` — vínculos societários

### Lacunas de propriedade (campos faltando em entidades existentes)
- `Politician`: CPF parcial, data de nascimento, gênero, escolaridade, ocupação
- `Company`: nome fantasia, CNAE, capital social, porte, data de encerramento
- `Contract`: objeto, modalidade, vigência, ID na fonte original
- `Amendment`: tipo de emenda, situação de execução, classificação orçamentária
- `LegalCase`: classe processual, natureza (criminal/cível), partes
- `Source`: método de coleta, versão do schema, nível de confiança
- `Evidence`: tipo, nível de confiança, método de coleta, log de transformações

### Lacunas de relação (relações não modeladas)
- `Person ↔ Company` via sociedade
- `Person ↔ Politician` via doação
- `Company ↔ PublicAgency` via contrato normalizado
- `Politician ↔ Mandate` (mandato exercido vs. candidatura)
- `Politician ↔ Vote` (votações nominais)
- Vínculos familiares: **não implementar** sem identificação documental positiva

### Dependências de infraestrutura
- Todas as relações N:M no grafo dependem de Neo4j em produção (Fase 4 do roadmap original)
- Entidades `Person`, `CompanyPartnership`, `CampaignDonation` dependem de conectores específicos
- Grau de certeza requer campo adicional em Evidence e Source (migration necessária)
