# Apuração ao vivo — 2º turno presidencial 2026

Página: `/apuracao/2026/presidente/segundo-turno` (`/apuracao` redireciona para ela).
API: `/api/v1/elections/2026/president/second-round/*`.
Desligada por padrão: `ELECTION_LIVE_ENABLED=true` liga.

O REPBrasil **não prevê** resultado. A página mostra:
- os números oficiais do TSE;
- estatística descritiva (agregações por somas absolutas, velocidade de chegada dos dados);
- uma verificação matemática conservadora.

A definição da eleição é sempre a do TSE (`md = "e"`); a situação oficial publicada pelo TSE sempre prevalece.

## Fluxo de dados

```text
TSE (resultados.tse.jus.br, CDN)
  │  só a réplica líder lê (advisory lock no PostgreSQL); GET condicional; ≤ 20 req/s (teto rígido 80)
  ▼
LiveIngestionEngine (BackgroundService dentro da API .NET)
  │  parser tolerante → snapshot normalizado imutável → eventos (troca de liderança, md=e, tf=s…)
  ├──► PostgreSQL (schema electoral, tabelas live_*): snapshots deduplicados por hash, eventos imutáveis, ETags
  ▼
LiveElectionHub (memória): estado imutável trocado atomicamente; projeções calculadas 1× por versão
  │
  ├──► REST  /summary /states … (JSON pronto em cache, ETag, Cache-Control curto)
  └──► SSE   /stream (uma serialização por evento para todas as conexões; Last-Event-ID; heartbeat 15 s)
              ▼
            Next.js: HTML com o placar já renderizado (ISR 5 s) + store por fatias (useSyncExternalStore)
```

Regra absoluta: **o navegador nunca consulta o TSE.** Mil ou dez mil visitantes geram as mesmas requisições ao TSE.
O total de requisições aparece em `/health` (`tseRequests`) e é verificado pelo teste de carga.

A exceção é o pedido explícito de detalhe de um município, zona ou 1º turno municipal:
- passa pela mesma fila;
- respeita o mesmo limite e o mesmo cache do servidor;
- é deduplicado por município (single-flight).

### Sem Redis em produção

O Railway do REPBrasil não tem Redis. A coordenação usa o PostgreSQL existente.

| Função | Mecanismo |
|---|---|
| Poller único entre réplicas | `pg_try_advisory_lock` numa conexão dedicada; caiu a conexão, caiu a liderança |
| Aviso às réplicas seguidoras | `NOTIFY repbrasil_live_election` → seguidoras recarregam o estado do banco |
| Estado atual | memória da réplica (troca atômica) + PostgreSQL (reidratação em reinício/deploy) |
| ETag / Last-Modified | memória + `electoral.live_source_state` |
| Limite de requisições ao TSE | ritmo uniforme na própria réplica líder (só ela lê o TSE) |

**Banco fora do ar** não para a apuração. A réplica segue em memória, registra alerta e volta a disputar o lock a cada 30 s.
A eleição é registrada no banco assim que ele voltar.

Os snapshots e eventos do período sem banco ficam só em memória: os eventos ganham id negativo e o alerta registra a lacuna.

## Fontes oficiais do TSE

Documentação: <https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados> (aba Documentos).

| Arquivo | Caminho (oficial) | Uso |
|---|---|---|
| EA11 configuração | `/oficial/comum/config/ele-c.json` | descobre ciclo, pleito, eleição do 2º turno (cargo 1 em `br`, turno 2), 1º turno (`cdt2`) e os **templates de diretório** (`arq`) |
| EA12 municípios | `…/<cd_eleicao>/config/mun-e<eleição 6 díg.>-cm.json` | códigos TSE (5 dígitos) e IBGE, capitais (`c = s`), zonas (4 dígitos) |
| EA14 acompanhamento BR | `…/dados/br/br-e<eleição>-ab.json` | `dt/ht`, seções e eleitorado por UF → quais UFs buscar; "onde estão os votos restantes" |
| EA15 acompanhamento UF | `…/dados/<uf>/<uf>-e<eleição>-ab.json` | `dt/ht` por município → quais municípios buscar; eleitorado municipal |
| EA20 resultado | `…/dados/<uf>/<prefixo>-c0001-e<eleição>-u.json` | nacional (`br`), UF (`sp`), município (`sp71072`), zona (`sp71072-z0001`) |
| Fotos | `…/<cd_eleicao>/fotos/br/<sqcand>.jpeg` | foto oficial, baixada **uma vez** e servida com cache de 1 dia |

Códigos oficiais de 2026, validados pelo EA11 e não fixos no código:
- **2º turno:** pleito 3221, eleição federal 6258;
- **1º turno:** 6257;
- **simulado do 2º turno:** `resultados-sim.tse.jus.br/simulado`, ambiente `simulado2026`, eleição 22410.

Divergência entre o esperado (`ELECTION_EXPECTED_CODE`) e o EA11 vira alerta operacional, e vale o EA11.

`TsePathBuilder` é o **único** lugar que monta URL.
- **Preenchimento:** eleição com 6 dígitos, cargo com 4, município com 5 e zona com 4.
- **Sem palpite:** nunca completa um código. Município e zona vêm do EA12 já no tamanho certo.
- **Hosts:** só os do TSE são aceitos.

Não existe descoberta por tentativa e erro.

### Formato real (2026)

- Todo número vem como **texto** ("158745502").
- Percentuais usam **vírgula**: `pvap` "47,03" e `pvapn` "47,027772356"; "100" e "0" vêm sem casas.
- Data e hora vêm separadas (`dg` + `hg`, `dt` + `ht`) e ficam vazias ("") antes do início.
- Horário de Brasília com deslocamento fixo de −03:00, sem horário de verão desde 2019.

O parser (`TseParser`):
- aceita número ou texto e vírgula ou ponto;
- vazio ou ausente vira `null`, nunca zero;
- valor impossível (negativo, `seq` repetido, `and` fora do contrato) vira erro de contrato: o arquivo é rejeitado, o alerta é registrado e o último snapshot válido continua no ar.

**Invariantes verificados**, que valem exatamente nos arquivos reais do 1º turno e do simulado:
- seções: `ts = st + snt`, `st = si + sni`, `si = sa + sna`;
- eleitorado: `te = est + esnt`, `est = esi + esni`, `esi = esa + esna` e `esi = c + a`;
- votos: `tv = vb + vn + vnt + van + vansj + vv`, `vvc = vv + van + vansj`, `Σ vap = vvc` e `tvn = vn + vnt`.

**Divergência nos invariantes:**
- o dado oficial é aceito (o TSE é a origem);
- um alerta é registrado;
- o veredito matemático independente fica suspenso.

### Atenção: EA15 defasado

No pré-eleição, o EA15 do Ceará (`dg` 10/10) trazia 4,47 milhões de eleitores, contra 6,99 milhões do EA14 e do EA20. Por isso:
- o ranking de maiores eleitorados usa o EA20 do município quando ele já foi recebido;
- capitais e maiores eleitorados são renovados também por tempo (60 s) enquanto a UF apura (pelo EA14);
- resultado municipal com mais de 10 min, numa UF ainda em apuração, conta como **defasado** na cobertura.

## Ingestão (ciclos)

| Ciclo | Intervalo | Prioridade | Observação |
|---|---|---|---|
| EA20 nacional | 1 s com a totalização em curso; 15 s antes e depois (2 s nos 10 min antes das 17h) | crítica | `ELECTION_POLL_INTERVAL`, `ELECTION_IDLE_POLL_INTERVAL` |
| EA14 | 3 s (repouso antes das 17h) | crítica | busca o EA20 só da UF cujo `dt/ht`, seções ou andamento mudaram |
| EA15 | uma UF por vez; a volta completa leva 30 s | fundo | enfileira municípios cujo `dt/ht` mudou |
| Municípios | fila prioritária + fila de fundo | normal/fundo | prioridade: pedido de visitante → capitais → maiores eleitorados → UF aberta por visitantes → demais |
| Zonas | só sob demanda | normal | lista oficial de zonas do EA12 |
| 1º turno | uma vez (nacional + 28 UFs); município sob demanda | fundo | base estática, cache permanente |

### Limites e falhas

- **Ritmo:** uniforme, sem rajadas: 20 req/s no total e 8 req/s para a varredura de fundo, com teto rígido de 80.
- **Limite oficial e 304:** o TSE limita a 100 req/s por IP e bloqueia por 10 min, renovando o bloqueio se houver nova tentativa. **304 também conta**, por isso passa pelo mesmo ritmo.
- **403 ou 429:** pausa total de 11 min (`BlockPause`) e alerta.
- **404:** nunca é repetido em laço. A URL fica em espera de 60 s. Com 20 ou mais 404 em 5 min, a varredura de fundo pausa por 10 min e gera alerta.
- **5xx e tempo esgotado (8 s):**
  - recuo exponencial com jitter por URL (1 s a 60 s);
  - disjuntor global após 8 falhas seguidas (30 s);
  - erro determinístico (contrato) não é repetido.
- **Fonte falhando (3 falhas seguidas no nacional) ou sem arquivo novo por 5 min durante a apuração:**
  - a fase vira `LIVE_STALE`;
  - o último snapshot continua no ar;
  - a página mostra "Última atualização oficial recebida às HH:mm. Aguardando nova atualização da fonte.";
  - ao voltar, é publicado `source-recovered`.

### Deduplicação

- **Hash de conteúdo:** o snapshot só é gravado quando o hash muda. O hash cobre votos, totais, indicadores (`and`, `tf`, `md`, `dv`, `mntf`, `esae`) e a situação/destinação dos candidatos. **Não** cobre `idg`, `dg`/`hg` nem `dt`/`ht`: regenerar o mesmo resultado não cria snapshot.
- **`idg`:** guardado só como identidade do arquivo. O TSE confirma que ele não é contador global.

## Modelo de dados (migration `AddLiveElection`, script `020_live_election.sql`)

| Tabela | Conteúdo |
|---|---|
| `live_election` | uma linha por modo + ambiente + eleição (oficial, simulado e cada sessão de replay nunca se misturam) |
| `live_snapshot` | snapshots `br` e `uf` normalizados + JSON oficial bruto; único por hash de conteúdo; **imutável** (trigger) |
| `live_territory_latest` | último resultado de cada município/zona (alta cardinalidade, sem histórico completo) |
| `live_event` | trilha de auditoria (troca de liderança, `md=e`, `tf=s`, reprocessamento, correção, alertas internos); idempotente por chave; **imutável** |
| `live_source_state` | ETag/Last-Modified por URL |
| `live_candidate_photo` | foto oficial (bytea), uma por `sqcand` |

**Volume esperado:**
- um snapshot nacional por mudança real (centenas na noite);
- UFs: 28 × centenas;
- municípios: 5.571 linhas sobrescritas.

**Auditoria do `md=e`:** o evento `md-e` guarda:
- horário do TSE (`dt`/`ht`) e horário de recebimento;
- `idg`;
- líder, votos, vantagem e % de seções;
- eleitorado restante;
- hashes do arquivo;
- o snapshot integral (o `snapshot_id` aponta para o JSON oficial bruto).

Assim dá para responder "em qual segundo o TSE definiu matematicamente e com quais números".

## Matemática

### Nível 1 — validador independente do REPBrasil (conservador, só inteiros)

```text
remaining = esnt + esna        (= te − esa − esni, conferido; divergência suspende o veredito)
lead      = votosLíder − votosSegundo
irreversível  ⇔  votosLíder > votosSegundo + remaining      (estritamente maior: igualdade ainda admite empate)
safetyMargin                   = lead − remaining
votesNeededForTrailingCandidate = lead + 1
maxPossibleTrailingCandidate   = votosSegundo + remaining
distanceToIrreversibility      = remaining − lead + 1      (enquanto não atingido)
```

O pior caso é suposto para o líder: todo eleitor ainda potencialmente apurável vota validamente no segundo.
- não há estimativa de comparecimento, brancos ou nulos;
- não há uso de histórico.

Testes:
- 60/40/30 → não definido;
- 80/40/30 → irreversível;
- 70/40/30 → não definido;
- 20 mil casos aleatórios (propriedade).

**Antes do `md=e`:**
- o limite atingido aparece **só** na área técnica (Super Admin: `GET /api/v1/admin/live-election/math`), com o texto "Limite matemático independente do REPBrasil atingido; aguardando sinal oficial md=e.";
- a página pública não anuncia nada: a distância sai `null` e o card diz "A definição matemática é sinalizada oficialmente pelo TSE.";
- o REPBrasil guarda `repBrasilMathDetectedAt` e `tseMathDefinedAt` e calcula a diferença.

### Nível 2 — sinal oficial

**`md = "e"` com `tf = "n"`:**
- fase `MATHEMATICALLY_DEFINED`;
- banner "ELEIÇÃO MATEMATICAMENTE DEFINIDA" com as frases oficiais da especificação;
- evento persistente, idempotente e distribuído por SSE.

**`tf = "s"`:** fase `FINAL`. A página mostra "RESULTADO FINAL", reflete a situação oficial (`e`/`st`) e retira o "AO VIVO".

São estados distintos: `md=e` convive com `tf=n`.

## Estados (máquina única)

Precedência, de cima para baixo:

| Fase | Condição |
|---|---|
| `SOURCE_ERROR` | sem nenhum snapshot e fonte falhando |
| `PRE_ELECTION` | sem snapshot, ou `and = n` antes das 17h (Brasília) do dia da eleição |
| `FINAL` | `tf = s` |
| `MATHEMATICALLY_DEFINED` | `md = e` |
| `WAITING_FOR_RELEASE` | `and = n` depois das 17h, ou `dv = n` |
| `FINALIZING` | 100% das seções (`snt = 0`) sem totalização final |
| `LIVE_STALE` | fonte falhando ou sem arquivo novo há 5 min |
| `LIVE` | demais casos |

## API pública

Toda resposta vem como `{ data, meta }`.

A `meta` traz:
- `source`, `mode` e `phase`;
- `sourceGeneratedAt` (`dg`/`hg`) e `totalizedAt` (`dt`/`ht`), no horário de Brasília;
- `ingestedAt` e `publishedAt`, em UTC;
- `ageSeconds` e `sourceDelaySeconds`;
- `coverage` (`complete`, `partial` ou `stale`);
- `isFinal`, `isMathematicallyDefined` e `snapshotVersion`.

| Rota | Conteúdo |
|---|---|
| `GET /summary` | candidatos, totais nacionais, situação oficial, matemática pública, fonte, velocidade (1/5/15 min, ETA técnica), marcos |
| `GET /candidates` | candidatos descobertos no EA20 (nada fixo no código), foto, coligação, vice |
| `GET /states` | 27 UFs, exterior (ZZ), 5 regiões (somas absolutas), votos restantes por UF, resumo territorial (municípios só com cobertura completa) |
| `GET /states/{uf}` | UF + capital + interior (UF − capital) + evolução + 1º turno |
| `GET /states/{uf}/municipalities` | lista da UF (EA12 + EA15) com o resultado de quem já foi recebido |
| `GET /municipalities/{tse5}` | detalhe (busca sob demanda) + zonas + 1º turno |
| `GET /municipalities/{tse5}/zones` | zonas sob demanda |
| `GET /capitals`, `GET /largest-municipalities?limit=20\|50\|100` | rankings |
| `GET /timeline?scope=br\|uf&code=` | pontos da apuração e trocas de liderança |
| `GET /mathematical-status` | matemática pública |
| `GET /comparison/first-round?scope=br\|region\|uf\|mu&code=` | "variação em relação ao 1º turno" (nunca "transferência de votos") |
| `GET /health` | saúde pública (sem dado sensível) + `tseRequests` |
| `GET /photos/{sqcand}` | foto oficial (só candidatos desta eleição) |
| `POST /events` | evento anônimo de produto (`election_page_view`, `state_open`…; sem identificador e sem preferência eleitoral) |
| `GET /stream` | SSE (abaixo) |

**Internas (Super Admin):**
- `GET /api/v1/admin/live-election/health`: líder, ETag, Postgres, SSE, contadores, alertas;
- `GET /api/v1/admin/live-election/math`;
- `POST /api/v1/admin/live-election/replay/restart`.

**Cache HTTP** (o estado já é servido da memória):
- **Ao vivo:** `public, max-age=2` com ETag por versão; nunca preso em CDN antiga.
- **Fotos:** 1 dia, `immutable`.
- **Candidatos:** 30 s.
- **HTML da página:** ISR de 5 s. O cliente relê `/summary` ao hidratar.

### SSE

- **Eventos:** `snapshot` (o primeiro de cada conexão), `national-update`, `state-update`, `candidate-update`, `lead-change`, `mathematically-defined`, `finalized`, `source-stale`, `source-recovered` e `timeline-event`.
- **Ids:** cada evento tem id `boot:seq`.
- **Reconexão com `Last-Event-ID`** desta instância ainda no buffer (512 eventos): só os perdidos são reenviados. Fora disso, um `snapshot` completo é enviado.
- **No cliente:** ao reconectar ou voltar do segundo plano, ele relê `/summary` e `/states`. Nunca depende só de eventos perdidos.
- **Limites:**
  - 20.000 conexões por réplica;
  - 256 por IP, alto de propósito por causa do CGNAT das operadoras móveis;
  - conexão lenta (fila cheia) é fechada, e o cliente reconecta e recebe o snapshot.

## Modos

| `ELECTION_DATA_MODE` | Fonte | Fase aceita (`f`) |
|---|---|---|
| `official` (padrão) | `https://resultados.tse.jus.br` / `oficial` | `o` |
| `simulation` | `https://resultados-sim.tse.jus.br/simulado` / `simulado2026` | `s` |
| `replay` | cenário sintético (`SyntheticScenario`), host `replay.repbrasil.invalid`, **sem rede** | qualquer |

**O replay:**
- gera arquivos no formato exato do TSE: 27 UFs + exterior, 105 municípios fictícios, zonas e 1º turno;
- conta esta história: B à frente no começo, troca de liderança, limite do REPBrasil atingido, `md=e` dois quadros depois e totalização final;
- avança um quadro a cada `ELECTION_REPLAY_STEP ÷ ELECTION_REPLAY_SPEED` (1, 5, 10, 30; 0 = instantâneo);
- simula falha da fonte com `ELECTION_REPLAY_OUTAGE=30-36` (quadros);
- recebe uma linha própria em `live_election` a cada sessão;
- traz candidatos e municípios fictícios, sem foto;
- mostra o selo "REPLAY — dados de teste" na página.

### Configuração

| Variável | Padrão |
|---|---|
| `ELECTION_LIVE_ENABLED` | `false` |
| `ELECTION_DATA_MODE` | `official` |
| `ELECTION_POLL_INTERVAL` | `1s` (aceita `1500ms`, `2s`, `1000`) |
| `ELECTION_IDLE_POLL_INTERVAL` | `15s` |
| `ELECTION_UF_POLL_INTERVAL` | `3s` |
| `ELECTION_MUNICIPAL_SWEEP_INTERVAL` | `30s` (volta completa do EA15) |
| `ELECTION_MAX_RPS` / `ELECTION_BACKGROUND_RPS` | `20` / `8` (teto `80`) |
| `ELECTION_PRIORITY_MUNICIPALITIES` | `100` |
| `ELECTION_STALE_AFTER` | `5m` |
| `ELECTION_TOTALIZATION_START` | `17:00` |
| `ELECTION_EXPECTED_CODE` / `ELECTION_EXPECTED_PLEITO` / `ELECTION_EXPECTED_FIRST_ROUND_CODE` | `6258` / `3221` / `6257` (só para alerta) |
| `ELECTION_REPLAY_SPEED` / `ELECTION_REPLAY_STEP` / `ELECTION_REPLAY_OUTAGE` | `10` / `60s` / — |
| `ELECTION_SSE_MAX_CONNECTIONS` / `ELECTION_SSE_MAX_PER_IP` | `20000` / `256` |
| `RateLimit:LivePerMinute` | `6000` por IP nas rotas da apuração |

Nenhuma chave de API: os arquivos do TSE são públicos.

## Como rodar

```bash
# API em replay (sem banco: estado só em memória)
cd backend
ConnectionStrings__Postgres= ELECTION_LIVE_ENABLED=true ELECTION_DATA_MODE=replay ELECTION_REPLAY_SPEED=30 \
  PORT=5320 AllowedOrigins=http://localhost:3100 dotnet run --project src/RepBrasil.API --no-launch-profile

# Frontend
cd frontend
NEXT_PUBLIC_API_URL=http://localhost:5320 API_INTERNAL_URL=http://localhost:5320 npx next dev -p 3100
# → http://localhost:3100/apuracao/2026/presidente/segundo-turno
```

Testes:

```bash
cd backend && dotnet test --filter "FullyQualifiedName~LiveElection"   # unidade (+ banco com REPBRASIL_ELECTORAL_TEST_DB)
cd frontend && npm test
# E2E (16 passos; Playwright 1.55 como no CI), com a API em replay a 30x e ELECTION_REPLAY_OUTAGE=30-36:
REPBRASIL_WEB_URL=http://localhost:3100 REPBRASIL_API_URL=http://localhost:5320 node .github/scripts/live-election-e2e.mjs
# Carga SSE (API com ELECTION_SSE_MAX_PER_IP alto, porque todas as conexões saem do mesmo IP):
node scripts/load/live-election-sse.mjs --api http://localhost:5320 --clients 5000 --seconds 60
```

## Ativação em produção (Railway, serviço `back-v2`)

1. **Deploy** desta versão. A migration `AddLiveElection` é aplicada na partida (`MigrateOnStartup=true`).
2. **Variáveis:**
   - definir `ELECTION_LIVE_ENABLED=true`;
   - `ELECTION_DATA_MODE=official` já é o padrão;
   - o resto fica no padrão.
3. **Conferir:**
   - `GET /api/v1/elections/2026/president/second-round/health`;
   - Super Admin → `GET /api/v1/admin/live-election/health`: eleição 6258 descoberta, `pollerLeader` preenchido, sem alertas.
4. **Na página:**
   - antes das 17h ela mostra "Totalização ainda não iniciada";
   - a partir das 17h, o ciclo nacional encurta sozinho.

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `503` em todas as rotas da apuração | EA11 ainda não lido (sessão recomeçando com recuo) | ver `lastSessionError` no health do Super Admin |
| Fase `LIVE_STALE` | TSE sem arquivo novo há 5 min, ou falhas seguidas | health interno → `source`; pode ser só a cadência do TSE |
| Alerta `tse_blocked` | 403/429 do TSE | **não** reiniciar em laço: a pausa de 11 min evita renovar o bloqueio; reduzir `ELECTION_MAX_RPS` |
| Alerta `tse_404_burst` | URLs inexistentes (ex.: código fora do EA12) | conferir o EA12 da eleição; a varredura de fundo já pausou |
| Alerta `postgres` | banco indisponível | a apuração segue em memória; investigar o `postgis18` |
| Alerta `contract` | arquivo fora do leiaute | ver o evento `contract-error`; o último snapshot válido continua no ar |
| Municípios com resultado defasado | EA15 desatualizado no TSE | capitais e maiores eleitorados renovam por tempo; detalhe sob demanda usa TTL de 20 s |
