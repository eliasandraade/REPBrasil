# Migração: tecnologia eleitoral do Urnaí → REPBrasil

O Urnaí (`eliasandraade/urnai`, mesmo mantenedor) foi o laboratório onde o pipeline eleitoral foi
construído e auditado contra dados reais. A partir desta iniciativa o **REPBrasil é o repositório
canônico do produto**; o usuário final não vê outro produto, marca ou design. O Urnaí continua
existindo como referência, histórico, base de comparação e rollback conceitual — **não deletar nem
arquivar nesta etapa**.

Referência usada: branch `fix/ceara-state-sync`, HEAD `007b161` (PR #13 do Urnaí, que corrige a
sincronização estadual para escopos intercalados). A implementação de sync da `main` antiga
(`5c1fe97`) **não** foi usada.

## Licença e autoria

O repositório Urnaí não declara licença; ambos os projetos são do mesmo mantenedor, e o código
portado passa a valer sob a licença do REPBrasil (AGPL-3.0). A origem fica registrada:

- commit `ad0925d` importa `apps/ingest` **verbatim** (pacote, testes, fixtures sintéticas e
  perfis), com os blobs das fixtures binárias idênticos aos do Urnaí;
- commits seguintes só adaptam (imports, schema, nomes) — o diff contra a origem é legível;
- cabeçalhos dos scripts SQL 001–003 apontam o arquivo de origem.

## Mapa de capacidades

| Capacidade | REPBrasil antes | Urnaí | Decisão |
|---|---|---|---|
| Person / Politician / mandato / Câmara / Score / evidência / bens | sim (autoridade) | não | **manter** REPBrasil |
| Candidatos TSE 2024 (perfil por SQ_CANDIDATO) | sim | não | **manter**; 2026 entra pela camada de candidaturas |
| Resultado agregado por candidato (`ElectionResults`) | sim (2024) | não | **manter** como resumo; voto por seção não entra nele |
| Território TSE ↔ IBGE | não | sim | **migrar** (`electoral.state/municipality`) |
| Cadastro: zonas, locais, seções, agregações, aptos, coordenadas oficiais | não | sim | **migrar** |
| Boletim de Urna (Dados Abertos): layout, normalização, reconciliação, idempotência, proveniência | não | sim | **migrar** sem mudança de semântica |
| Sync estadual com escopos intercalados (memória limitada, spill, contagens do preflight) | não | sim (PR #13) | **migrar** a versão corrigida |
| EA11/EA12/EA16/EA18/EA20, ASN.1 do BU | não | sim | **migrar** (código e testes; não usados no vertical slice) |
| Disputa / candidatura / vínculo de identidade | não (Politician = candidatura 2024) | não (BU sem SQ) | **criar** (`contest`, `candidacy`, `votable_candidacy`) |
| API de território e resultado | não | NestJS | **adaptar** para .NET (`/api/v1/elections`) |
| Explorador territorial (rotas, zona automática, agregada→principal, drawer) | não | Next 16 + Motion | **adaptar** para Next 15 + design system REPBrasil, sem Motion |
| MapLibre com malhas IBGE | não | sim | **migrar** (instância única, pinos só oficiais) |
| Marca, logo, tipografia, cores, header, login Urnaí | — | sim | **eliminar** (não portados) |
| Tabelas `candidate`, `section_vote`, `urna_artifact`, `party`, `federation` do 001 | — | criadas, sem uso no fluxo de Dados Abertos | portadas para fidelidade do schema; **candidatas a remoção** quando o caminho EA for redesenhado |
| Pacotes `@urnai/brand`, `@urnai/election-data` (fixture do piloto) | — | sim | **não migrar** |

## O que mudou ao portar (sem mudar regra eleitoral)

- Tabelas no schema `electoral` (conexão com `search_path = electoral, public`); checagens de schema
  usam `current_schema()`.
- SQL versionado aplicado por migration EF; testes do ETL recriam o schema a partir dos mesmos arquivos.
- CLIs: `python -m src.electoral.cli`, `…open_data.state_sync_cli`, `…candidates.cli`.
- Lint: só correções seguras; E501 ignorado na árvore portada para manter a comparação linha a linha.
- Frontend: reescrito no design system do REPBrasil; contrato JSON em camelCase (padrão da API .NET).

## Problemas encontrados no Urnaí (documentados, não corrigidos lá)

1. **Identidade de votável entre UFs.** `votable` é único por `(election_code, office_code,
   type_code, number)`. Em 2026 o `CD_ELEICAO` estadual (6259) é o mesmo para todas as UFs, então um
   Deputado Federal 5533 do CE e um 5533 de SP colidem; o importador bloqueia (`ConsistencyError`)
   em vez de misturar — seguro, mas impede carregar uma segunda UF. No REPBrasil o vínculo de
   candidatura já é feito por UF (`votable_candidacy(votable_id, uf)`), mas o próprio `votable`
   precisa ganhar a UF antes de expandir além do CE (próxima etapa, exige migration 005 e
   reprocessamento).
2. **Banco do compose sombreado no Windows** (porta 5432 ocupada por um PostgreSQL nativo) — questão
   de ambiente local, não de código.

## Paridade verificada

Carga do CE 2026 (1º turno) no banco do REPBrasil feita **pelo pipeline**, a partir dos artefatos
oficiais (não por cópia do banco do Urnaí), e comparada em três fontes (banco REPBrasil × banco
Urnaí × CSV oficial): ver o relatório do PR.

## Aposentar o NestJS do Urnaí

1. Paridade de contrato: as rotas `/v1/elections/...` do Nest têm equivalentes em `/api/v1/elections/...`
   (catálogo, município, zona, seção/resultados). Rotas `sections/:id` do Nest eram scaffold.
2. Apontar qualquer consumidor remanescente para a API .NET.
3. Desligar o processo Nest; manter o código no repositório Urnaí como referência.

## Arquivar o Urnaí (etapa futura, não agora)

1. Expandir o REPBrasil além do CE (corrigir a identidade do votável — item 1 acima) e repetir a
   auditoria tripla por UF.
2. Portar o que ainda for útil do caminho EA (ao vivo) ou registrar o descarte.
3. Congelar o Urnaí com um README apontando para o REPBrasil; só então arquivar.
