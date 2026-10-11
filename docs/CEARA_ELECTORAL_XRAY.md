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
- Substituição de candidatura: o TSE mantém a candidatura substituída e a substituta na mesma disputa,
  com o mesmo número. Com mais de uma candidatura para disputa + número, o vínculo só é feito pelos
  sinalizadores oficiais do complementar, com método próprio: exatamente uma inserida na urna
  (`ST_CANDIDATO_INSERIDO_URNA`; `contest_number_inserted_in_urn`, migration 010) ou, quando a
  substituição veio depois da carga das urnas (ex.: falecimento do titular) e as duas constam como
  inseridas, exatamente uma não substituída (`ST_SUBSTITUIDO = N`; `contest_number_substitution`,
  migration 011). Sem essa prova, fica sem vínculo. O nome de urna do BU e o do arquivo de candidatos
  são sempre conferidos (sem acentos, pontuação nem ordinais): o nome nunca escolhe a candidatura, só
  veta o vínculo quando diverge.
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

Todo percentual de distribuição diz sobre o que incide (`values.base`): a votação inteira da
candidatura (`candidacy`: recorte = disputa inteira, com cobertura completa), os votos com Boletim de
Urna importado (`imported`: disputa nacional — só as UFs carregadas — ou cobertura parcial) ou o recorte
exibido (`shown`: município ou zona escolhidos, seções, locais).

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
`different_office`, `different_territorial_scope`, `direct_comparison_unavailable`. Na evolução do
perfil, cada candidatura é comparada com a anterior da mesma disputa quando existe (Dep. Federal 2022 →
2026, mesmo com uma prefeitura em 2024 no meio); sem ela, com a imediatamente anterior, sem delta.

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
candidaturas e contas — `REPBRASIL_PERSON_DOCUMENT_KEY` (a mesma chave usada nas importações
anteriores daquele banco; a impressão digital é conferida e uma chave diferente é recusada). Tudo é
idempotente (`already_imported`) e reiniciável; um arquivo oficial mais novo que altere dados
gravados exige `--supersede` (diff no lote).

A ordem importa: o histórico de 2026 antes das candidaturas de 2024 (identidade sem CPF) e o
complementar antes do vínculo do BU (desempate oficial de substituições, seção 1).

```bash
cd etl
# 1. território + cadastro (CSV nacional até 2024; por UF em 2026)
python -m src.electoral.cli acquire-electoral-cadaster --year 2022 --out ../data/raw/tse/cadaster/2022
python -m src.electoral.cli import-electoral-cadaster ../data/raw/tse/cadaster/2022/<sha> --year 2022 --turn 1 --uf CE
python -m src.electoral.cli import-electoral-cadaster ../data/raw/tse/cadaster/2022/<sha> --year 2022 --turn 2 --uf CE
# (idem 2024 turnos 1 e 2)

# 2. histórico oficial de 2026 (só fatos "SQ atual ⇒ SQ anteriores"; não altera candidaturas)
python -m src.electoral.candidates.cli backfill-history --year 2026 --history ../data/raw/tse/candidates-v2/<sha-historico>

# 3. candidaturas (2022: estaduais + federais; 2024: todos os municípios da UF), um turno por vez
python -m src.electoral.candidates.cli acquire --year 2022 --out ../data/raw/tse/candidatos/2022 --resource candidates --resource assets --resource complement --resource social --uf CE
python -m src.electoral.candidates.cli acquire --year 2022 --out ../data/raw/tse/candidatos/2022 --resource social --uf BR
python -m src.electoral.candidates.cli import --year 2022 --turn 1 --units CE,BR --candidates ../data/raw/tse/candidatos/2022/<sha>
python -m src.electoral.candidates.cli import --year 2022 --turn 2 --units CE,BR --candidates ../data/raw/tse/candidatos/2022/<sha>
python -m src.electoral.candidates.cli import --year 2024 --turn 1 --municipal-uf CE --candidates ../data/raw/tse/candidatos/2024/<sha>
python -m src.electoral.candidates.cli import --year 2024 --turn 2 --municipal-uf CE --candidates ../data/raw/tse/candidatos/2024/<sha>

# 4. bens, informações complementares e redes sociais (sanitizados), por ano × UF (BR = federais)
python -m src.electoral.candidates.cli import-records --year 2024 --uf CE --kind complement --source ../data/raw/tse/candidatos/2024/<sha>
python -m src.electoral.candidates.cli import-records --year 2024 --uf CE --kind asset --source ../data/raw/tse/candidatos/2024/<sha>
python -m src.electoral.candidates.cli import-records --year 2024 --uf CE --kind social_network --source ../data/raw/tse/candidatos/2024/<sha>
# (idem 2022 CE e BR; 2026 CE e BR após `acquire --year 2026 --resource assets --resource complement --resource social`)

# 5. Boletim de Urna + vínculo votável → candidatura; as eleições podem rodar em paralelo
python -m src.electoral.cli acquire-open-data-bu --year 2022 --turn 1 --uf CE --out ../data/raw/tse/bu
python scripts/import_electoral_state.py --year 2022 --turn 1 --uf CE --manifest ../data/raw/tse/bu/<sha> --link-votables --no-refresh
# (idem 2022/2, 2024/1, 2024/2). Se o vínculo rodou antes do complementar, de um arquivo de
# candidaturas mais novo, de zonas novas do BU ou de uma regra nova, rode-o de novo: a chave do lote
# é a impressão digital do conteúdo das entradas (migration 013) — nada é invalidado à mão:
python -m src.electoral.candidates.cli link-votables --year 2022 --turn 1 --uf CE

# 6. agregados derivados (uma vez, depois de todos os BUs)
python -m src.electoral.cli refresh-derived

# 7. prestação de contas (leitura remota por Range; só os CSVs da UF; nada vai para o disco)
python -m src.electoral.finance.cli import --year 2024 --uf CE --dry-run
python -m src.electoral.finance.cli import --year 2024 --uf CE --save-report
# (2022 e 2026: CE e BR)

# 8. auditoria (fonte × banco, divergências classificadas) → docs/audits/
python -m src.electoral.cli audit-election --year 2024 --turn 1 --uf CE --bu-manifest ../data/raw/tse/bu/<sha> \
  --candidates ../data/raw/tse/candidatos/2024/<sha> --municipal-uf CE --save
```

`--protect-uf X` do `import_electoral_state.py` compara o mesmo ano/turno de OUTRA UF antes e
depois (útil ao importar outro estado); para o próprio CE, confira o baseline de 2026 (seção 8)
antes e depois da carga.

### 7.1 Validação prévia com os arquivos oficiais (dry-run, sem banco)

Os arquivos oficiais do CE de 2022 e 2024 já adquiridos foram lidos pelos mesmos parsers da importação,
em modo `--dry-run` (nada é gravado). Números da fonte, não do banco:

| Arquivo oficial | Resultado |
|---|---|
| Cadastro 2022 (CSV nacional), CE | 1º e 2º turnos: 184 municípios, 205 zonas, 24.837 seções (22.796 principais + 2.041 agregadas); 472.019 linhas de outras UFs puladas e contadas |
| Cadastro 2024 (CSV nacional), CE | 1º turno: 184 municípios, 205 zonas, 25.467 seções (23.357 + 2.110); 2º turno: só Fortaleza e Caucaia (20 zonas, 6.218 seções) |
| BU 2022/1, município 13030 zona 30 | 161 urnas; Presidente, Governador, Senador, Dep. Federal e Dep. Estadual com 36.725 votos = comparecimento em cada cargo |
| BU 2022/2, mesma zona | só Presidente (eleição 545): 37.023 votos = comparecimento |
| BU 2024/1, Fortaleza zona 1 | 344 urnas; Prefeito e Vereador (eleição 619) com 100.573 votos = comparecimento; 693 votáveis nominais |
| BU 2024/2, Fortaleza zona 1 | Prefeito (eleição 620): 100.174 votos = comparecimento; 2 candidaturas |
| Candidatos 2022 (CE + BR) | 1º turno: 1.044 candidaturas em 9 disputas (com vices e suplentes), 1.043 com CPF válido; 2º turno: 4 |
| Candidatos 2024 (todos os municípios do CE) | 1º turno: 13.213 candidaturas em 552 disputas (184 × 3 cargos), nenhuma com CPF publicado; 2º turno: 8; 21 linhas de 5 eleições suplementares separadas |
| Bens, complementares e redes 2022/2024 | layouts oficiais reconhecidos; 2024: 23.231 bens (8.557 candidaturas), 15.135 links de redes (296 contatos pessoais descartados) |
| Prestação de contas 2022, CE (leitura remota por Range) | 127.601 linhas, 940 candidaturas; receitas R$ 214,4 mi, despesas contratadas R$ 208,8 mi, pagas R$ 205,4 mi |
| Prestação de contas 2024, CE (ZIP de 1,33 GB; só os membros do CE) | 307.017 linhas, 12.630 candidaturas; receitas R$ 274,0 mi, contratadas R$ 259,3 mi, pagas R$ 257,2 mi; 529 linhas de eleições suplementares separadas |
| Candidatos 2026 (CE + BR), versão mais nova, com histórico | 742 candidaturas (igual ao baseline), todas com CPF válido; 2.093 linhas do histórico oficial para elas |

Cada turno de candidaturas tem uma única data de eleição, igual à do cadastro (a importação recusa
datas divergentes). Essa validação encontrou e corrigiu dois problemas antes da carga: o dry-run do BU
não lia o cadastro nacional de 2022/2024, e um local de votação de 2024 (município 15970, zona 55,
local 1384) publica a coordenada em só uma das suas linhas — agora a coordenada publicada vale para o
local, com aviso, e coordenadas publicadas divergentes deixam o local sem coordenada.

### 7.2 Carga real no banco local (10/10/2026)

Executada na ordem da seção 7, com a mesma chave de documento das cargas de 2026 (impressão digital
`314dc31974cca7c5`). Números do banco, conferidos pelas auditorias de `docs/audits/`.

| Eleição | Candidaturas | Identidade | Boletim de Urna (zonas · seções com urna · linhas de voto · votos) | Vínculo votável → candidatura |
|---|---|---|---|---|
| 2022 · 1º turno | 1.044 (9 disputas CE + BR, com vices e suplentes) | 1.043 por CPF (HMAC) + 1 pelo histórico oficial | 205 · 22.796 · 2.664.589 · 28.122.410 | 908 de 908 (48 pelo "inserido na urna") |
| 2022 · 2º turno | 4 (Presidente e vice) | por CPF (HMAC) | 205 · 22.796 · 88.629 · 5.649.398 | 2 de 2 |
| 2024 · 1º turno | 13.213 (552 disputas = 184 municípios × 3 cargos) | 277 pela pessoa via histórico oficial de 2026; 12.936 só no perfil já existente com o mesmo SQ (`TseId`), sem pessoa | 205 · 23.357 · 1.547.059 · 11.899.924 | 12.148 de 12.148 (68 pelo "inserido na urna", 1 pela substituição) |
| 2024 · 2º turno | 8 (Fortaleza e Caucaia) | 5 pelo histórico oficial; 3 só no perfil | 20 · 6.034 · 24.046 · 1.687.170 | 4 de 4 |
| 2026 · 1º turno | 742 (baseline) | 742 por CPF (HMAC) | 205 · 23.765 · 2.751.489 · 35.438.081 (intacto) | 651 de 651 (7 pelo "inserido na urna", 1 pela substituição) |

Total no banco local: 7.075.812 linhas de voto e 82.796.983 votos (inclusive brancos, nulos e
legenda), 840 lotes de BU (um por município × zona × eleição). Tempo de carga do BU nesta máquina
(Docker Desktop, uma ida e volta ao banco por seção × cargo): 2022/1 ≈ 100 min, 2024/1 ≈ 47 min,
2022/2 ≈ 24 min, 2024/2 ≈ 5 min, com cargas em paralelo; o refresh dos agregados leva ~10 s.

Linhas de eleições suplementares (5 eleições de 2025/2026 no arquivo de 2024) foram separadas e
contadas em todas as cargas: 21 candidaturas, 69 bens, 38 redes, 529 linhas de contas.

| Registros oficiais | CE | BR (federais) |
|---|---|---|
| 2022 | 2.780 bens (613 candidaturas), 1.018 complementares, 1.939 redes (12 contatos pessoais e 1 texto sem URL descartados) | 240 bens, 30 complementares, 213 redes |
| 2024 | 23.162 bens (8.542 candidaturas), 13.221 complementares, 15.136 redes (103 contatos pessoais e 126 textos sem URL pública descartados) | — |
| 2026 | 2.637 bens (488 candidaturas), 714 complementares, 1.757 redes (1.277 contatos pessoais e 312 textos sem URL pública descartados) | 309 bens, 28 complementares, 212 redes |

| Prestação de contas | Linhas gravadas | Candidaturas | Receitas · contratadas · pagas |
|---|---|---|---|
| 2022 CE | 125.532 (2.069 repetidas) | 940 | R$ 214,4 mi · R$ 204,2 mi · R$ 205,4 mi |
| 2022 BR (Presidente e vice, campanha nacional) | 408.647 (649 repetidas) | 13 | R$ 381,4 mi · R$ 341,8 mi · R$ 336,7 mi |
| 2024 CE | 303.425 (3.063 repetidas) | 12.630 | R$ 274,0 mi · R$ 257,1 mi · R$ 257,2 mi |
| 2026 CE (parcial: campanha recém-encerrada) | 58.189 (882 repetidas) | 667 | R$ 248,1 mi · R$ 169,9 mi · R$ 128,7 mi |
| 2026 BR (parcial) | 7.265 (20 repetidas) | 13 | R$ 214,9 mi · R$ 169,6 mi · R$ 123,9 mi |

"Repetidas" são linhas idênticas byte a byte na fonte (mesmo `SQ_RECEITA`/`SQ_DESPESA` e todas as
colunas iguais), gravadas uma vez — por isso as despesas contratadas do CE em 2022 somam R$ 204,2 mi
no banco e R$ 208,8 mi na leitura bruta da seção 7.1. Nenhuma linha ficou sem candidatura.

### 7.3 Auditorias (fonte oficial × banco)

`audit-election --save` relê o CSV oficial do BU e o arquivo de candidatos e compara com o banco, por
cargo; os resumos estão em [`docs/audits/`](audits/). Todas as eleições carregadas fecharam **ok**:

| Eleição | Urnas | Cargos conferidos (urnas, linhas, votos nominais, legenda, brancos, nulos: fonte = banco) | Divergências |
|---|---|---|---|
| 2022 · 1º turno | 22.796 | Presidente, Governador, Senador, Dep. Federal, Dep. Estadual | só esperadas |
| 2022 · 2º turno | 22.796 | Presidente | só esperadas |
| 2024 · 1º turno | 23.357 | Prefeito, Vereador | só esperadas (+21 linhas de eleições suplementares separadas) |
| 2024 · 2º turno | 6.034 | Prefeito (Fortaleza e Caucaia) | só esperadas |
| 2026 · 1º turno | 23.765 | Presidente, Governador, Senador, Dep. Federal, Dep. Estadual | só esperadas |

"Esperadas" = seções agregadas sem urna própria e vices/suplentes sem voto próprio (votados na chapa).
Nenhuma eleição tem vínculo ambíguo, divergência de fonte, dado faltante ou erro de integridade.

### 7.4 Desempenho (EXPLAIN ANALYZE com todos os dados)

Medido na API local em Release com os cinco pleitos carregados: tempos da requisição inteira sem
instrumentação (mediana de 3 chamadas, cache quente; a 1ª chamada fria entre parênteses) e planos
capturados pelo `auto_explain` (`log_analyze`, `log_buffers`) só nas conexões de uma segunda instância
da API, para não afetar as demais.

| Requisição | ms |
|---|---|
| Raio X do perfil (4 candidaturas: 2022, 2024 nos dois turnos, 2026) | 102 (227) |
| Território · município / zona / seção (Fortaleza z.1) | 21 / 11 / 72 |
| Território · locais de votação de Fortaleza | 429 (761) |
| Território → candidaturas: UF 2026 / Fortaleza 2024 / vereadores de Fortaleza | 202 / 109 / 139 |
| Mapa · mais votado: Governador 2026 / Presidente 2022 2º turno / Prefeito 2024 (184 disputas) | 62 / 27 / 628 |
| Mapa · A × B por local (Fortaleza 2024, 2º turno) / % válidos por local (Fortaleza) | 176 / 427 |
| Mapa · crescimento 2022 → 2026 | 49 |
| Comparação · estado / município / zona (2 turnos de 2024) | 16 / 18 / 26 |
| Comparação · seção (Fortaleza inteira, 2 eleições × 5.285 seções) | 465 (1.579) |

Duas consultas foram reescritas depois do EXPLAIN com os dados reais (seção e local de votação liam o
lote vigente de cada urna por subconsulta correlacionada e somavam os votos válidos urna a urna):
votos válidos agregados de uma vez (hash join com `votable`) e lotes vigentes do município
materializados uma vez por consulta. Na mesma medição instrumentada (`auto_explain` ligado), antes →
depois: locais de Fortaleza 4.580 → 526 ms, % válidos por local 4.140 → 506 ms, comparação por seção
6.683 → 535 ms. Nenhum plano faz varredura sequencial em tabela grande fora das
agregações de UF inteira, que leem quase todas as linhas dos agregados derivados por definição.

Os CLIs novos não aceitam caminho de saída: `--save`/`--save-report` gravam em diretórios fixos —
JSON completo em `etl/artifacts/reports/` (ignorado pelo git) e o resumo da auditoria em
`docs/audits/audit_<ano>_<UF>_t<turno>.md` (versionado) —, com nomes montados só com ano/turno
inteiros e UF de uma lista fechada.

## 8. Produção (Railway) — procedimento seguro

1. Backup lógico do schema `electoral` e de `Persons`/`Politicians` antes de qualquer passo.
2. Deploy do backend com as migrations 006–011 (aditivas; rollback falha explicitamente quando há
   dados que seriam destruídos). A 008 cria os agregados derivados já populados com o CE 2026; a 009
   põe o turno na chave de idempotência da importação de candidaturas (o mesmo arquivo oficial traz
   os dois turnos); a 010 permite o vínculo desempatado pelo "inserido na urna" e versiona a regra
   de vínculo; a 011 permite o vínculo na substituição feita depois da carga das urnas.
3. Conferir o baseline do CE 2026 (184 municípios, 205 pares município × zona, 2.751.489 linhas de
   voto, 35.438.081 votos, 742 candidaturas, 640 vínculos) — os fatos de 2026 devem permanecer
   idênticos (só podem ganhar vínculos novos pelas regras das migrations 010 e 011: no banco local,
   640 → 651 de 651 votáveis).
4. Seguir a seção 7 na ordem: cadastro → histórico de 2026 → candidaturas (um turno por vez) →
   registros (complementar antes do BU) → BU com vínculo → `link-votables` de novo se o vínculo rodou
   antes do complementar → `refresh-derived` → contas → auditorias. Cada passo é idempotente e
   retomável; use a mesma `REPBRASIL_PERSON_DOCUMENT_KEY` do ambiente de produção.
5. Publicar os resumos `docs/audits/audit_<ano>_CE_t<turno>.md` gerados com `--save` e conferir
   que nenhuma auditoria tem `integrity_error`.

## 9. Testes

```bash
cd backend && dotnet test -c Release              # unitários; + REPBRASIL_ELECTORAL_TEST_DB=<banco _test> para SQL
cd etl && uv run pytest -q tests/electoral tests/sources
cd frontend && npm run lint && npm run typecheck && npm test
```

Estado em 10/10/2026: backend 56 testes unitários + 60 de banco (PostgreSQL 18 + PostGIS, mesma
sequência do CI: migrations do zero → rollback até `AddMandate` → de novo); ETL 210 sem banco + 161 de
banco (`tests/electoral`); frontend 71 (vitest) + lint + typecheck.

Cenários sintéticos cobertos: seção 100 (2022 A=10, B=20; 2026 A=20, B=15 ⇒ A +10/+100%, B −5/−25%,
A passou à frente de B), seção com agregada só numa eleição, seção sem cobertura, candidatura
ausente, zero real, troca de cargo, mesmo número em municípios diferentes, vice/suplente, fora da urna,
sem vínculo, limite de 5, idempotência e privacidade dos importadores, substituição de candidatura
(inserida na urna; substituída depois da carga das urnas, com veto pelo nome de urna), evolução com a
candidatura anterior da mesma disputa e base nomeada dos percentuais (candidatura, importado, recorte).

### 7.5 Idempotência do vínculo votável → candidatura

O lote de vínculo é identificado por `scope->>'inputs_fingerprint'`: SHA-256 do conteúdo que decide o
vínculo — votáveis do escopo (id, CD_ELEICAO, cargo, número, nome de urna, município), candidaturas
casáveis (disputa, número, nome de urna), sinalizadores do complementar oficial mais recente ("inserido
na urna", "substituída"), `LINK_RULES` e `LINK_INPUTS_VERSION`. Os lotes de candidaturas e do
complementar usados ficam em `scope->'inputs'` como proveniência.

- Mesmas entradas ⇒ `already_imported`. Qualquer entrada nova ⇒ lote novo, que só acrescenta vínculos;
  um vínculo existente que passasse a apontar outra candidatura falha fechado (`CandidatesError`).
- Regressão coberta (`test_complement_imported_after_the_first_link_creates_a_new_link_batch`): na carga
  real de 2024 o primeiro vínculo deixou 69 votáveis ambíguos (12.079/12.148); o complementar oficial
  chegou depois (68 "inserido na urna" + 1 substituição ⇒ 12.148/12.148), mas a chave antiga
  (lote de candidaturas + regra) respondia `already_imported` e o índice único impedia um lote novo.
- Escopo arquivado no lake (fatos de voto podados do Postgres): os votáveis vêm do agregado persistente
  auditado `electoral_archive.votable_zone_votes` (`scope->>'archived_scope' = true`), nunca de um
  "zero votáveis" falso.
- A migration 013 inclui a impressão digital no índice único; o rollback falha (não apaga lotes) se já
  houver lotes que só ela distingue.

## 10. Limites conhecidos

- Eleições suplementares (CE: Senador Sá 2025/2026, Santa Quitéria 2025, Choró 2026, Potiretama 2026)
  não são modeladas: o modelo `election(ano, turno)` não comporta duas eleições no mesmo ano/turno.
- 2026: 1º turno importado; o 2º turno de 2026 ocorre em 25/10/2026.
- Presidente (disputa nacional): só os votos das UFs importadas (CE); o Raio X não mostra votação
  nacional nem posição na disputa nacional, e os percentuais dizem "com Boletim de Urna importado".
- Prestação de contas de 2026 ainda é parcial (campanha recém-encerrada); o envio de maior prioridade vale.
- Propostas de governo e certidões criminais (PDFs por candidato, ZIPs por UF) não são importadas; a aba
  Registros indica o DivulgaCandContas (TSE), onde são publicadas, com os dados para localizar a candidatura
  (sem link profundo: o formato da URL não pôde ser conferido na fonte, cujo CDN bloqueia acesso automatizado).
- Portal da Transparência exige chave de API (cadastro gov.br) e só cruza por CPF/CNPJ ou nome; o
  REP Brasil não guarda CPF e não liga por nome ⇒ não integrado.
- Senado não publica CPF nem SQ_CANDIDATO: os senadores não são ligados automaticamente às candidaturas.
- Candidaturas sem votável no BU (indeferidas, renúncias, fora da urna) ficam sem vínculo e aparecem
  com o estado oficial, nunca com zero (ex.: 2024, Vereador: 11.673 de 12.223 candidaturas com votável).
- A importação do BU faz uma ida e volta ao banco por seção × cargo: o 1º turno de 2022 levou ~100 min
  nesta máquina. É idempotente e retomável; carga em lote (`COPY`) é melhoria futura, não requisito.
- Fora da aba Raio X: o cabeçalho do perfil (cargo, partido, "candidaturas", "eleições", patrimônio)
  continua vindo das tabelas anteriores do perfil, não das candidaturas do Raio X, e os nomes de
  município gravados pelo importador de território mantêm partículas maiúsculas ("Juazeiro Do Norte").
