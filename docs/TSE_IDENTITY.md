# Identificadores do TSE e identidade (contrato)

Este documento é o contrato de identificadores eleitorais do REPBrasil: o que cada código do TSE
significa, onde fica guardado e como uma candidatura chega a um perfil — sempre por
identificadores oficiais, **nunca por nome**.

## Identificadores

| Identificador | Significado | Muda entre eleições? | Onde fica |
|---|---|---|---|
| `CD_PLEITO` | pleito (turno de uma eleição) no TSE | sim | `electoral.election.pleito_code` |
| ano + turno | pleito/turno no REPBrasil | — | `electoral.election (year, round)` (único) |
| `CD_ELEICAO` | eleição dentro do pleito (2026: 6257 federal, 6259 estadual) | sim | `electoral.contest.tse_election_code`, `votable.election_code`, `section_office_result.election_code` |
| `CD_CARGO` / `CD_CARGO_PERGUNTA` | cargo (1 Presidente, 3 Governador, 5 Senador, 6 Dep. Federal, 7 Dep. Estadual, 8 Dep. Distrital; 2/4/9/10 vices e suplentes) | não | `electoral.office.code`, `contest.office_code` |
| `SG_UE` | unidade eleitoral da disputa (`BR` ou a UF) | — | `electoral.contest.electoral_unit` |
| `SQ_CANDIDATO` | **candidatura** (não a pessoa) | **sim** | `electoral.candidacy.tse_candidate_id`; `public."Politicians"."TseId"` |
| `NR_CANDIDATO` / `NR_VOTAVEL` | número na urna, único dentro da disputa | pode mudar | `candidacy.candidate_number`, `votable.number` |
| `NR_CPF_CANDIDATO` | pessoa | não | **nunca gravado**; só o HMAC em `public."Persons"."NormalizedDocumentHash"` |
| `SQ_CANDIDATO_ATUAL` → `SQ_CANDIDATO` | histórico oficial: candidaturas anteriores da mesma pessoa | — | usado na resolução; não persistido |
| `CD_MUNICIPIO` (TSE, 5 dígitos) | município no TSE | não | `electoral.municipality.tse_code` |
| código IBGE (7 dígitos) | município no IBGE (geografia) | não | `electoral.municipality.ibge_code`; malhas em `frontend/public/geo` |
| `NR_ZONA` | zona eleitoral (por UF) | — | `electoral.electoral_zone (state_code, zone_number)` |
| `NR_LOCAL_VOTACAO` | local de votação | pode mudar | `electoral.polling_place.tse_location_code` |
| `NR_SECAO` | seção, única dentro de município + zona | — | `electoral.electoral_section.section_number` |

`public."Politicians"."TseId"` **é o `SQ_CANDIDATO`** da candidatura que originou o perfil
(confirmado no código: `TseCandidatesPipeline` grava `SQ_CANDIDATO`). Para os perfis de 2024 é o
SQ de 2024; para perfis criados a partir de 2026, o SQ de 2026. Não identifica a pessoa entre
eleições.

## Resolução de identidade (determinística)

1. **Pessoa** = CPF publicado pelo TSE no arquivo de candidatos da eleição corrente
   (`consulta_cand_2026` publica; `consulta_cand_2024` hoje publica `-4`/"NÃO DIVULGÁVEL").
   Gravado como `HMAC-SHA256(REPBRASIL_PERSON_DOCUMENT_KEY, cpf)` em
   `Persons.NormalizedDocumentHash` (`DocumentType = 'CPF'`). Um SHA-256 sem chave seria
   revertido por enumeração (são ~10⁹ CPFs). Sem chave, a importação não roda. Índice único
   parcial garante uma pessoa ativa por documento.
2. **Perfil** da pessoa, nesta ordem:
   1. perfil já ligado à pessoa (`Politicians.PersonId`);
   2. perfil cujo `TseId` é um `SQ_CANDIDATO` anterior listado pelo próprio TSE no recurso
      "Histórico de candidaturas" para a candidatura atual — é assim que um(a) vereador(a) de 2024
      já presente no REPBrasil é reconhecido(a) como candidato(a) a deputado(a) em 2026;
   3. perfil cujo `TseId` é o próprio `SQ_CANDIDATO` atual (reexecução);
   4. novo perfil criado a partir da candidatura oficial (mesma convenção do pipeline de 2024).
3. Um perfil **já ligado a outra pessoa nunca é reaproveitado**: conflito registrado no lote,
   candidatura fica sem perfil (`politician_id` nulo) até revisão.
4. Sem CPF válido: `identity_status = unresolved_document_unavailable | unresolved_document_invalid`,
   sem pessoa e sem perfil. O voto continua visível (`profileAvailable = false`).

**Proibido:** fuzzy match que escreva `PersonId`; "nome parecido" como vínculo; slug como
identidade; Google/Wikipedia como fonte de identidade. Correspondência por nome só pode existir
como sugestão para revisão humana (não implementada nesta etapa).

## Votável do BU → candidatura

O Boletim de Urna não publica `SQ_CANDIDATO`. O vínculo (`electoral.votable_candidacy`) é feito
por `CD_ELEICAO + cargo + NR_VOTAVEL` dentro da unidade eleitoral da urna (a UF da seção; `BR`
para cargos federais):

- exatamente uma candidatura ⇒ vínculo (`method = contest_number`);
- nenhuma ⇒ `unmatched`; mais de uma ⇒ `ambiguous`; nome de urna divergente entre o BU e o arquivo
  de candidatos ⇒ `name_mismatch` (conflito entre fontes oficiais) — **sem vínculo**, registrado.

Votos de legenda pertencem ao partido, não a uma pessoa: nunca ligam a perfil.

**Substituição de candidatura (CE 2026).** 8 votáveis ficaram `ambiguous`: o número passou da
candidatura substituída para a substituta (ex.: Dep. Federal 4077, Dep. Estadual 40777, Governador 30,
Presidente 28). A candidatura substituída aparece no arquivo de candidatos sem totalização
(`DS_SIT_TOT_TURNO = #NULO`). Regra candidata, **ainda não aplicada** e sujeita a revisão: entre
candidaturas com o mesmo número na disputa, considerar só as totalizadas; se restar exatamente uma e o
nome de urna coincidir com o do BU, vincular com um método próprio (`contest_number_totalized`). Até
lá, esses votos aparecem sem perfil — corretos, apenas sem vínculo. Os 3 casos `name_mismatch` são
abreviações divergentes entre as duas fontes oficiais (ex.: `PROFª` × `PROF.`).

## Situação na eleição

`elected` é derivado de `CD_SIT_TOT_TURNO` por tabela fixa: 1 Eleito, 2 Eleito por QP,
3 Eleito por média ⇒ `true`; 4 Não eleito, 5 Suplente ⇒ `false`; 6 2º turno e `#NULO` ⇒ `null`
(indefinido). O texto original fica em `round_outcome`.

## Privacidade

Não são gravados: CPF, e-mail, título de eleitor, data de nascimento, gênero, cor/raça, grau de
instrução, estado civil e ocupação, embora o TSE os publique. A exposição de dados pessoais não
aumenta por causa da camada eleitoral.

## Hashes: o que cada um garante

| Hash | Sobre o quê | Para quê | Chaveado? |
|---|---|---|---|
| `open_data_source_file.zip_sha256` / `zip_sha512` / `csv_sha256` | arquivo oficial inteiro | integridade integral da fonte (o SHA-512 do BU é o publicado pelo TSE) | não (é sobre o arquivo público) |
| `candidacy.source_row_hash` | campos canônicos da linha de candidatura com `NR_CPF_CANDIDATO` trocado por `[REDACTED]` | proveniência da linha (detectar mudança de conteúdo) | não — e por isso o CPF é redigido antes |
| `section_office_vote.source_row_hash` | linha do BU (não contém dado pessoal) | proveniência do voto | não |
| `Persons.NormalizedDocumentHash` | CPF (dígitos) | identidade da pessoa | **sim**: HMAC-SHA256 com `REPBRASIL_PERSON_DOCUMENT_KEY` |

Nenhum hash persistido sem chave cobre o CPF: um verificador offline ("este CPF é deste candidato?")
exigiria o segredo. O CPF nunca é gravado, logado ou exposto pela API.

## Ciclo de vida da chave `REPBRASIL_PERSON_DOCUMENT_KEY`

A chave é **parte da identidade persistida**: o mesmo CPF com outra chave gera outro hash e,
portanto, outra `Person`.

- **Estável por banco/ambiente.** Cada banco (local, staging, produção) tem a sua chave, e ela não
  muda entre deploys do mesmo banco.
- **Mínimo de 32 bytes** de segredo aleatório (ex.: `python -c "import secrets; print(secrets.token_urlsafe(48))"`).
  Chave ausente ou curta: a importação de candidaturas não roda (não há fallback sem chave).
- **Nunca commitada**, nunca em `.env` versionado, nunca em log, issue ou PR. Em produção, só no
  gerenciador de segredos do provedor. No CI, apenas uma chave fictícia de teste.
- **Backup seguro fora do banco** (cofre de segredos com controle de acesso). Perder a chave não
  apaga dados, mas impede que futuras importações reconheçam as mesmas pessoas.
- **Troca silenciosa é bloqueada.** Cada lote de candidaturas grava em `ingestion_run.stats` a
  `key_fingerprint` (HMAC da constante `repbrasil:person-document-key:check:v1`, 16 hex — não revela
  a chave nem permite verificar CPFs). Se a chave atual não reproduz a impressão digital do último
  lote bem-sucedido, a importação é recusada.
- **Rotação = processo explícito**, nunca automático: (1) congelar importações; (2) com a chave
  antiga e a nova disponíveis e os arquivos oficiais de candidatos que publicam CPF, recalcular
  `NormalizedDocumentHash` de cada `Person` numa transação, verificando 1:1 (nenhuma colisão, nenhuma
  pessoa nova); (3) registrar o lote de rotação com a nova impressão digital; (4) descartar a chave
  antiga do cofre. Pessoas cujo CPF a fonte não publica mais não podem ser re-hasheadas — por isso a
  rotação só deve ocorrer por incidente de segurança.

