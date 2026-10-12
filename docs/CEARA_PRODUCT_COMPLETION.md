# REPBrasil Ceará — Product Complete (roadmap vivo)

Escopo geográfico ativo: **Ceará** (UF 23 / TSE CE). Eleições ativas: **2022, 2024, 2026**. Toda a
arquitetura é multi-UF e temporalmente genérica; o Ceará é só o dataset carregado nesta fase. Ao concluir,
a próxima missão é **Nordeste** — nenhuma expansão automática.

Status: `TODO` · `IN PROGRESS` · `BLOCKED` · `DONE`. Cada PR registra SHA de merge e situação em produção.

## Ambiente desta missão (12/10/2026)

| Item | Situação |
|---|---|
| Baseline funcional | pós-PR #33: PR H incorporado com hotfix de correlação/quota e gate de superadmin, além de PR J/PesqEle, comparador universal, perfis territoriais e Data Intelligence |
| Produção | `main` até #33; `front-v2`, `back-v2` e `electoral-etl-ce2026` saudáveis no rollout anterior; PR K está em validação no #34 e ainda não foi implantado |
| Data Intelligence | Censo 2022 carregado para os 184 municípios do Ceará: população, alfabetização 15+ e analfabetismo 15+; perfil socioeleitoral ativo; mapa socioeconômico implementado no #34, aguardando CI/smoke |
| Parlamento | fundação auditável do #23 em produção; APIs, experiência `/parlamento` e mapa de emendas implementados no #34, aguardando CI, migration e smoke; vínculo por nome continua proibido |
| Pesquisas / apuração | schema, API, ETL e `/pesquisas` implantados; observações reais só aparecem após ingestão operacional das fontes oficiais, sem seed sintético |
| Conta / comercial | código dos PRs #31/#32/#33 incorporado: Google + magic link, favoritos, watchlist, alertas, entitlements, API keys, hardening de correlação/quota e superadmin; credenciais Google/SMTP e smoke real ainda pendentes |
| Custo novo | nenhum (regra da missão) |

## PRs

| PR | Conteúdo | Status | PR | SHA | Produção |
|---|---|---|---|---|---|
| B | Vínculo votável → candidatura idempotente pelo conteúdo das entradas; vínculo de escopo arquivado; lake com token e 503 "indisponível"; guardas do PR #4 no loader estadual | DONE | [#16](https://github.com/eliasandraade/REPBrasil/pull/16) | `128d98b` | validado |
| A | Brand Kit, busca, segurança HTTP, SEO, nomes oficiais, home com cobertura real | DONE | [#17](https://github.com/eliasandraade/REPBrasil/pull/17) | `5f0d1f2` | validado |
| C | Base Eleitoral + rankings determinísticos e guardas de comparabilidade | DONE | [#18](https://github.com/eliasandraade/REPBrasil/pull/18) | `561187a` | validado |
| D | Partidos e força partidária (sigla oficial, BU, variação comparável, municípios, candidaturas, camada Partido, `/partidos`) | DONE | [#19](https://github.com/eliasandraade/REPBrasil/pull/19) | `f86be3e` | validado |
| E | Data Intelligence: socioeconomia, proveniência, SIDRA/Atlas, Pearson/Spearman, `candidacy_share`, clusters e `/dados`; seguido pela primeira ingestão Censo 2022 e perfil socioeleitoral | DONE | [#20](https://github.com/eliasandraade/REPBrasil/pull/20), [#21](https://github.com/eliasandraade/REPBrasil/pull/21), [#22](https://github.com/eliasandraade/REPBrasil/pull/22) | `adde263` / `cc24a9f` / `a809e31` | validado |
| F | Fundação auditável de Parlamento + emendas: fontes, membros, mandatos, atividades, emendas, Câmara paginada, parser fail-closed e identidade sem heurística de nome | DONE | [#23](https://github.com/eliasandraade/REPBrasil/pull/23) | `a428c56` | migration e schema verificados |
| G | Busca por indicadores, comparador universal por tipo, insights determinísticos versionados e exports CSV/XLSX/PDF/PNG | DONE | [#24](https://github.com/eliasandraade/REPBrasil/pull/24) | `2a4f6bc` | deploy concluído; smoke humano do comparador/exports pendente |
| H | Auth (Google + magic link), favoritos, watchlist, alertas, entitlements, API comercial + hardening de correlação/quota e superadmin | IN PROGRESS | [#31](https://github.com/eliasandraade/REPBrasil/pull/31), [#32](https://github.com/eliasandraade/REPBrasil/pull/32), [#33](https://github.com/eliasandraade/REPBrasil/pull/33) | `9072555` / `8d78877` / `a546a57` | código implantado; credenciais Google/SMTP e smoke real pendentes |
| I | Município, estado, eleição, perfil unificado, SEO | DONE | [#25](https://github.com/eliasandraade/REPBrasil/pull/25) | `ec54967` | validado após correção de indicadores no #26 |
| J | Pesquisas eleitorais auditáveis + snapshots oficiais de apuração, estados não iniciado/parcial/final, `/pesquisas` | DONE | [#27](https://github.com/eliasandraade/REPBrasil/pull/27) | `e9d727d` | rollout concluído; smoke humano de `/pesquisas` pendente |
| K | PWA factual-safe, mobile, segurança, performance, mapas socioeconômico/emendas, APIs e experiência parlamentar, evidências finais | IN PROGRESS | [#34](https://github.com/eliasandraade/REPBrasil/pull/34) | — | draft; CI, migration, deploy, smoke e screenshots pendentes |

## Ordem recomendada a partir daqui

**H (smoke operacional) → K (validação e rollout) → selo Ceará**.

O código do H já está incorporado, mas a missão não considera a frente encerrada enquanto Google/SMTP não estiverem configurados e testados em produção. O K fecha as lacunas restantes e só pode receber `DONE` depois de CI, migration/rollback, rollout, smoke e evidências.

## Checklist — produto (Ceará)

| Item | Status |
|---|---|
| Eleições 2022 / 2024 / 2026 (dados, explorador, Raio X) | DONE |
| Arquitetura híbrida PostGIS + lake Parquet | DONE |
| Vínculo do BU idempotente por conteúdo | DONE (#16) |
| Base Eleitoral | DONE (#18) — `docs/ELECTORAL_BASE.md` |
| Rankings | DONE (#18) — `docs/ELECTORAL_BASE.md` §2 |
| Partidos / força partidária | DONE (#19) — `docs/PARTY_INTELLIGENCE.md` |
| Data Intelligence / correlações / clusters | DONE (#20) — `docs/DATA_INTELLIGENCE.md` |
| Primeira carga socioeleitoral oficial | DONE (#21/#22) — Censo 2022, 184 municípios do Ceará |
| Perfil socioeleitoral | DONE (#21) — Pearson, Spearman, N, scatter, quintis e caveat de falácia ecológica |
| Fundação parlamentar auditável | DONE (#23) — schema, proveniência, Câmara e emendas |
| Mapas temáticos (base, partido, socioeconomia, emendas) | IN PROGRESS (#34) — base/partido já validados; socioeconomia e emendas implementadas com malha IBGE e sem inferência territorial, aguardando CI/smoke |
| Atividade parlamentar / emendas × votos | IN PROGRESS (#23/#34) — APIs, `/parlamento` e mapa de emendas implementados; ingestão real ampla e validação de produção ainda pendentes |
| Comparador universal | DONE (#24) — candidaturas, partidos, municípios e eleições; até cinco itens do mesmo tipo |
| Insights determinísticos | DONE (#24) — regras versionadas, empate/ausência preservados, sem LLM factual em runtime |
| Exports (CSV, XLSX, PDF, PNG) | DONE (#24) — contexto, fontes, metodologia, timestamp e URL reproduzível |
| Busca por indicadores | DONE (#24) — catálogo oficial do Data Intelligence integrado à busca agrupada |
| Município / estado / eleição como entidades | DONE (#25/#26) — perfis canônicos, SEO, sitemap, timeline, rankings e Data Intelligence |
| Pesquisas eleitorais | DONE (#27) — registro, escopo e fonte auditáveis; percentuais só quando publicados por fonte auditada; carga real é operação separada |
| Apuração oficial | DONE (#27) — snapshots oficiais TSE com `not_started`/`partial`/`final`, sem reconstrução ou projeção; captura real é operação separada |
| Auth / favoritos / watchlist / alertas | IN PROGRESS (#31/#32/#33) — implementação/hardening incorporados; credenciais Google/SMTP e smoke real pendentes |
| Entitlements / API comercial | IN PROGRESS (#31/#32) — entitlements temporais, API keys por hash e quota diária por conta implementados; smoke real pendente |
| PWA / offline seguro | IN PROGRESS (#34) — shell estático pode ser cacheado; páginas/API factuais nunca são servidas de cache antigo; CI/smoke pendentes |
| Mobile / hardening de produção | IN PROGRESS (#34) — viewport dinâmico, formulários móveis, headers e imagens modernas implementados; validação final pendente |

## Checklist — dados, infra, qualidade

| Item | Status |
|---|---|
| Proveniência de todo dataset novo | DONE para Data Intelligence, Parlamento e PR J; pesquisas/live preservam URL, SHA-256, parser e instante de aquisição |
| Ausência de dado nunca vira zero | DONE nas camadas eleitoral, socioeconômica, parlamentar e PR J; PR #34 mantém município/emenda sem observação fora da escala em vez de gerar zero |
| Reedição oficial preserva histórico | DONE no Data Intelligence; PR J preserva snapshots/edições por SHA dos bytes oficiais; consultas parlamentares do #34 escolhem a edição mais recente sem apagar a fonte histórica |
| Correlação com N/período/método e caveat causal | DONE (#20/#21) |
| Falácia ecológica explicitamente sinalizada | DONE (#21), mantida no contrato analítico do #24 e perfis do #25 |
| Linking de identidade por nome | PROIBIDO; Câmara exige evidência documental oficial; TSE live usa `SQ_CANDIDATO`; pesquisa só aceita `candidacy_id` previamente auditado; #34 não converte `locality` textual de emenda em município |
| Insights factuais gerados por IA | PROIBIDO no runtime; PR G usa regras determinísticas versionadas |
| Zero serviço pago novo | DONE |
| CI verde por PR | DONE até #33; #34 em execução |
| Migration up/rollback/up | PENDENTE para #34 (`AddParliamentAmendmentMunicipality`) |
| Smoke de produção | deploy do #27 verificado no Railway; smoke humano específico de `/pesquisas`, smoke do H após configuração e smoke do #34 permanecem pendentes |
| Evidências / screenshots | PENDENTE para #34; devem ser capturadas da versão implantada, não simuladas |

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
