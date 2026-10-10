# Raio X Eleitoral do Ceará

O Ceará é o primeiro estado completo do REP Brasil: eleições gerais de **2022** (1º e 2º turnos),
municipais de **2024** (1º e 2º turnos, 184 municípios) e gerais de **2026** (1º turno), com
candidaturas de todos os cargos (inclusive vices e suplentes), votação por seção a partir dos
Boletins de Urna, bens declarados, informações complementares, redes sociais, prestação de
contas e comparação entre eleições. Tudo vem de fontes oficiais (ver
[ELECTORAL_DATA_SOURCES.md](ELECTORAL_DATA_SOURCES.md)); nada é inferido por nome.

Nada aqui é específico do Ceará ou de Fortaleza: o mesmo código importa e serve qualquer UF e
qualquer município. "Não expandir para outros estados agora" é uma decisão de carga, não de código.

## 1. Identidade: pessoa ≠ político ≠ candidatura

| Conceito | Onde | Identidade |
|---|---|---|
| Candidatura | `electoral.candidacy` | disputa + `SQ_CANDIDATO` daquela eleição. Número, partido e nome de urna **não** são identidade. |
| Pessoa | `public."Persons"` | HMAC-SHA256 do CPF publicado pelo TSE (`REPBRASIL_PERSON_DOCUMENT_KEY`); o CPF nunca é gravado, logado ou exposto. |
| Político (perfil) | `public."Politicians"` | perfil público; ligado à pessoa (`PersonId`) somente por vínculo oficial. |

Resolução por candidatura (`etl/src/electoral/candidates/store.py`):

1. **CPF válido** (2022, 2026): HMAC → pessoa; perfil = o já ligado à pessoa, ou o perfil cujo `TseId`
   aparece no "Histórico de candidaturas" oficial, ou o do próprio SQ, ou um perfil novo.
2. **Sem CPF** (2024: o TSE publica `-4`):
   - `candidacy_prior` (histórico oficial de 2026 persistido): uma candidatura posterior de pessoa
     resolvida por CPF lista este SQ ⇒ mesma pessoa, status `resolved_tse_link`;
   - perfil cujo `TseId` é este SQ ⇒ vínculo com o perfil (e com a pessoa, se o perfil já tem uma);
   - senão: sem pessoa e sem perfil. Nunca por nome, nunca um perfil inventado.

A evolução de um político usa a pessoa (identidade canônica); uma eleição específica usa `candidacy_id`.

## 2. Eleições municipais (sem improvisar a UF)

- `contest.scope = 'municipal'`, `contest.electoral_unit` = código TSE do município (5 dígitos),
  `contest.uf` = UF (migration 007). Check: federal = `BR`; estadual = UF; municipal = 5 dígitos.
- O `CD_ELEICAO` municipal é o mesmo em todos os municípios da UF, e o mesmo número (ex.: vereador
  12345) existe em vários municípios. A identidade do votável do BU passou a incluir o município
  para os cargos 11/12/13 (`votable.municipality_tse_code`, índice único `NULLS NOT DISTINCT`).
- O vínculo votável → candidatura procura a disputa do **município do votável**.
- Cadastro: aptos da urna para cargos municipais (`electoral_section.eligible_municipal`, migration
  008); a reconciliação do BU confere Prefeito/Vereador contra esse eleitorado.
- Eleições suplementares publicadas no arquivo do ano (ex.: 2024 com eleições de 2025/2026) são
  separadas e contadas: não pertencem ao pleito (ano, turno).

## 3. Fatos, métricas derivadas e insights

| Camada | Objetos | Regra |
|---|---|---|
| Fatos | `section_office_result`, `section_office_vote`, `votable`, `candidacy`, `candidacy_prior`, `candidacy_asset`, `candidacy_source_record`, `candidacy_finance_record`, cadastro | só fonte oficial, com proveniência (arquivo, membro, linha, hash) |
| Derivados | `votable_zone_votes_current`, `zone_office_totals_current` (materialized views) + `derived_refresh` | recalculados por `refresh-derived` após importar o BU; a API sinaliza defasagem (`freshness.stale`) |
| Insights | `InsightEngine` (backend) | dados → métrica → template textual; a API devolve os valores estruturados de cada texto |

Os agregados por zona × cargo existem porque rankings estaduais, mapas e comparações por
município varreriam milhões de linhas de voto por requisição; seção e local de votação continuam
lidos direto dos fatos (lotes vigentes), por município.

## 4. Semântica: ausência nunca é zero

Estados (`CellState`) de qualquer valor de votação:

| Estado | Significado |
|---|---|
| `value` / `zero` | número afirmado. Zero real só com BU do cargo no território **e** vínculo auditado votável → candidatura |
| `no_coverage` | sem Boletim de Urna importado para o cargo no território |
| `partial_coverage` | parte das zonas do território tem BU: número parcial, sem delta e sem ranking |
| `outside_contest` | território fora da unidade da disputa (vereadora de outro município) |
| `not_on_ballot` | o TSE informa que a candidatura não foi inserida na urna |
| `unlinked` | sem vínculo auditado com o BU: nenhum número é afirmado |
| `ticket_member` | vice/suplente: votado na chapa do titular (os votos da chapa aparecem em `ticket`) |

Comparabilidade entre candidaturas: `comparable_contest` (mesmo cargo e mesma unidade),
`different_office`, `different_territorial_scope`, `direct_comparison_unavailable`.

Seção histórica = **UF + município + zona + seção** (nunca o número físico da urna). Entre eleições:
`comparable` (mesmo conjunto principal + agregadas), `section_composition_changed`,
`coverage_or_section_missing`. Local de votação: chave UF + município + zona + código do local.

Delta: absoluto e percentual; base zero ⇒ só o absoluto; base ausente ⇒ nada. "A superou B" =
A < B na eleição anterior e A > B na posterior, no mesmo território comparável (empate não conta).

## 5. API

| Método | Rota | Uso |
|---|---|---|
| GET | `/api/v1/politicians/{id}/xray` | Raio X do perfil: candidaturas (ano, turno, cargo, unidade, número, partido, federação, coligação, situação, resultado, votos, % válidos, posição, cobertura, chapa), bens, contas, registros, histórico oficial, evolução, insights |
| GET | `/api/v1/elections/candidacies/{id}/territory?level=municipality\|zone\|section\|place&municipality=&zone=` | distribuição territorial + resumo (melhor/pior, concentração top 5, HHI) + insights |
| GET | `/api/v1/elections/candidacies/{id}/assets?compareTo=` | bens e diferença com a candidatura anterior (itens novos/mantidos/não declarados de novo) |
| GET | `/api/v1/elections/candidacies/{id}/finance` | receitas, despesas contratadas e pagas, categorias, maiores doadores e fornecedores |
| GET | `/api/v1/elections/{ano}/{turno}/states/{uf}/candidates?municipality=&zone=&office=&party=&q=&status=&elected=&minVotes=&sort=&dir=&page=&pageSize=` | território → candidaturas (votos no território, posição na disputa, facetas) |
| GET | `/api/v1/elections/{ano}/{turno}/states/{uf}/map?layer=intensity\|share\|winner\|growth\|decline\|ab&office=&candidacy=&base=&a=&b=&municipality=` | camadas temáticas (valores da API; cor no frontend, sem cor partidária) |
| GET | `/api/v1/elections/compare?candidacy=…&uf=&level=state\|municipality\|zone\|section\|place&municipality=&zone=` | comparação de **até 5** candidaturas (400 acima disso) |

## 6. Frontend

- **Perfil → aba "Raio X eleitoral"** (`?aba=raio-x`; `?aba=eleicoes` continua válido): linha do tempo
  das candidaturas, evolução de votos e de bens, insights, histórico oficial, detalhe (território,
  bens, contas, registros) e "Comparar evolução".
- **Explorador** (`/eleicoes/...`): painel "Território" × "Candidaturas" (filtros por cargo, partido,
  situação, eleito, votos mínimos, busca, ordenação, paginação), camadas do mapa (intensidade,
  % válidos, mais votado, crescimento, queda, A × B) com legenda e tooltip de nome + valor que segue o
  ponteiro, e bandeja de comparação (máx. 5) na URL (`?c=`).
- **Comparação** (`/eleicoes/comparar?c=…&uf=CE&nivel=…`): matriz território × candidatura, evolução,
  líderes, superações, maiores variações, insights e definições; clique desce do estado à seção.

## 7. Importação (runbook)

Pré-requisitos: migrations aplicadas (`dotnet ef database update`), `DATABASE_URL` e — para
candidaturas e contas — `REPBRASIL_PERSON_DOCUMENT_KEY` (a mesma chave do ambiente; a impressão
digital é conferida e uma chave diferente é recusada). Tudo é idempotente (`already_imported`) e
reiniciável; um arquivo oficial mais novo que altere dados gravados exige `--supersede` (diff no lote).

```bash
cd etl
# território + cadastro (CSV nacional até 2024; por UF em 2026)
python -m src.electoral.cli acquire-electoral-cadaster --year 2022 --out ../data/raw/tse/cadaster/2022
python -m src.electoral.cli import-electoral-cadaster ../data/raw/tse/cadaster/2022/<sha> --year 2022 --turn 1 --uf CE
python -m src.electoral.cli import-electoral-cadaster ../data/raw/tse/cadaster/2022/<sha> --year 2022 --turn 2 --uf CE
# (idem 2024 turnos 1 e 2)

# candidaturas (2022: estaduais + federais; 2024: todos os municípios da UF; 2026: com histórico)
python -m src.electoral.candidates.cli acquire --year 2022 --out ../data/raw/tse/candidatos/2022 --resource candidates --resource assets --resource complement --resource social --uf CE
python -m src.electoral.candidates.cli import --year 2022 --turn 1 --units CE,BR --dir ../data/raw/tse/candidatos/2022
python -m src.electoral.candidates.cli import --year 2022 --turn 2 --units BR --dir ../data/raw/tse/candidatos/2022
python -m src.electoral.candidates.cli backfill-history --year 2026          # antes de 2024: identidade sem CPF
python -m src.electoral.candidates.cli import --year 2024 --turn 1 --municipal-uf CE --dir ../data/raw/tse/candidatos/2024
python -m src.electoral.candidates.cli import --year 2024 --turn 2 --municipal-uf CE --dir ../data/raw/tse/candidatos/2024

# Boletim de Urna (índice de escopos: uma passada no CSV estadual) + vínculo + agregados derivados
python -m src.electoral.cli acquire-open-data-bu --year 2022 --turn 1 --uf CE --out ../data/raw/tse/bu
python scripts/import_electoral_state.py --year 2022 --turn 1 --uf CE --manifest ../data/raw/tse/bu/<sha> --link-votables --protect-uf CE
# (idem 2022/2, 2024/1, 2024/2; o script recalcula os agregados ao final)

# bens, informações complementares e redes sociais (sanitizados)
python -m src.electoral.candidates.cli import-records --year 2024 --uf CE --kind asset --dir ../data/raw/tse/candidatos/2024
python -m src.electoral.candidates.cli import-records --year 2024 --uf CE --kind complement --dir ../data/raw/tse/candidatos/2024
python -m src.electoral.candidates.cli import-records --year 2024 --uf CE --kind social_network --dir ../data/raw/tse/candidatos/2024

# prestação de contas (leitura remota por Range; só os CSVs da UF; nada vai para o disco)
python -m src.electoral.finance.cli import --year 2024 --uf CE --dry-run
python -m src.electoral.finance.cli import --year 2024 --uf CE --save-report

# auditoria (fonte × banco, divergências classificadas)
python -m src.electoral.cli audit-election --year 2024 --turn 1 --uf CE --bu-manifest ../data/raw/tse/bu/<sha> \
  --candidates ../data/raw/tse/candidatos/2024/<sha> --municipal-uf CE --save
```

Os CLIs novos não aceitam caminho de saída: `--save`/`--save-report` gravam em diretórios fixos —
JSON completo em `etl/artifacts/reports/` (ignorado pelo git) e o resumo da auditoria em
`docs/audits/audit_<ano>_<UF>_t<turno>.md` (versionado) —, com nomes montados só com ano/turno
inteiros e UF de uma lista fechada.

## 8. Produção (Railway) — procedimento seguro

1. Backup lógico do schema `electoral` e de `Persons`/`Politicians` antes de qualquer passo.
2. Deploy do backend com as migrations 006–008 (aditivas; rollback falha explicitamente quando há
   dados que seriam destruídos). A 008 cria os agregados derivados já populados com o CE 2026.
3. Conferir o baseline do CE 2026 (184 municípios, 205 zonas, 2.751.489 linhas de voto,
   35.438.081 votos, 742 candidaturas, 640 vínculos) — deve permanecer idêntico.
4. `backfill-history --year 2026`; depois cadastro, candidaturas, BU, registros e contas de 2022 e
   2024 (seção 7), cada passo idempotente; `--protect-uf CE` na importação do BU.
5. `audit-election` por eleição; `refresh-derived` ao final.

## 9. Testes

```bash
cd backend && dotnet test -c Release              # unitários; + REPBRASIL_ELECTORAL_TEST_DB=<banco _test> para SQL
cd etl && uv run pytest -q tests/electoral tests/sources
cd frontend && npm run lint && npm run typecheck && npm test
```

Cenários sintéticos cobertos: seção 100 (2022 A=10, B=20; 2026 A=20, B=15 ⇒ A +10/+100%, B −5/−25%,
A passou à frente de B), seção com agregada só numa eleição, seção sem cobertura, candidatura
ausente, zero real, troca de cargo, mesmo número em municípios diferentes, vice/suplente, fora da urna,
sem vínculo, limite de 5, idempotência e privacidade dos importadores.

## 10. Limites conhecidos

- Eleições suplementares (CE: Senador Sá 2025/2026, Santa Quitéria 2025, Choró 2026, Potiretama 2026)
  não são modeladas: o modelo `election(ano, turno)` não comporta duas eleições no mesmo ano/turno.
- 2026: 1º turno importado; o 2º turno de 2026 ocorre em 25/10/2026.
- Prestação de contas de 2026 ainda é parcial (campanha recém-encerrada); o envio de maior prioridade vale.
- Propostas de governo e certidões criminais (PDFs por candidato, ZIPs por UF) não são importadas; a aba
  Registros indica o DivulgaCandContas (TSE), onde são publicadas, com os dados para localizar a candidatura
  (sem link profundo: o formato da URL não pôde ser conferido na fonte, cujo CDN bloqueia acesso automatizado).
- Portal da Transparência exige chave de API (cadastro gov.br) e só cruza por CPF/CNPJ ou nome; o
  REP Brasil não guarda CPF e não liga por nome ⇒ não integrado.
- Senado não publica CPF nem SQ_CANDIDATO: os senadores não são ligados automaticamente às candidaturas.
