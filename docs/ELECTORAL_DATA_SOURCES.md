# Fontes de dados eleitorais

Somente fontes oficiais. Cada arquivo é baixado uma vez, guardado *content-addressed*
(`<diretório>/<sha256>/source.zip` + `manifest.json`) e registrado em
`electoral.open_data_source_file` (portal, dataset, recurso CKAN, URL, SHA-256, SHA-512,
checksum oficial quando publicado, data de geração). Cada importação é um `ingestion_run`
com escopo, estatísticas e erro. Linhas carregam `source_line` (e `source_member` quando o ZIP
tem vários CSVs) e `source_row_hash`.

| Fonte | Recurso (Portal de Dados Abertos do TSE) | Uso | Checksum oficial |
|---|---|---|---|
| Códigos de UF e municípios TSE ↔ IBGE | `municipio_tse_ibge.zip` | território | não publicado (só hashes calculados) |
| Eleitorado por local de votação | `eleitorado_local_votacao_<ano>.zip` | zonas, locais, seções, agregações, aptos, coordenadas publicadas | não publicado |
| Boletim de Urna (por UF e turno) | `bweb_<turno>_<UF>_<data>.zip` | votos por urna × cargo | **SHA-512 publicado e conferido** |
| Candidatos | `consulta_cand_<ano>.zip` | disputas, candidaturas, CPF (só para HMAC) | não publicado |
| Histórico de candidaturas | `historico_candidatura_<ano>.zip` (publicado a partir de 2026) | ligação oficial entre candidaturas da mesma pessoa (`candidacy_prior`) | não publicado |
| Bens de candidatos | `bem_candidato_<ano>.zip` → `bem_candidato_<ano>_<UF>.csv` | `candidacy_asset` (bens por candidatura) | não publicado |
| Informações complementares | `consulta_cand_complementar_<ano>.zip` | situação detalhada, presença na urna, destinação dos votos, julgamento, cassação, diploma, limite de gastos, reeleição (lista fechada) | não publicado |
| Redes sociais | `rede_social_candidato_<ano>_<UF>.zip` (até 2022) / `rede_social_candidato_<ano>.zip` (2024+) | URLs públicas declaradas | não publicado |
| Prestação de contas de candidatos | dataset `prestacao-de-contas-eleitorais-<ano>` (2022: `dadosabertos-tse-jus-br-dataset-prestacao-de-contas-eleitorais-2022`), recurso "Prestação de contas de candidatos" | receitas, despesas contratadas e pagas (`candidacy_finance_record`) | não publicado (SHA-256/512 calculados em streaming) |
| Malhas territoriais | IBGE API de malhas v3 (`qualidade=minima`) | geometria de UF/município no mapa | — (proveniência em `frontend/public/geo/meta.json`) |
| Localidades IBGE | `servicodados.ibge.gov.br/api/v1/localidades/estados/<UF>/municipios` | auditoria do registro TSE ↔ IBGE (códigos e nomes) | — |

Autoridades separadas: **IBGE** = geografia e código territorial; **TSE** = eleição, candidato,
zona, local, seção e voto.

## Ceará 2026, 1º turno (vertical slice)

| Arquivo | SHA-256 |
|---|---|
| BU CE 1º turno (`bweb_1t_CE_051020261403.zip`, recurso `04ba699b-0b81-44de-b279-d4c78a862503`) | `db72adfff90313635ee992714b34045f56a65ee2a2c7fd2462b3714ce169e62e` (SHA-512 oficial conferido) |
| CSV do BU | `e626076500ad9f94971212547451f955f4407f5af3d83982ed44a7c495156f32` |
| Território (`municipio_tse_ibge.zip`) | `f55c9720d221a9956279f6cb225aafcae797e0cf8ac2289040c052ab4ea7c712` |
| Cadastro (`eleitorado_local_votacao_2026.zip`) | `f75ed6866725b360a5ae2e7036e0d477944d45e36f6ccd86cd2d7ac57d7fff17` |
| Candidatos (`consulta_cand_2026.zip`, recurso `7748de82-a23b-47c4-9ec1-35535d945e5b`) | `cc7b3caec58a25cae7fa854faf989b29255130ce9c4d105f7bccb0eb04d8b00f` (carga inicial); versão republicada `5384a1dd85b18de6…` (vigente, mesmas 742 candidaturas) |
| Histórico (`historico_candidatura_2026.zip`, recurso `6c3a8826-32da-460f-b306-97474b580efb`) | `3e53872a2bcf70eb33ebfd5a932a84ba21dfc7a18b5c01180e4d847fc6a459a7` (carga inicial); versão republicada `d035717654b03616…` (vigente, usada no `backfill-history`) |
| Bens (`bem_candidato_2026.zip`) | `61211df91c2f7e2e…` |
| Complementares (`consulta_cand_complementar_2026.zip`) | `328808cd3fc06bc1…` |
| Redes sociais (`rede_social_candidato_2026.zip`) | `1fb3d4fbb9395ffe…` |
| Prestação de contas (`prestacao_de_contas_eleitorais_candidatos_2026.zip`, recurso `dc8c1c26-7df0-4d90-a6da-f567b3f6cc00`) | `a279b1ae897fe5a2…` (parcial: campanha recém-encerrada) |

Os arquivos ficam fora do Git (`data/raw/` e diretórios de artefatos são ignorados). Os hashes
completos de cada versão estão em `electoral.open_data_source_file`; cada lote registra qual versão usou.

## Execução (local)

```bash
# banco: migrations EF (inclui o schema electoral; requer PostGIS)
cd backend && dotnet ef database update --project src/RepBrasil.Infrastructure --startup-project src/RepBrasil.API

cd ../etl
export DATABASE_URL=postgresql://...            # nunca hardcoded
python -m src.electoral.cli acquire-electoral-cadaster --year 2026 --out ../data/raw/tse/cadaster
python -m src.electoral.cli import-territories --cadaster-dir ../data/raw/tse/cadaster
python -m src.electoral.cli import-electoral-cadaster --cadaster-dir ../data/raw/tse/cadaster --year 2026 --turn 1 --uf CE
python -m src.electoral.cli acquire-open-data-bu --year 2026 --turn 1 --uf CE --out ../data/raw/tse/open-data
python -m src.electoral.open_data.state_sync_cli ../data/raw/tse/open-data/<sha256> --dry-run   # preflight
python -m src.electoral.open_data.state_sync_cli ../data/raw/tse/open-data/<sha256> --report ../data/processed/ce-2026-1t.json
export REPBRASIL_PERSON_DOCUMENT_KEY=...        # segredo do ambiente (>= 32 bytes)
python -m src.electoral.candidates.cli acquire --year 2026
python -m src.electoral.candidates.cli import --year 2026 --turn 1 --units CE,BR
python -m src.electoral.candidates.cli link-votables --year 2026 --turn 1 --uf CE
```

Nunca usar `--skip-csv-hash` em carga real. Reexecuções são idempotentes (`already_imported`);
um arquivo oficial mais novo que altere dados gravados exige `--supersede` e registra o diff.

## Raio X do Ceará: 2022, 2024 e 2026

Runbook completo, semântica e procedimento de produção em [CEARA_ELECTORAL_XRAY.md](CEARA_ELECTORAL_XRAY.md).

| Arquivo oficial | Observação |
|---|---|
| BU CE 2022 1º turno `bweb_1t_CE_051020221321.zip` | cabeçalho com 2 nomes diferentes de 2024/2026 (`DS_AGREGADAS`, `QT_ELEITORES_BIOMETRIA_NH`): perfil `tse-bweb-2022-v1`, mesmas 45 colunas na mesma ordem |
| BU CE 2022 2º turno `bweb_2t_CE_311020221535.zip` | só Presidente (Governador do CE decidido no 1º turno) |
| BU CE 2024 1º turno `bweb_1t_CE_091020241636.zip` | Prefeito e Vereador, 184 municípios |
| BU CE 2024 2º turno `bweb_2t_CE_281020241046.zip` | só municípios com 2º turno |
| Cadastro 2022/2024 `eleitorado_local_votacao_<ano>.zip` | um CSV NACIONAL (a UF é filtrada; linhas de outras UFs são contadas); `QT_ELEITOR_ELEICAO_MUNICIPAL` só em 2024 |
| Candidatos 2024 `consulta_cand_2024.zip` | CPF mascarado (`-4`) em todas as linhas; inclui eleições suplementares de 2025/2026 (separadas) |
| Redes sociais 2022 `rede_social_candidato_2022_<UF>.zip` / 2024+ arquivo único | muitos perfis declarados sem esquema (`instagram.com/…`): o `https://` só é completado para uma lista fechada de redes conhecidas; o resto é descartado e contado (`dropped_not_a_public_url`, separado de `dropped_personal_contact`) |

### Prestação de contas (CDN do TSE)

| Ano | Arquivo | Tamanho | SHA-256 (calculado em streaming) |
|---|---|---|---|
| 2022 | `prestacao_de_contas_eleitorais_candidatos_2022.zip` (recurso `e45493d5-75df-4ccf-a4b4-7b1f5213577d`) | 474,7 MB | `d706fa9abaa8e00a…` |
| 2024 | `prestacao_de_contas_eleitorais_candidatos_2024.zip` (recurso `c74840a4-f303-4771-af44-ecbf15bfc302`) | 1,33 GB | `c78fb4689224b9b2…` |
| 2026 | `prestacao_de_contas_eleitorais_candidatos_2026.zip` (recurso `dc8c1c26-7df0-4d90-a6da-f567b3f6cc00`) | 177,9 MB | `a279b1ae897fe5a2…` |

O ZIP é lido remotamente por `Range` (diretório central + só os membros da UF pedida); nada vai para
o disco. O tamanho e a versão vêm do `Content-Range` de um GET `bytes=0-0`, não do `HEAD`: em
10/10/2026 o CDN respondeu ao `HEAD` do arquivo de 2026 com `Content-Length: 1`, o que fazia o leitor
procurar o diretório central no lugar errado (`BadZipFile`). Sem suporte a `Range` (HTTP 206) a
leitura falha fechada.

## Privacidade

- CPF: só HMAC-SHA256 chaveado (identidade); nunca gravado, logado, exposto, nem usado num hash
  simples. A impressão digital de cada linha é calculada com o CPF redigido.
- Não gravados: título eleitoral, e-mail, telefone, data de nascimento, cor/raça, gênero, etnia,
  naturalidade, idade, CPF do vice, município/UF de doadores e fornecedores, números de recibo.
- Texto livre (descrições de bens e despesas): e-mails e sequências com formato de CPF mascarados.
- Redes sociais: só URLs http(s); WhatsApp, `mailto:`/`tel:` e URLs com e-mail são descartados.
- Doadores/fornecedores: nome publicado pelo TSE; documento só como HMAC (agrupamento); CNPJ em
  claro apenas para empresas (identificador público).

## Outras fontes oficiais pesquisadas

| Fonte | Endpoint | Situação |
|---|---|---|
| Câmara dos Deputados | `https://dadosabertos.camara.leg.br/api/v2` (sem autenticação) | adaptador existente (`etl/src/sources/camara`): deputados por legislatura; a API de detalhe publica CPF — ligação por HMAC possível como evolução futura |
| Senado Federal | `https://legis.senado.leg.br/dadosabertos/senador/lista/atual?uf=CE` (JSON com `Accept: application/json`) | provedor `etl/src/sources/senado` (código oficial do Senado, partido, UF, mandato). Sem CPF nem SQ ⇒ nenhum vínculo automático com candidaturas |
| IBGE | `https://servicodados.ibge.gov.br/api/v1/localidades` | provedor `etl/src/sources/ibge` para auditar o registro territorial (184 municípios no CE) |
| Portal da Transparência | `https://api.portaldatransparencia.gov.br/api-de-dados` | exige chave (`chave-api-dados`, cadastro gov.br) — HTTP 401 sem ela; cruzamentos são por CPF/CNPJ ou nome ⇒ não integrado (o REP Brasil não guarda CPF e não liga por nome) |
| TSE — propostas de governo e certidões criminais | ZIPs de PDFs por UF no dataset `candidatos-<ano>` | não importados (documentos por candidato; ver limites em CEARA_ELECTORAL_XRAY.md) |
