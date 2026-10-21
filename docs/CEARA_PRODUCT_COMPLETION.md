# REPBrasil Ceará — Product Complete (roadmap vivo)

Escopo geográfico ativo: **Ceará** (UF 23 / TSE CE). Eleições ativas: **2022, 2024, 2026**. Toda a
arquitetura é multi-UF e temporalmente genérica; o Ceará é só o dataset carregado nesta fase. Ao concluir,
a próxima missão é **Nordeste** — nenhuma expansão automática.

## Status

| Status | Significado |
|---|---|
| `DONE` | Em produção e validado; nada depende mais do Elias. |
| `READY FOR HUMAN SMOKE` | Em produção, com os gates automáticos aplicáveis verdes; falta somente o smoke humano ([`CEARA_HUMAN_SMOKE.md`](CEARA_HUMAN_SMOKE.md)). |
| `AUTOMATED GATES GREEN` | Código em PR aberto com CI e Sonar verdes; faltam auditoria, merge, deploy e, depois, o smoke humano. |
| `CODE COMPLETE` | Código e testes prontos; falta uma operação explícita (ingestão/captura) ou um PR do fechamento antes do smoke humano. |
| `BLOCKED` | Depende de decisão ou credencial externa. |

Só o Elias promove um item a `DONE`, depois do smoke humano. Nenhum status abaixo se apoia em
evidência simulada.

## Ambiente atual (20/10/2026)

| Item | Situação verificada |
|---|---|
| `main` | `904e079` (merge do #46). #38–#47 mergeados em 20/10/2026, com merge commit. |
| Produção | `front-v2`, `back-v2` e `electoral-etl-ce2026` em `904e079` (`x-repbrasil-revision` no front e na API). |
| Smoke automático de produção | Verde nos merges de #40 a #43; vermelho no merge do #44 (seletor ambíguo e log injection no próprio smoke ampliado), corrigido no #45; verde em todos os merges seguintes. Run `39402516266` (merge do #46): 44/44 checagens, sem execução local. |
| Sonar da `main` | Quality gate OK; Security, Reliability e Maintainability A; hotspots 100% revisados. Issues aceitas: 0; `NOSONAR`: 0; `FALSE_POSITIVE`: 10 ocorrências de `pythonsecurity:S8707` em ferramentas de linha de comando do ETL, marcadas em 10/10/2026 (antes do fechamento), com justificativa registrada no Sonar. |
| Parlamento | Carga CE / 57ª em 20/10/2026 (02:31:20–02:32:44 UTC, exit 0): 36 edições, 34 deputados federais (`unlinked`), 8.764 atos, 2.927 emendas (1.302 com município IBGE oficial, em 176 municípios; 1.625 só com a UF), anos 2015–2026. Só as quatro tabelas `parliament_*` mudaram. |
| Pesquisas / apuração | 53 pesquisas de Governador/CE e 48 de Senador/CE 2026 (registro idempotente a cada deploy do ETL). Nenhum snapshot oficial de apuração capturado: a captura é operação explícita e não está autorizada. |
| Conta / comercial | Google OAuth e magic link em produção. O magic link usa a API HTTPS do Resend (#47), porque o Railway bloqueia SMTP de saída fora do plano Pro, o que travava o pedido no smoke humano. Variáveis conferidas só pelo nome. O ciclo de credenciais da API comercial (criar, usar e revogar uma API key real) está `READY FOR HUMAN SMOKE`. |
| Lake eleitoral | RPC privado em TLS vinculado ao token (#39); seções arquivadas de 2022 e 2024 servidas pelo lake (item 11 do smoke humano). |
| Smoke humano | 20/10/2026: **13/13 OK**, com os itens 2, 3 e 8 refeitos depois do #47 e do #46. Regressão final 16/16; `back-v2` com 0 erros e 0 respostas 5xx nas 120 requisições observadas (ver "Smoke humano (20/10/2026)"). |
| Custo novo | Nenhum serviço pago novo. |

## Ambiente no início do fechamento (13/10/2026)

| Item | Situação verificada |
|---|---|
| `main` | `6c4832d` (merge do #37). Nenhum PR do fechamento (#38–#44) foi mergeado. |
| Produção | `front-v2` e `back-v2` respondem `x-repbrasil-revision: 6c4832d0ccc3b8fe51c8254c6c713479556a8ff0`. |
| Smoke automático de produção | Nenhuma das três execuções na `main` passou. As duas primeiras (merges de #35 e #36) falharam em asserções de renderização de `/dados`, corrigidas no #37. A terceira (run `38332964285`, merge do #37) passou revisão, APIs, headers e capturas desktop e parou na etapa offline (`waitFor("Você está sem conexão")`, 15 s): a emulação offline do Playwright não alcança o `fetch` do service worker, e o SW tinha fragilidades reais. Correção: #40. |
| Sonar da `main` | Security C em código novo por `pythonsecurity:S8707` (argumentos de CLI gravados em arquivo pelo importador estadual); `python:S5332` (RPC do lake em texto claro) sozinho manteria B. Correções: #38 e #39. |
| Parlamento | `members`, `activities`, `amendments` e `amendments/map` (`uf=CE`) respondem 200 com **0 linhas**: nenhuma ingestão operacional foi feita. |
| Pesquisas / apuração | 53 pesquisas registradas para Governador/CE 2026; nenhum snapshot oficial de apuração capturado (`snapshot: null`, ausência exibida). O JSON oficial final do TSE (gerado em 04/10/2026 23:11:32) indica Governador/CE decidido no 1º turno. |
| Conta / comercial | Google OAuth configurado (o início do login redireciona ao Google com `state` aleatório e cookie de correlação `HttpOnly`/`Secure`/`SameSite=Lax`); variáveis de SMTP e `Auth__SuperadminEmails` presentes no `back-v2` (só nomes conferidos). O ping comercial com chave desconhecida responde **500** em produção — corrigido no #41, com outros dois 500 de auth. |
| Lake eleitoral | Votos de seção de 2022 e 2024 (CE) vêm do worker do lake: cada leitura gera um `POST /v1/result-votes` no log do `electoral-etl-ce2026`. Hoje o RPC é HTTP na rede privada; #39 passa para TLS vinculado ao token. |
| Custo novo | Nenhum serviço pago novo. |

## PRs mergeados

| PR | Conteúdo | Status | PR | SHA | Produção |
|---|---|---|---|---|---|
| B | Vínculo votável → candidatura idempotente pelo conteúdo das entradas; vínculo de escopo arquivado; lake com token e 503 "indisponível"; guardas do PR #4 no loader estadual | DONE | [#16](https://github.com/eliasandraade/REPBrasil/pull/16) | `128d98b` | validado |
| A | Brand Kit, busca, segurança HTTP, SEO, nomes oficiais, home com cobertura real | DONE | [#17](https://github.com/eliasandraade/REPBrasil/pull/17) | `5f0d1f2` | validado |
| C | Base Eleitoral + rankings determinísticos e guardas de comparabilidade | DONE | [#18](https://github.com/eliasandraade/REPBrasil/pull/18) | `561187a` | validado |
| D | Partidos e força partidária (sigla oficial, BU, variação comparável, municípios, candidaturas, camada Partido, `/partidos`) | DONE | [#19](https://github.com/eliasandraade/REPBrasil/pull/19) | `f86be3e` | validado |
| E | Data Intelligence: socioeconomia, proveniência, SIDRA/Atlas, Pearson/Spearman, `candidacy_share`, clusters e `/dados`; seguido pela primeira ingestão Censo 2022 e perfil socioeleitoral | DONE | [#20](https://github.com/eliasandraade/REPBrasil/pull/20), [#21](https://github.com/eliasandraade/REPBrasil/pull/21), [#22](https://github.com/eliasandraade/REPBrasil/pull/22) | `adde263` / `cc24a9f` / `a809e31` | validado |
| F | Fundação auditável de Parlamento + emendas: fontes, membros, mandatos, atividades, emendas, Câmara paginada, parser fail-closed e identidade sem heurística de nome | DONE | [#23](https://github.com/eliasandraade/REPBrasil/pull/23) | `a428c56` | migration e schema verificados |
| G | Busca por indicadores, comparador universal por tipo, insights determinísticos versionados e exports CSV/XLSX/PDF/PNG | DONE | [#24](https://github.com/eliasandraade/REPBrasil/pull/24) | `2a4f6bc` | smoke humano de 20/10: comparador (item 7) OK; exports (item 8) OK depois do #46, que levou a URL inteira ao PDF e ao PNG |
| H | Auth (Google + magic link), favoritos, watchlist, alertas, entitlements, API comercial + hardening de correlação/quota e superadmin | DONE; ciclo de credenciais da API comercial: READY FOR HUMAN SMOKE | [#31](https://github.com/eliasandraade/REPBrasil/pull/31), [#32](https://github.com/eliasandraade/REPBrasil/pull/32), [#33](https://github.com/eliasandraade/REPBrasil/pull/33), [#41](https://github.com/eliasandraade/REPBrasil/pull/41), [#47](https://github.com/eliasandraade/REPBrasil/pull/47) | `9072555` / `8d78877` / `a546a57` / `b8b897c` / `9de8b92` | smoke humano de 20/10: Google, magic link no mesmo e em outro navegador, conta/favoritos/saída e superadmin OK (itens 1–5; 2 e 3 depois do #47); criação, uso e revogação de uma API key real ainda fora do smoke humano |
| I | Município, estado, eleição, perfil unificado, SEO | DONE | [#25](https://github.com/eliasandraade/REPBrasil/pull/25) | `ec54967` | validado após correção de indicadores no #26 |
| J | Pesquisas eleitorais auditáveis + snapshots oficiais de apuração, estados não iniciado/parcial/final, `/pesquisas` | DONE (pesquisas); apuração: CODE COMPLETE | [#27](https://github.com/eliasandraade/REPBrasil/pull/27) | `e9d727d` | 53 registros de Governador/CE e 48 de Senador/CE 2026; smoke humano de 20/10 (item 6) OK, com ausência de apuração explícita; captura de apuração não autorizada |
| K | PWA factual-safe, mobile, segurança, performance, mapas socioeconômico/emendas, APIs e experiência parlamentar | DONE | [#34](https://github.com/eliasandraade/REPBrasil/pull/34) | `f02ea20` | PWA corrigido no #40, parlamento no #42/#43 + carga de 20/10; smoke humano de 20/10: parlamento, dados, celular e PWA offline OK (itens 9, 10, 12 e 13) |
| — | Workflow de smoke de produção e capturas | — | [#35](https://github.com/eliasandraade/REPBrasil/pull/35) | `0a2f6b8` | ativo; verde em todos os merges desde o #45 (antes, verde de #40 a #43 e vermelho no #44) |
| — | Correções Sonar após o smoke | — | [#36](https://github.com/eliasandraade/REPBrasil/pull/36) | `e4dd3e2` | — |
| — | Smoke de dados ciente da hidratação | — | [#37](https://github.com/eliasandraade/REPBrasil/pull/37) | `6c4832d` | — |

## Fechamento Ceará — PRs mergeados (20/10/2026)

| PR | Branch | Base | Conteúdo | Status |
|---|---|---|---|---|
| [#38](https://github.com/eliasandraade/REPBrasil/pull/38) | `fix/main-sonar-security` | `main` | taint S8707 do importador estadual e smells de confiabilidade do código novo da `main` | DONE — merge `469b614` |
| [#39](https://github.com/eliasandraade/REPBrasil/pull/39) | `fix/lake-rpc-tls` | #38 | RPC privado do lake em TLS vinculado ao token (S5332) | DONE — merge `f1d8562` |
| [#40](https://github.com/eliasandraade/REPBrasil/pull/40) | `fix/pwa-offline-production` | #39 | PWA factual-safe provado com corte real de rede; causa do smoke #3 | DONE — merge `30dd3cf` |
| [#41](https://github.com/eliasandraade/REPBrasil/pull/41) | `fix/auth-export-hardening` | #40 | três 500 de auth, recusas explicadas em `/entrar`, testes de fluxo de conta, CSV sem fórmula | DONE — merge `b8b897c` |
| [#42](https://github.com/eliasandraade/REPBrasil/pull/42) | `fix/parliament-identity-integrity` | #41 | fim do vínculo por nome Câmara↔TSE; edição vigente decidida em `parliament_source` (vazia = ausência oficial); recorte de UF pela edição, com as emendas só com UF; anos e total de atos por endpoints próprios; somas parciais sinalizadas; cenário PWA de troca de versão isolado | DONE — merge `b770716` |
| [#43](https://github.com/eliasandraade/REPBrasil/pull/43) | `feat/parliament-ce-ingestion` | #42 | ingestão auditável de parlamento por UF a partir das fontes oficiais; cada redirecionamento validado antes da requisição e download com teto rígido em streaming | DONE — merge `270c668` |
| [#44](https://github.com/eliasandraade/REPBrasil/pull/44) | `chore/ceara-final-evidence` | #43 | smoke de produção ampliado, documentação reconciliada e roteiro de smoke humano | DONE — merge `22d1a38` |
| [#45](https://github.com/eliasandraade/REPBrasil/pull/45) | `fix/production-smoke-final-checks` | `main` | seletor do aviso de recusa em `/entrar` e log injection (S5145) no smoke de produção | DONE — merge `30a9776` |
| [#47](https://github.com/eliasandraade/REPBrasil/pull/47) | `fix/magic-link-resend-https` | `main` | magic link pela API HTTPS do Resend, prazo de 10 s, 503 controlado, logs sem dados sensíveis (itens 2 e 3) | DONE — merge `9de8b92` |
| [#46](https://github.com/eliasandraade/REPBrasil/pull/46) | `fix/export-full-url` | `main` | URL reproduzível inteira no PDF e no PNG; CSV mantém o ponto decimal (item 8) | DONE — merge `904e079` |

Resultados de CI, Sonar e testes de cada PR estão na descrição do PR.

**Ingestão parlamentar real em banco descartável** (13/10/2026, migrations do zero, código do #43;
nada em produção): 34 deputados federais do CE (todos `unlinked`), 8.757 atos, 2.927 emendas no
recorte CE (1.302 com município IBGE oficial, em 176 municípios; 1.625 publicadas só com a UF),
anos 2015–2026. Pela API local: `/amendments?uf=CE` inclui as emendas só com UF; `/amendments/map`
agrega só as 1.302 com município; `/activities/count` devolve 8.757 enquanto a listagem traz 100;
uma edição vigente vazia (simulada só nesse banco) esvazia `/amendments`, o mapa e os anos sem
apagar as 2.927 linhas da edição anterior.

**Carga parlamentar em produção** (20/10/2026, 02:31:20–02:32:44 UTC, uma execução, exit 0): 34
deputados, 8.764 atos (o banco descartável de 13/10 tinha 8.757), 2.927 emendas (1.302 com
município em 176 municípios; 1.625 só com a UF), anos 2015–2026;
edições `deputados` `c8e17dc5…` e `emendas-parlamentares` `669d4524…` (SHA-256 dos bytes oficiais).

## Ordem de merge e operações

Executada em 20/10/2026: merges #38 → #44 e, depois, #45, #47 e #46; carga parlamentar CE / 57ª
feita; apuração oficial não capturada (nenhuma captura autorizada). Os passos abaixo ficam como
registro.

1. Auditoria e merge na ordem #38 → #39 → #40 → #41 → #42 → #43 → #44, com **merge commit** (não
   squash: os PRs são empilhados). Depois de cada merge, a base do PR seguinte passa a ser `main` (o
   GitHub troca sozinho quando a branch mesclada é apagada; senão, editar a base).
2. Cada merge dispara o deploy no Railway e o workflow "Production smoke". As execuções dos merges
   de #38 e #39 ainda usam o smoke antigo e devem falhar na etapa offline, como o smoke #3; a
   primeira que deve passar é a do merge do #40. A do merge do #44 é a evidência final.
3. O #39 muda o protocolo do lake nos dois lados: até `back-v2` e `electoral-etl-ce2026` terminarem
   o deploy, leituras de seção arquivada respondem 503 "indisponível" (fail-closed, sem perda de
   dado). Opcional depois: trocar `ElectoralLake__BaseUrl` para `https://…` e eliminar o aviso de
   log (o código já promove `http://`).
4. Operações explícitas, no serviço `electoral-etl-ce2026` (`railway ssh --service
   electoral-etl-ce2026`, que usa o `DATABASE_URL` do próprio serviço). Gravam somente dados
   oficiais, com proveniência, e nunca rodam no deploy:
   - parlamento, depois do merge do #43: `python scripts/ingest_parliament.py --uf CE --legislature 57`;
   - apuração oficial do 1º turno de 2026 (final no TSE): `python scripts/ingest_live_results.py
     --year 2026 --round 1 --office 3 --uf CE` (Governador) e, se desejado, `--office 1` (Presidente,
     recorte CE) e `--office 5` (Senador); para o 2º turno de 25/10/2026, onde houver,
     `--round 2 --watch-seconds 30 --until-final`.
5. Smoke humano: [`CEARA_HUMAN_SMOKE.md`](CEARA_HUMAN_SMOKE.md).
6. Selo Ceará: o Elias atualiza este documento para `DONE`, item a item.

## Checklist — produto (Ceará)

| Item | Status |
|---|---|
| Eleições 2022 / 2024 / 2026 (dados, explorador, Raio X) | DONE |
| Arquitetura híbrida PostGIS + lake Parquet | DONE; RPC do lake em TLS (#39), seções arquivadas conferidas no item 11 |
| Vínculo do BU idempotente por conteúdo | DONE (#16) |
| Base Eleitoral | DONE (#18) — `docs/ELECTORAL_BASE.md` |
| Rankings | DONE (#18) — `docs/ELECTORAL_BASE.md` §2 |
| Partidos / força partidária | DONE (#19) — `docs/PARTY_INTELLIGENCE.md` |
| Data Intelligence / correlações / clusters | DONE (#20, item 10) — `docs/DATA_INTELLIGENCE.md`; simplificação de `/dados` para o usuário médio registrada como iniciativa separada |
| Primeira carga socioeleitoral oficial | DONE (#21/#22) — Censo 2022, 184 municípios do Ceará |
| Perfil socioeleitoral | DONE (#21) — Pearson, Spearman, N, scatter, quintis e caveat de falácia ecológica |
| Fundação parlamentar auditável | DONE (#23) — schema, proveniência, Câmara e emendas |
| Mapas temáticos | DONE — base/partido; socioeconômico (#34, item 10); emendas (#42/#43 + carga de 20/10, item 9) |
| Atividade parlamentar e emendas | DONE — #34, #42 e #43 + carga CE / 57ª de 20/10/2026; identidade documental (34 `unlinked`), edição vigente, recorte pela UF oficial, total de atos e anos por endpoints próprios, somas parciais sinalizadas (item 9) |
| Comparador universal | DONE (#24, item 7) — candidaturas, partidos, municípios e eleições; até cinco itens do mesmo tipo |
| Insights determinísticos | DONE (#24, item 7) — regras versionadas, sem LLM factual em runtime; conferidos no comparador |
| Exports (CSV, XLSX, PDF, PNG) | DONE (#24, #41, #46; item 8) — contexto, fontes, metodologia, timestamp e URL reproduzível inteira nos quatro formatos; CSV sem fórmulas e com ponto decimal (uso programático; o XLSX traz números nativos) |
| Busca por indicadores | DONE (#24) — catálogo oficial do Data Intelligence integrado à busca agrupada |
| Município / estado / eleição como entidades | DONE (#25/#26) — perfis canônicos, SEO, sitemap, timeline, rankings e Data Intelligence |
| Pesquisas eleitorais | DONE (#27, item 6) — 53 registros de Governador/CE 2026; percentuais só quando publicados por fonte auditada |
| Apuração oficial | CODE COMPLETE (#27) — snapshots oficiais TSE com `not_started`/`partial`/`final`; ausência exibida corretamente (item 6); nenhuma captura em produção: operação explícita, sem autorização de captura |
| Auth / favoritos / watchlist / alertas | DONE (#31–#33, #41, #47; itens 1–4) — Google e magic link (Resend HTTPS) com correlação de navegador; favoritos e saída conferidos; watchlist e alertas cobertos pelos testes de fluxo de conta contra o banco (envio de alertas por e-mail não implementado, documentado) |
| Superadmin | DONE (#41, item 5) — gate explícito: 200 superadmin, 403 conta comum, 401 anônimo |
| Entitlements / API comercial | READY FOR HUMAN SMOKE (#41) — infraestrutura implantada e validada por testes automatizados (401/403/429 explícitos, quota diária por conta, contratos anônimos no smoke de produção); a criação, o uso e a revogação de uma API key real ainda não entraram no smoke humano. Não bloqueia o selo Ceará |
| PWA / offline seguro | DONE (#40, item 13) — aviso com a página aberta, fallback sem dado factual ao navegar/recarregar sem rede, volta ao reconectar |
| Mobile / hardening de produção | DONE (#34, item 12) — seis páginas em pé sem rolagem lateral; menu, seletores e mapas utilizáveis |

## Checklist — dados, infra, qualidade

| Item | Status |
|---|---|
| Proveniência de todo dataset novo | DONE para Data Intelligence, Parlamento e PR J; #43 grava URL final, SHA-256, instante, versão do parser e contagens em cada edição parlamentar |
| Ausência de dado nunca vira zero | DONE nas camadas eleitoral, socioeconômica, parlamentar e PR J; #42 sinaliza somas parciais; #43 trata "Sem informação" da CGU como ausência |
| Reedição oficial preserva histórico | DONE; #42 faz as leituras de emendas usarem a edição vigente de cada dataset sem apagar as anteriores |
| Correlação com N/período/método e caveat causal | DONE (#20/#21) |
| Falácia ecológica explicitamente sinalizada | DONE (#21), mantida no contrato analítico do #24 e perfis do #25 |
| Linking de identidade por nome | PROIBIDO; #42 remove o pipeline legado Câmara↔TSE por nome (em produção, 0 de 467 candidatos a deputado federal do CE tinham `camaraId`); TSE live usa `SQ_CANDIDATO`; pesquisa só aceita `candidacy_id` auditado; `locality` textual de emenda nunca vira município |
| Insights factuais gerados por IA | PROIBIDO no runtime; regras determinísticas versionadas |
| Zero serviço pago novo | DONE — #38–#47 não criam serviço nem dependência paga (nova dependência do ETL: `cryptography`, código aberto); o magic link usa a conta do Resend que já existia, pela API HTTPS, sem mudar o plano do Railway |
| CI verde por PR | DONE até #47 |
| Migration up/rollback/up | DONE no CI de cada PR (zero → up → down até `AddMandate` → up em PostgreSQL 18 + PostGIS 3.6), inclusive a 019 do #34; #38–#47 não têm migration |
| Sonar | `main`: quality gate OK; Security, Reliability e Maintainability A; issues aceitas: 0; `NOSONAR`: 0; `FALSE_POSITIVE`: 10 ocorrências de `pythonsecurity:S8707` em ferramentas de linha de comando do ETL, marcadas em 10/10/2026 (antes do fechamento), com justificativa registrada no Sonar. PRs #38–#47: quality gate OK, 0 issue aceita e 0 hotspot pendente; o S5145 que só apareceu na análise da `main` depois do #44 foi corrigido no #45 |
| Smoke de produção | DONE — verde em todos os merges desde o #45; 44/44 checagens no merge do #46 (run `39402516266`) |
| Evidências / screenshots | artefato `repbrasil-production-smoke` de cada execução, com capturas desktop e celular da revisão implantada |

## Smoke humano (20/10/2026)

Executado pelo Elias, item a item, pelo roteiro [`CEARA_HUMAN_SMOKE.md`](CEARA_HUMAN_SMOKE.md).

| # | Item | Resultado | Horário (UTC) | Observação |
|---|---|---|---|---|
| 1 | Login com Google | OK | 02:39 | `/conta` autenticado; cookie `HttpOnly`/`Secure`/`SameSite=Lax` |
| 2 | Magic link no mesmo navegador | OK | 09:39 | 1ª execução (02:45) FALHA: SMTP de saída bloqueado no Railway, pedido preso por até 269 s; refeito OK depois do #47 |
| 3 | Magic link em outro navegador | OK | 09:41 | bloqueado pelo item 2 na 1ª execução; executado depois do #47 |
| 4 | Conta, favoritos e saída | OK | 02:57 | favorito sem " · REPBrasil"; "Sair" encerra a sessão |
| 5 | Superadmin | OK | 02:58 | 200 superadmin / 403 conta comum / 401 anônimo |
| 6 | Pesquisas e apuração | OK | 03:01 | 53 / 48 / 53 no 2º turno / 1.402 Brasil-Presidente; apuração com ausência explícita |
| 7 | Comparador | OK | 03:03 | estado reproduzível pela URL, insights sem causalidade, limite de 5, "—" na ausência |
| 8 | Exports | OK | 09:46 | 1ª execução (03:16) FALHA: URL cortada no PDF e no PNG; refeito OK depois do #46 |
| 9 | Parlamento | OK | 05:55 | 34 / 8.764 / 176; anos 2015–2026; emendas só com UF na tabela e fora do mapa |
| 10 | Dados | OK | 06:01 | 0,370 / 0,453 / N 184; ausência como "—" com N 0; URL reproduz o estado |
| 11 | Seção arquivada | OK | 06:06 | 7 linhas (2022) e 8 (2024) com proveniência do Boletim de Urna |
| 12 | Celular | OK | 06:08 | sem rolagem lateral; menu, seletores e mapas utilizáveis |
| 13 | PWA / offline | OK | 06:12 | aviso, fallback sem dado factual, volta ao reconectar |

Resultado: **13/13 OK**.

Checagem final de regressão (20/10/2026, 09:47 UTC):

- revisão final de produção: `904e079` em `front-v2`, `back-v2` e `electoral-etl-ce2026`;
- Production Smoke oficial: **44/44** (run `39402516266`);
- regressão **16/16**: conferências por leitura da API pública iguais ao observado no smoke humano
  (pesquisas, apuração, parlamento, dados, seções arquivadas e contratos anônimos de conta);
- Sonar da `main`: quality gate OK; Security, Reliability e Maintainability A;
- `back-v2`: 0 erros e 0 respostas 5xx nas 120 requisições observadas desde o deploy.

Fora do selo e sem bloqueá-lo:

- **Ciclo de credenciais da API comercial** (criar, usar e revogar uma API key real):
  `READY FOR HUMAN SMOKE`.
- **Apuração oficial:** `CODE COMPLETE`; nenhuma captura autorizada.

Iniciativa de UX separada, que não bloqueia o Ceará: `/dados` está técnico demais para o usuário
médio (Pearson, Spearman, N). A proposta é um modo simples, com frases geradas por regras
determinísticas versionadas, sem IA generativa em runtime e sem falácia ecológica (escolaridade do
eleitorado pelo perfil do eleitorado do TSE; voto × escolaridade só por território, nunca atribuído a
indivíduos), decidido em ADR antes de implementar.

O modo simples entrou com o explorador territorial (`/dados`). Regras, limites e alternativas ficam no
[ADR-008](adrs/ADR-008-leitura-simples-e-cruzamento-territorial.md). A escolaridade do eleitorado (perfil do
eleitorado do TSE) ainda não é ingerida. O indicador disponível é o analfabetismo da população de 15 anos
ou mais, do Censo 2022, que não é o mesmo universo do eleitorado.

## Regras permanentes do Data Intelligence

- `-` no SIDRA é zero verdadeiro; `..`, `...`, `X` e vazio são ausência.
- Código municipal no armazenamento aceita qualquer código de sete dígitos para fixtures de teste; os importadores validam sete dígitos e a carga real continua vinculada à proveniência oficial.
- PIB per capita não recebe identificador SIDRA inventado: é derivado de PIB total em R$ mil e população do mesmo município/período.
- Correlação de `candidacy_share` só executa quando a candidatura pertence exatamente à eleição, turno, cargo e UF pedidos.
- Correlação não implica causalidade; essa ressalva permanece visível na UI.
- Associação territorial não permite inferir características individuais do eleitor; o produto deve evitar falácia ecológica.

## Contrato do PR G

Objetivo: transformar as leituras já existentes em uma camada comparável, explicável e exportável sem introduzir opinião editorial ou números derivados sem metodologia pública.

Entregue no #24:

- busca global por políticos, lugares, partidos, eleições e indicadores oficiais, mantendo ranking determinístico e ausência explícita;
- comparador universal com candidaturas, partidos, municípios e eleições, sempre entre itens do mesmo tipo e no máximo cinco;
- insights determinísticos gerados somente por regras versionadas e métricas auditáveis;
- exports CSV, XLSX, PDF e PNG com período, filtros, fonte, metodologia, timestamp e URL reproduzível;
- filtros compartilháveis de `/dados` (`x`, `y`, `periodo`);
- URLs compartilháveis como fonte de verdade;
- nenhuma IA generativa produzindo conclusões factuais no runtime;
- nenhum insight causal a partir de correlação;
- dado ausente permanece ausente, nunca zero.

## Contrato do PR J

- PesqEle/TSE registra a pesquisa; percentuais só entram quando o resultado publicado é auditável.
- Pesquisa é estimativa amostral, não previsão nem resultado eleitoral.
- Registro pertence ao ciclo; turno pertence ao cenário quando houver classificação auditável.
- EA20 oficial é validado por fase, eleição, turno, cargo e abrangência antes da persistência.
- `not_started`, `partial` e `final` são estados diferentes e visíveis.
- Apuração parcial nunca é apresentada como resultado encerrado.
- Ausência permanece `NULL`/`—`; zero só vem de zero publicado pela fonte.
- Vínculo da apuração usa `SQ_CANDIDATO`, nunca nome.
- Snapshots preservam SHA-256 dos bytes oficiais e versões anteriores.
- Nenhuma observação sintética é semeada em produção.
- Ingestão real de pesquisas e captura real de totalização são operações explícitas e auditáveis, separadas do deploy do produto.
- Contrato completo: `docs/ELECTORAL_LIVE.md`.

## Contrato do PR H

- Conteúdo público permanece público; autenticação adiciona estado pessoal e capacidades comerciais, não paywall sobre dados já abertos.
- Google OAuth e magic link não criam senha local.
- Sessões, desafios e API keys são persistidos somente por hash; segredos completos não são recuperáveis do banco.
- OAuth `state` é one-shot e também vinculado ao navegador iniciador para impedir login-CSRF/session swap.
- Magic link também é vinculado ao navegador solicitante para impedir session swapping por link encaminhado.
- Mutações de conta exigem sessão + CSRF; CORS com credenciais aceita apenas origens e métodos explicitamente configurados.
- Favoritos/watchlist preservam rota/query reproduzível e não criam FK ou nova identidade sobre fontes TSE/IBGE.
- Alertas armazenam inscrições e notificações determinísticas; o publicador interno não inventa fatos.
- Entitlements são capacidades temporais key/value; preço/plano não é inferido no código.
- API keys possuem scopes, revogação e quota diária por conta; criar/rotacionar chaves não multiplica a cota.
- Superadmin exige gate explícito e separado do estado de conta comum.
- Zero serviço pago novo é requisito arquitetural; Google e Resend (API HTTPS) usam integrações configuráveis; SMTP não é usado, porque o Railway o bloqueia fora do plano Pro.
- Contrato completo: `docs/ACCOUNTS_AND_COMMERCIAL_API.md`.

## Contrato do PR K

- PWA não pode transformar cache de navegador em uma segunda fonte factual: navegação é network-first, APIs não são interceptadas e o modo offline exibe somente um fallback estático.
- Resultados eleitorais, pesquisas, apuração, indicadores e atividade parlamentar nunca são apresentados como atuais a partir de cache antigo.
- O mapa socioeconômico reutiliza a malha municipal oficial do IBGE e a paleta neutra do REPBrasil; ausência de observação permanece sem cor, nunca zero.
- O mapa de emendas só associa território quando a fonte fornece código IBGE oficial de sete dígitos; `locality`/nome textual nunca é convertido heuristicamente em município.
- Atos parlamentares e emendas expõem proveniência da fonte e preservam a regra de identidade documental; nome não cria vínculo com pessoa/candidatura.
- Soma de valores monetários ausentes permanece ausência quando não há valor oficial observado.
- Headers e ajustes mobile endurecem a entrega sem introduzir terceiro pago ou dependência de runtime externa.
- O PR só pode sair de draft após CI, migration up/rollback/up e revisão; só recebe `DONE` após deploy, smoke e screenshots reais da produção.

## Contrato do fechamento (#38–#47)

- Sonar sem supressão: nenhuma issue aceita, `NOSONAR` ou regra desligada em #38–#47; as causas foram
  corrigidas no código. As 10 ocorrências `pythonsecurity:S8707` marcadas como `FALSE_POSITIVE` na
  `main` são de 10/10/2026, anteriores ao fechamento, com justificativa registrada no Sonar.
- RPC do lake só em TLS vinculado ao token; texto claro apenas para o `GET /health` da plataforma
  (`docs/ELECTORAL_ARCHITECTURE.md`).
- PWA: navegação rede-primeiro, nada factual em cache, fallback estático `offline.html` e aviso de
  conexão perdida; prova com corte real de rede, sem sleeps (`docs/PWA_OFFLINE.md`).
- Auth: correlação de navegador do Google e do magic link mantida; recusas explicadas em `/entrar`;
  nenhum 500 em caminhos de recusa; magic link pela API HTTPS do Resend com prazo de 10 s, 503
  controlado e logs sem e-mail, token, link ou chave (`docs/ACCOUNTS_AND_COMMERCIAL_API.md`).
- Parlamento: identidade só documental; edição vigente por dataset; somas parciais sinalizadas;
  ingestão explícita, com proveniência e sem dados pessoais (`docs/PARLIAMENT.md`).
- O smoke de produção espera a revisão exata de front e API e só passa com contratos anônimos de
  auth, seções arquivadas servidas pelo lake, PWA offline, páginas sem erro em desktop e celular e
  exports válidos pelo conteúdo.
- Exports: URL reproduzível inteira nos quatro formatos; PDF e PNG quebram linhas pela largura
  medida, sem truncar.
