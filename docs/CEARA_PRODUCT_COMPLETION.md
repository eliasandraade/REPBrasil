# REPBrasil Ceará — Product Complete (roadmap vivo)

Escopo geográfico ativo: **Ceará** (UF 23 / TSE CE). Eleições ativas: **2022, 2024, 2026**. Toda a
arquitetura é multi-UF e temporalmente genérica; o Ceará é só o dataset carregado nesta fase. Ao concluir,
a próxima missão é **Nordeste** — nenhuma expansão automática.

Status: `TODO` · `IN PROGRESS` · `BLOCKED` · `DONE`. Cada PR registra SHA de merge e situação em produção.

## Ambiente desta missão (12/10/2026)

| Item | Situação |
|---|---|
| Baseline funcional | pós-PR #26 (`d9a7953`), com comparador universal, perfis territoriais e indicadores socioeconômicos canônicos |
| Produção | PR J ainda não alterou produção; rollout só ocorre após gates e merge do #27 |
| Data Intelligence | Censo 2022 carregado para os 184 municípios do Ceará: população, alfabetização 15+ e analfabetismo 15+; perfil socioeleitoral ativo |
| Parlamento | migration e cinco tabelas auditáveis aplicadas em produção; fundação de Câmara/emendas pronta, sem linking por nome |
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
| H | Auth (Google + magic link), favoritos, watchlist, alertas, entitlements, API comercial | TODO | — | — | — |
| I | Município, estado, eleição, perfil unificado, SEO | DONE | [#25](https://github.com/eliasandraade/REPBrasil/pull/25) | `ec54967` | deploy concluído; correção de indicadores no #26 |
| J | Pesquisas eleitorais auditáveis + snapshots oficiais de apuração, estados não iniciado/parcial/final, `/pesquisas` | IN PROGRESS | [#27](https://github.com/eliasandraade/REPBrasil/pull/27) | — | não implantado |
| K | PWA, mobile, segurança, performance, screenshots | TODO | — | — | — |

## Ordem recomendada a partir daqui

**J → H → K**.

O PR J adiciona o ciclo eleitoral vivo; o H entra quando há valor recorrente suficiente para conta, alertas e monetização; o K encerra a missão Ceará com acabamento de produção.

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
| Mapas temáticos (base, partido, socioeconomia, emendas) | IN PROGRESS — base e partido concluídos; camadas socioeconômica e de emendas ainda pendentes |
| Atividade parlamentar / emendas × votos | IN PROGRESS — fundação de dados concluída no #23; ingestão real ampla, APIs e experiência de produto ainda pendentes |
| Comparador universal | DONE (#24) — candidaturas, partidos, municípios e eleições; até cinco itens do mesmo tipo |
| Insights determinísticos | DONE (#24) — regras versionadas, empate/ausência preservados, sem LLM factual em runtime |
| Exports (CSV, XLSX, PDF, PNG) | DONE (#24) — contexto, fontes, metodologia, timestamp e URL reproduzível |
| Busca por indicadores | DONE (#24) — catálogo oficial do Data Intelligence integrado à busca agrupada |
| Município / estado / eleição como entidades | DONE (#25/#26) — perfis canônicos, SEO, sitemap, timeline, rankings e Data Intelligence |
| Pesquisas eleitorais | IN PROGRESS (#27) — registro e fonte auditáveis; percentuais só quando publicados por fonte auditada |
| Apuração ao vivo | IN PROGRESS (#27) — snapshots oficiais TSE, sem reconstrução ou projeção |
| Auth / favoritos / watchlist / alertas | TODO (H) |
| Entitlements / API comercial | TODO (H) |

## Checklist — dados, infra, qualidade

| Item | Status |
|---|---|
| Proveniência de todo dataset novo | DONE para Data Intelligence e fundação parlamentar; IN PROGRESS no #27 com URL, SHA-256, parser e instante da fonte eleitoral viva |
| Ausência de dado nunca vira zero | DONE nas camadas eleitoral, socioeconômica e parlamentar; preservada nos PRs G/I e no contrato do #27 |
| Reedição oficial preserva histórico | DONE no Data Intelligence; #27 preserva snapshots por SHA de bytes oficiais |
| Correlação com N/período/método e caveat causal | DONE (#20/#21) |
| Falácia ecológica explicitamente sinalizada | DONE (#21), mantida no contrato analítico do #24 e perfis do #25 |
| Linking de identidade por nome | PROIBIDO; Câmara exige evidência documental oficial; TSE live usa `SQ_CANDIDATO`; pesquisa só aceita `candidacy_id` previamente auditado |
| Insights factuais gerados por IA | PROIBIDO no runtime; PR G usa regras determinísticas versionadas |
| Zero serviço pago novo | DONE |
| CI verde por PR | DONE até #26; #27 em execução |
| Smoke de produção | PR J aguardará merge/deploy e smoke específico de `/pesquisas` |

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
- EA20 oficial é validado por fase, eleição, turno, cargo e abrangência antes da persistência.
- `not_started`, `partial` e `final` são estados diferentes e visíveis.
- Apuração parcial nunca é apresentada como resultado encerrado.
- Ausência permanece `NULL`/`—`; zero só vem de zero publicado pela fonte.
- Vínculo da apuração usa `SQ_CANDIDATO`, nunca nome.
- Snapshots preservam SHA-256 dos bytes oficiais e versões anteriores.
- Nenhuma observação sintética é semeada em produção.
- Contrato completo: `docs/ELECTORAL_LIVE.md`.
