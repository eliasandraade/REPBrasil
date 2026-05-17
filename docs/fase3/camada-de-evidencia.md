# Camada de Evidência — REPBrasil

> Infraestrutura conceitual de evidências, rastreabilidade e auditabilidade.
> **Versão:** 1.0 | **Data:** 2026-05-17 | **Status:** Vigente
>
> Este documento define como toda informação no REPBrasil deve ser rastreada,
> armazenada, apresentada e contestada — desde o dado original até o usuário final.

---

## Princípio Fundador

> **O REPBrasil deve parecer uma infraestrutura documental auditável — não um site que "afirma coisas".**

Toda informação exibida ao cidadão deve poder responder:
1. De onde veio?
2. Quando foi coletado?
3. Como foi processado?
4. Quem é responsável pela fonte?
5. Qual é o grau de confiança?
6. Houve contestação?
7. Está atualizado?

Se uma informação não consegue responder todas essas perguntas, ela não deve ser exibida.

---

## Arquitetura Conceitual

### Visão geral do fluxo

```
FONTE OFICIAL
    │
    ▼
COLETA (ETL Pipeline)
    │  ← timestamp, URL, autenticação, método
    ▼
ARQUIVO BRUTO
    │  ← hash SHA-256 calculado imediatamente
    ▼
PARSING & EXTRAÇÃO
    │  ← schema version registrado, erros logados
    ▼
NORMALIZAÇÃO
    │  ← regras de normalização versionadas, log de transformações
    ▼
VINCULAÇÃO (matching entre entidades)
    │  ← identificador usado, grau de certeza atribuído
    ▼
PERSISTÊNCIA (PostgreSQL)
    │  ← registro imutável criado com SourceId + EvidenceId
    ▼
DERIVAÇÃO (score, flags, agregações)
    │  ← referência às evidências de origem, chain auditável
    ▼
APRESENTAÇÃO (frontend)
    │  ← grau de certeza exibido, fonte citada, timestamp visível
    ▼
CONTESTAÇÃO (quando aplicável)
    │  ← processo formal, evidência de correção, histórico preservado
    ▼
CORREÇÃO (se aceita)
        ← dado original não apagado, novo registro com referência ao anterior
```

### Invariantes do sistema

1. **Nenhum dado sem fonte.** Todo registro em qualquer entidade tem `SourceId`.
2. **Nenhuma transformação invisível.** Toda operação de parsing e normalização é logada.
3. **Nenhuma deleção física.** Soft delete universal — `DeletedAt` marca inatividade, nunca apaga.
4. **Nenhum histórico apagado.** Correções geram novo registro, não substituem o anterior.
5. **Nenhuma relação sem grau de certeza.** Todo vínculo carrega `ConfidenceGrade` (1-6).

---

## Chain of Transformation

**Este é o mecanismo central de auditabilidade do REPBrasil.**

Toda derivação futura — score, flag, relação no grafo, agregação estatística — deve ser rastreável até o dado original. Chamamos isso de **Chain of Transformation**.

### Definição

A Chain of Transformation é a trilha auditável de cada transformação aplicada a um dado desde sua coleta até sua apresentação ao usuário.

```
dado_original
  → [ETL: extração]         ← método, parser version, timestamp
  → [ETL: normalização]     ← regras aplicadas, versão das regras
  → [matching: vinculação]  ← identificador usado, grau de certeza
  → [derivação: score]      ← fórmula, versão da metodologia, inputs
  → [derivação: flag]       ← regra disparada, threshold, evidência
  → apresentação_ao_usuário ← contexto exibido, fonte citada
```

### Por que isso importa

Sem Chain of Transformation:
- Não é possível auditar por que um score mudou
- Não é possível reproduzir um cálculo com os mesmos dados
- Não é possível contestar um resultado com evidência específica
- Não é possível detectar quando uma mudança de schema na fonte corrompeu dados

Com Chain of Transformation:
- Qualquer pessoa com acesso ao repositório pode reproduzir qualquer cálculo
- Uma contestação pode apontar exatamente qual transformação produziu o resultado incorreto
- Mudanças de schema são detectáveis porque o `SchemaVersion` registrado diverge do esperado
- Um dado incorreto pode ser corrigido em sua etapa específica sem invalidar toda a cadeia

### Implementação conceitual da Chain

Cada `Evidence` deve carregar um `TransformationLog` estruturado:

```json
{
  "steps": [
    {
      "step": "extraction",
      "timestamp": "2026-05-17T14:30:00Z",
      "pipeline": "TseCandidatesPipeline",
      "pipeline_version": "1.2.0",
      "source_file": "candidatos_2024_SP.csv",
      "source_hash": "sha256:abc123...",
      "schema_version": "tse_candidatos_v2024",
      "raw_value": "JOÃO DA SILVA,123.456.789-**,PT,DEPUTADO FEDERAL,SP"
    },
    {
      "step": "normalization",
      "timestamp": "2026-05-17T14:31:00Z",
      "rules_version": "normalization_v1.0",
      "transformations": [
        "name: uppercase → title_case",
        "party_acronym: validated against party table",
        "cpf: partial masking applied"
      ]
    },
    {
      "step": "matching",
      "timestamp": "2026-05-17T14:31:05Z",
      "identifier_used": "tse_sequential_number",
      "confidence_grade": 1,
      "matched_entity_id": "550e8400-e29b-41d4-a716-446655440000"
    }
  ]
}
```

### Rastreabilidade de derivações

Quando um `ScoreSnapshot` ou `Flag` é derivado de evidências, o `ScoreFactor` deve referenciar:
- `SourceId` — a fonte original
- `EvidenceId` — a evidência específica
- `MethodologyVersion` — a versão da metodologia de cálculo

Isso garante que: um score calculado com metodologia v1.0 a partir de evidências coletadas em 2026-05-17 pode ser reproduzido exatamente — e comparado com o score calculado com metodologia v1.1 a partir das mesmas evidências para entender o impacto da mudança de metodologia.

---

## Tipos de Evidência

### `PRIMÁRIA`

Dado diretamente coletado de fonte oficial sem transformação de sentido.

- Origem: download de CSV do TSE, resposta de API da Câmara, arquivo da Receita Federal
- Transformações permitidas: conversão de encoding, parsing de formato, cast de tipo
- Transformações proibidas: inferência, enriquecimento, interpolação
- Grau de confiança padrão: **1 ou 2** (dependendo do identificador usado)
- Exemplo: `name="JOÃO DA SILVA", party="PT", tse_sequential="123456"` — extraído literalmente do CSV do TSE

### `DERIVADA`

Dado calculado ou inferido a partir de múltiplas evidências primárias.

- Origem: cruzamento de fontes, agregação, normalização com enriquecimento
- Requer: referência a todas as evidências primárias de origem
- Transformações: permitidas e obrigatoriamente documentadas
- Grau de confiança padrão: **2 ou 3** (nunca 1)
- Exemplo: total de doações recebidas por partido em uma eleição (calculado de N doações individuais)
- Exemplo: participação societária cruzada entre CNPJ e candidatura TSE por CPF parcial

### `DOCUMENTAL`

Arquivo específico com existência independente e hash verificável.

- Origem: PDF de acórdão do TCU, PDF de ata de sessão, imagem de diário oficial
- Características: imutável por definição, referenciado por URL e hash SHA-256
- Grau de confiança padrão: **1** (o documento existe e seu hash está preservado)
- Exemplo: PDF do acórdão TCU nº 1234/2023 com hash SHA-256 armazenado
- Exemplo: CSV completo de bens declarados do TSE com hash registrado

### `TESTEMUNHAL`

Relato de pessoa física sobre fato relevante.

**Não utilizada no REPBrasil.**

O sistema é baseado exclusivamente em documentos oficiais verificáveis. Testemunhos, denúncias, relatos jornalísticos e declarações não verificadas não são fontes válidas. Esta exclusão é explícita e irrevogável.

---

## Níveis de Confiança

Escala formal de 1 a 5 para avaliação da confiança em uma evidência individual.

> **Nota:** os Graus de Certeza (1-6) da ontologia se aplicam a relações e dados exibidos. Os Níveis de Confiança (1-5) abaixo se aplicam à qualidade intrínseca de uma evidência isolada, antes de ser usada em cruzamentos.

| Nível | Nome | Critérios objetivos |
|---|---|---|
| **5** | Confiança máxima | Fonte oficial primária, API versionada, identificador único garantido, schema documentado, sem transformação de sentido, auditado publicamente |
| **4** | Alta confiança | Fonte oficial, identificador primário presente, schema estável, transformação documentada, histórico consistente |
| **3** | Confiança média | Fonte oficial mas schema instável ou histórico inconsistente; ou identificador secundário (nome, data) usado para matching; ou transformação com possibilidade de erro |
| **2** | Baixa confiança | Dado extraído de texto livre (PDF, HTML), parsing probabilístico, identificação por nome com risco de homônimo, schema antigo incompatível |
| **1** | Confiança mínima | Dado parcialmente legível, OCR com erros, identificação por proximidade, histórico truncado, fonte com instabilidade conhecida |

### Regras de derivação de confiança

1. Uma `Evidence` derivada de duas evidências de nível 5 **não é** nível 5 — é no máximo nível 4 (o cruzamento introduz incerteza)
2. Uma evidência com identificador secundário (nome) é automaticamente no máximo nível 3
3. Dado extraído de PDF por OCR é automaticamente no máximo nível 2
4. Conflito com outra evidência reduz ambas para nível de confiança 2, independentemente do original

---

## Atributos Mínimos Obrigatórios

Toda informação relevante armazenada no REPBrasil deve possuir os seguintes atributos. Se qualquer um estiver ausente, a evidência não deve ser exibida ao usuário.

### Atributos obrigatórios da `Source`

| Atributo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `Name` | string | Sim | Nome identificável da fonte |
| `Organization` | string | Sim | Órgão responsável pela fonte |
| `SourceType` | string | Sim | `API`, `CSV_BULK`, `PDF`, `HTML`, `ZIP_CSV` |
| `OriginalUrl` | string | Sim | URL exata de onde o dado foi obtido |
| `CollectedAt` | DateTime | Sim | Timestamp UTC de coleta |
| `Hash` | string | Sim | SHA-256 do arquivo/resposta coletado |
| `CollectionMethod` | string | **A implementar** | `API_REST`, `BULK_DOWNLOAD`, `SCRAPING` |
| `DatasetVersion` | string? | **A implementar** | Versão conforme publicado pela fonte |
| `SchemaVersion` | string? | **A implementar** | Versão do schema mapeado pelo pipeline |
| `ConfidenceLevel` | int | **A implementar** | Nível 1-5 conforme tabela acima |
| `License` | string? | Recomendado | Licença de uso da fonte |

### Atributos obrigatórios da `Evidence`

| Atributo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `SourceId` | Guid | Sim | FK para a Source de origem |
| `Description` | string | Sim | Descrição legível do que a evidência comprova |
| `RawValue` | string? | Recomendado | Valor bruto conforme a fonte original |
| `DocumentUrl` | string? | Quando aplicável | URL do documento específico (para DOCUMENTAL) |
| `EvidenceType` | string | **A implementar** | `PRIMÁRIA`, `DERIVADA`, `DOCUMENTAL` |
| `ConfidenceLevel` | int | **A implementar** | Nível 1-5 |
| `CollectionMethod` | string | **A implementar** | Método de coleta |
| `DatasetVersion` | string? | **A implementar** | Versão do dataset de origem |
| `Hash` | string? | **A implementar** | Hash do trecho específico quando aplicável |
| `TransformationLog` | string? | **A implementar** | JSON da chain de transformações |
| `ContestationStatus` | string | **A implementar** | `ATIVO`, `CONTESTADO`, `CORRIGIDO`, `REJEITADO` |
| `ConfidenceGrade` | int | **A implementar** | Grau 1-6 da ontologia (relação com contexto) |

---

## Fluxo de Contestação

### Quem pode contestar

- Qualquer cidadão via formulário público
- O próprio político cujos dados estão sendo exibidos
- Pesquisadores e jornalistas com evidência documental

### O que pode ser contestado

- Dado factualmente incorreto (nome errado, valor diferente da fonte)
- Dado desatualizado (situação mudou após coleta)
- Relação incorreta (homônimo, vínculo atribuído erroneamente)
- Evidência com problema de parsing (OCR errado, campo extraído incorretamente)

### O que não pode ser contestado

- Preferência por não exibição de dado correto
- Discordância com a metodologia (deve ser encaminhado como ADR)
- Dado correto mas contextualmente inconveniente
- Processo judicial público em andamento

### Fluxo formal

```
1. Cidadão submete contestação (Contestation.Status = ABERTA)
   └─ deve incluir: entidade contestada, campo específico, evidência alternativa

2. Equipe revisa (Contestation.Status = EM_ANÁLISE)
   └─ verifica fonte original
   └─ verifica evidência alternativa apresentada

3a. Contestação aceita (Contestation.Status = ACEITA)
    └─ dado original recebe flag CORRIGIDO com data e referência à contestação
    └─ novo registro criado com dado correto + referência ao anterior
    └─ EvidenceId original preservado (não apagado)
    └─ ScoreSnapshot recalculado se necessário (novo snapshot, não substituição)
    └─ entrada no changelog público

3b. Contestação rejeitada (Contestation.Status = REJEITADA)
    └─ motivo da rejeição registrado
    └─ dado original permanece inalterado
    └─ histórico da contestação preservado publicamente
```

### Invariante da contestação

**Nenhuma correção apaga histórico.** O dado incorreto fica marcado como `CORRIGIDO` e permanece visível no histórico com a data da correção e o motivo. Esta regra não tem exceção.

---

## Política de Versionamento de Evidências

### Quando uma evidência é atualizada

Uma evidência nunca é modificada diretamente. Quando a fonte é recoletada:

1. Nova `Source` é criada com novo `CollectedAt` e novo `Hash`
2. Nova `Evidence` é criada referenciando a nova `Source`
3. A evidência anterior permanece ativa (a menos que a nova substitua explicitamente)
4. O sistema pode ter múltiplas versões de uma evidência ao longo do tempo

### Evidências obsoletas

Quando uma evidência mais recente contradiz uma anterior da mesma fonte:
- A anterior recebe flag `OBSOLETA` com referência à nova
- A anterior permanece no banco e é auditável
- O frontend exibe apenas a evidência mais recente, com opção de ver histórico

### Quando a fonte muda o schema

Quando o TSE publica a eleição 2028 com schema diferente de 2024:
1. O pipeline registra o novo `SchemaVersion`
2. Os dados novos são processados com o mapeamento novo
3. Os dados antigos permanecem com o mapeamento antigo — comparação histórica requer atenção a versões diferentes de schema
4. O log da change de schema é documentado no pipeline

---

## Trilha de Auditoria

### O que é registrado

| Evento | O que é logado |
|---|---|
| Coleta de dataset | Timestamp, URL, hash, tamanho, método, pipeline, versão |
| Parsing de arquivo | Linhas processadas, erros, schema version, encoding |
| Normalização | Regras aplicadas, versão das regras, transformações específicas |
| Matching entre entidades | Identificador usado, grau de certeza, matches/falhas |
| Inserção de registro | Entidade, campos, SourceId, timestamp, pipeline |
| Cálculo de score | Inputs, metodologia version, outputs, timestamp |
| Flag gerada | Regra disparada, evidência, threshold, timestamp |
| Contestação recebida | Dado contestado, evidência apresentada, timestamp |
| Correção aplicada | Dado anterior, dado novo, referência à contestação, responsável |
| Recálculo de score | Motivo (correção, nova metodologia), snapshot anterior, novo snapshot |

### Onde os logs ficam

- Logs de pipeline: estruturado (JSON), armazenado em arquivo ou sistema de logging (loguru no ETL)
- Logs de banco: `AuditableEntity.UpdatedAt` + changelog de eventos críticos (a implementar)
- Changelog público: arquivo `CHANGELOG_DADOS.md` atualizado por pipeline a cada coleta significativa (a implementar)
- Trail de contestações: tabela `Contestations` com histórico completo (já implementado parcialmente)

---

## Gap Analysis: Estado Atual vs. Requisitos

### O que já existe

| Componente | Status | Observação |
|---|---|---|
| `Source` entity | Implementado | Faltam: CollectionMethod, SchemaVersion, ConfidenceLevel, DatasetVersion |
| `Evidence` entity | Implementado | Muito thin: faltam EvidenceType, ConfidenceLevel, TransformationLog, ContestationStatus |
| `Contestation` entity | Implementado | Falta: referência à entidade contestada (EntityType + EntityId) |
| `AuditableEntity` soft delete | Implementado | Cobertura total — todos os registros têm soft delete |
| `ScoreSnapshot` imutável | Implementado | Correto — apenas `init` setters, ScoreFactor referencia Source e Evidence |
| Hash de datasets | Implementado | `Source.Hash` existe mas não é obrigatório (nullable) |
| Log de pipeline | Parcialmente | loguru no ETL mas sem formato estruturado padronizado |
| Changelog público | Não implementado | Estrutura conceitual definida, não existe arquivo |
| Chain of Transformation | Não implementado | Conceito definido neste documento, precisa de migration |
| ConfidenceGrade por dado | Não implementado | Precisa de campo em Evidence e Source |
| EvidenceType | Não implementado | Precisa de campo enum em Evidence |

### Migrations necessárias para completar a camada

1. **`Source`**: adicionar `CollectionMethod`, `SchemaVersion`, `DatasetVersion`, `ConfidenceLevel`
2. **`Evidence`**: adicionar `EvidenceType`, `ConfidenceLevel`, `ConfidenceGrade`, `TransformationLog`, `ContestationStatus`, `Hash`
3. **`Contestation`**: adicionar `EntityType`, `EntityId`, `EvidenceId`, `SubmittedAt`, `ResolvedAt`
4. **Nova tabela `AuditLog`**: para eventos críticos de pipeline e correções
5. **Nova tabela `EvidenceVersion`**: para manter histórico de versões de uma evidência

Estas migrations devem ser parte do **Bloco 0 da implementação da Fase de Expansão** — antes de qualquer novo conector, a camada de evidência deve estar completa.

---

## O que o REPBrasil NÃO faz com evidências

| Prática | Status | Motivo |
|---|---|---|
| Usar notícias como evidência | **Proibido** | Fonte não primária, sujeita a erro editorial |
| Usar testemunhos como evidência | **Proibido** | Não verificável por terceiros |
| Inferir causalidade de correlação temporal | **Proibido** | Violação do Princípio da Não Acusação |
| Exibir dado sem SourceId | **Proibido** | Viola rastreabilidade |
| Apagar evidência por pressão | **Proibido** | Viola auditabilidade |
| Ocultar conflito de evidências | **Proibido** | Grau 6 deve ser exibido — transparência sobre incerteza |
| Interpolar dados faltantes | **Proibido** | Sem evidência = ausência de dado, não estimativa |
| Usar dado de eleição passada como estado atual sem verificação | **Proibido** | Evidência vencida deve ser marcada como OBSOLETA |
