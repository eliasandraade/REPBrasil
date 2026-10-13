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

## Ambiente desta missão (13/10/2026)

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
| G | Busca por indicadores, comparador universal por tipo, insights determinísticos versionados e exports CSV/XLSX/PDF/PNG | READY FOR HUMAN SMOKE | [#24](https://github.com/eliasandraade/REPBrasil/pull/24) | `2a4f6bc` | implantado; em 13/10/2026 os quatro exports do comparador foram baixados de produção e validados pelo conteúdo (verificação do #44, executada fora do CI); smoke humano pendente |
| H | Auth (Google + magic link), favoritos, watchlist, alertas, entitlements, API comercial + hardening de correlação/quota e superadmin | AUTOMATED GATES GREEN (#41) | [#31](https://github.com/eliasandraade/REPBrasil/pull/31), [#32](https://github.com/eliasandraade/REPBrasil/pull/32), [#33](https://github.com/eliasandraade/REPBrasil/pull/33) | `9072555` / `8d78877` / `a546a57` | implantado com três respostas 500 em caminhos de recusa, corrigidas no #41; smoke humano depois do merge |
| I | Município, estado, eleição, perfil unificado, SEO | DONE | [#25](https://github.com/eliasandraade/REPBrasil/pull/25) | `ec54967` | validado após correção de indicadores no #26 |
| J | Pesquisas eleitorais auditáveis + snapshots oficiais de apuração, estados não iniciado/parcial/final, `/pesquisas` | READY FOR HUMAN SMOKE | [#27](https://github.com/eliasandraade/REPBrasil/pull/27) | `e9d727d` | 53 registros de Governador/CE 2026 em produção; captura de apuração é operação explícita; smoke humano pendente |
| K | PWA factual-safe, mobile, segurança, performance, mapas socioeconômico/emendas, APIs e experiência parlamentar | CODE COMPLETE | [#34](https://github.com/eliasandraade/REPBrasil/pull/34) | `f02ea20` | implantado; o smoke automático falha na etapa offline até o #40; `/parlamento` vazio até #43 + ingestão |
| — | Workflow de smoke de produção e capturas | — | [#35](https://github.com/eliasandraade/REPBrasil/pull/35) | `0a2f6b8` | ativo; nenhuma execução passou até agora (ver Ambiente) |
| — | Correções Sonar após o smoke | — | [#36](https://github.com/eliasandraade/REPBrasil/pull/36) | `e4dd3e2` | — |
| — | Smoke de dados ciente da hidratação | — | [#37](https://github.com/eliasandraade/REPBrasil/pull/37) | `6c4832d` | revisão atual de produção |

## Fechamento Ceará — PRs empilhados (abertos)

| PR | Branch | Base | Conteúdo | Status |
|---|---|---|---|---|
| [#38](https://github.com/eliasandraade/REPBrasil/pull/38) | `fix/main-sonar-security` | `main` | taint S8707 do importador estadual e smells de confiabilidade do código novo da `main` | AUTOMATED GATES GREEN |
| [#39](https://github.com/eliasandraade/REPBrasil/pull/39) | `fix/lake-rpc-tls` | #38 | RPC privado do lake em TLS vinculado ao token (S5332) | AUTOMATED GATES GREEN |
| [#40](https://github.com/eliasandraade/REPBrasil/pull/40) | `fix/pwa-offline-production` | #39 | PWA factual-safe provado com corte real de rede; causa do smoke #3 | AUTOMATED GATES GREEN |
| [#41](https://github.com/eliasandraade/REPBrasil/pull/41) | `fix/auth-export-hardening` | #40 | três 500 de auth, recusas explicadas em `/entrar`, testes de fluxo de conta, CSV sem fórmula | AUTOMATED GATES GREEN |
| [#42](https://github.com/eliasandraade/REPBrasil/pull/42) | `fix/parliament-identity-integrity` | #41 | fim do vínculo por nome Câmara↔TSE, edição vigente de emendas, somas parciais sinalizadas | AUTOMATED GATES GREEN |
| [#43](https://github.com/eliasandraade/REPBrasil/pull/43) | `feat/parliament-ce-ingestion` | #42 | ingestão auditável de parlamento por UF a partir das fontes oficiais | AUTOMATED GATES GREEN |
| [#44](https://github.com/eliasandraade/REPBrasil/pull/44) | `chore/ceara-final-evidence` | #43 | smoke de produção ampliado, documentação reconciliada e roteiro de smoke humano | ver os checks do próprio PR |

Resultados de CI, Sonar e testes de cada PR estão na descrição do PR.

## Ordem de merge e operações

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
| Arquitetura híbrida PostGIS + lake Parquet | DONE; RPC do lake em TLS: AUTOMATED GATES GREEN (#39) |
| Vínculo do BU idempotente por conteúdo | DONE (#16) |
| Base Eleitoral | DONE (#18) — `docs/ELECTORAL_BASE.md` |
| Rankings | DONE (#18) — `docs/ELECTORAL_BASE.md` §2 |
| Partidos / força partidária | DONE (#19) — `docs/PARTY_INTELLIGENCE.md` |
| Data Intelligence / correlações / clusters | DONE (#20) — `docs/DATA_INTELLIGENCE.md` |
| Primeira carga socioeleitoral oficial | DONE (#21/#22) — Censo 2022, 184 municípios do Ceará |
| Perfil socioeleitoral | DONE (#21) — Pearson, Spearman, N, scatter, quintis e caveat de falácia ecológica |
| Fundação parlamentar auditável | DONE (#23) — schema, proveniência, Câmara e emendas |
| Mapas temáticos | base/partido DONE; socioeconômico READY FOR HUMAN SMOKE (#34); emendas CODE COMPLETE — dependem de #42, #43 e da ingestão |
| Atividade parlamentar e emendas | CODE COMPLETE — APIs e `/parlamento` em produção (#34), vazios; identidade documental, edição vigente e somas parciais no #42; ingestão no #43; carga real é operação pós-merge |
| Comparador universal | READY FOR HUMAN SMOKE (#24) — candidaturas, partidos, municípios e eleições; até cinco itens do mesmo tipo |
| Insights determinísticos | READY FOR HUMAN SMOKE (#24) — regras versionadas, sem LLM factual em runtime; conferidos no comparador |
| Exports (CSV, XLSX, PDF, PNG) | READY FOR HUMAN SMOKE (#24) — contexto, fontes, metodologia, timestamp e URL reproduzível; CSV sem fórmulas no #41; validação por conteúdo no smoke do #44 |
| Busca por indicadores | DONE (#24) — catálogo oficial do Data Intelligence integrado à busca agrupada |
| Município / estado / eleição como entidades | DONE (#25/#26) — perfis canônicos, SEO, sitemap, timeline, rankings e Data Intelligence |
| Pesquisas eleitorais | READY FOR HUMAN SMOKE (#27) — 53 registros de Governador/CE 2026; percentuais só quando publicados por fonte auditada |
| Apuração oficial | CODE COMPLETE (#27) — snapshots oficiais TSE com `not_started`/`partial`/`final`; nenhuma captura em produção; captura é operação explícita |
| Auth / favoritos / watchlist / alertas | AUTOMATED GATES GREEN (#41) — fluxos de conta testados contra o banco; alertas ficam na caixa `in_app` (envio por e-mail não implementado, documentado) |
| Entitlements / API comercial | AUTOMATED GATES GREEN (#41) — 401/403/429 explícitos, quota diária por conta |
| PWA / offline seguro | AUTOMATED GATES GREEN (#40) — produção ainda serve o SW anterior; smoke automático falha até o merge |
| Mobile / hardening de produção | READY FOR HUMAN SMOKE (#34) — capturas móveis com guarda de console/5xx no smoke do #44 |

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
| Zero serviço pago novo | DONE — #38–#44 não criam serviço nem dependência paga (nova dependência do ETL: `cryptography`, código aberto) |
| CI verde por PR | DONE até #37; #38–#43 verdes nos heads atuais; #44: checks do próprio PR |
| Migration up/rollback/up | DONE no CI de cada PR (zero → up → down até `AddMandate` → up em PostgreSQL 18 + PostGIS 3.6), inclusive a 019 do #34; #38–#44 não têm migration |
| Sonar | `main` em Security C até o merge de #38 e #39; #38–#43 com quality gate OK, 0 issue aberta, 0 aceita e 0 hotspot pendente |
| Smoke de produção | falhando na `main` (etapa offline); corrigido no #40 e ampliado no #44 |
| Evidências / screenshots | artefato `repbrasil-production-smoke` de cada execução; capturas da versão implantada só depois do merge |

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
- Zero serviço pago novo é requisito arquitetural; Google/SMTP usam integrações configuráveis.
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

## Contrato do fechamento (#38–#44)

- Sonar sem supressão: nenhuma issue aceita, `NOSONAR` ou regra desligada; as causas foram corrigidas
  no código.
- RPC do lake só em TLS vinculado ao token; texto claro apenas para o `GET /health` da plataforma
  (`docs/ELECTORAL_ARCHITECTURE.md`).
- PWA: navegação rede-primeiro, nada factual em cache, fallback estático `offline.html` e aviso de
  conexão perdida; prova com corte real de rede, sem sleeps (`docs/PWA_OFFLINE.md`).
- Auth: correlação de navegador do Google e do magic link mantida; recusas explicadas em `/entrar`;
  nenhum 500 em caminhos de recusa (`docs/ACCOUNTS_AND_COMMERCIAL_API.md`).
- Parlamento: identidade só documental; edição vigente por dataset; somas parciais sinalizadas;
  ingestão explícita, com proveniência e sem dados pessoais (`docs/PARLIAMENT.md`).
- O smoke de produção espera a revisão exata de front e API e só passa com contratos anônimos de
  auth, seções arquivadas servidas pelo lake, PWA offline, páginas sem erro em desktop e celular e
  exports válidos pelo conteúdo.
