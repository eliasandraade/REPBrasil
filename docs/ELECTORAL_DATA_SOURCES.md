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
| Histórico de candidaturas | `historico_candidatura_<ano>.zip` | ligação oficial entre candidaturas da mesma pessoa | não publicado |
| Malhas territoriais | IBGE API de malhas v3 (`qualidade=minima`) | geometria de UF/município no mapa | — (proveniência em `frontend/public/geo/meta.json`) |

Autoridades separadas: **IBGE** = geografia e código territorial; **TSE** = eleição, candidato,
zona, local, seção e voto.

## Ceará 2026, 1º turno (vertical slice)

| Arquivo | SHA-256 |
|---|---|
| BU CE 1º turno (`bweb_1t_CE_051020261403.zip`, recurso `04ba699b-0b81-44de-b279-d4c78a862503`) | `db72adfff90313635ee992714b34045f56a65ee2a2c7fd2462b3714ce169e62e` (SHA-512 oficial conferido) |
| CSV do BU | `e626076500ad9f94971212547451f955f4407f5af3d83982ed44a7c495156f32` |
| Território (`municipio_tse_ibge.zip`) | `f55c9720d221a9956279f6cb225aafcae797e0cf8ac2289040c052ab4ea7c712` |
| Cadastro (`eleitorado_local_votacao_2026.zip`) | `f75ed6866725b360a5ae2e7036e0d477944d45e36f6ccd86cd2d7ac57d7fff17` |
| Candidatos (`consulta_cand_2026.zip`, recurso `7748de82-a23b-47c4-9ec1-35535d945e5b`) | `cc7b3caec58a25cae7fa854faf989b29255130ce9c4d105f7bccb0eb04d8b00f` |
| Histórico (`historico_candidatura_2026.zip`, recurso `6c3a8826-32da-460f-b306-97474b580efb`) | `3e53872a2bcf70eb33ebfd5a932a84ba21dfc7a18b5c01180e4d847fc6a459a7` |

Os arquivos ficam fora do Git (`data/raw/` e diretórios de artefatos são ignorados).

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
