# REPBrasil Ceará — Product Complete (roadmap vivo)

Escopo geográfico ativo: **Ceará** (UF 23 / TSE CE). Eleições ativas: **2022, 2024, 2026**. Toda a
arquitetura é multi-UF e temporalmente genérica; o Ceará é só o dataset carregado nesta fase. Ao concluir,
a próxima missão é **Nordeste** — nenhuma expansão automática.

Status: `TODO` · `IN PROGRESS` · `BLOCKED` · `DONE`. Cada PR registra SHA de merge e situação em produção.

## Ambiente desta missão (11/10/2026)

| Item | Situação |
|---|---|
| Baseline `main` | `a6e9d93` (hotfix de migration de slug idempotente, após #19) |
| Produção | `front-v2`, `back-v2` e Electoral Lake validados em smoke manual; navegação, políticos, eleições, Base Eleitoral, rankings, partidos, mapa e busca passaram |
| Rede da sessão de desenvolvimento | bloqueada para várias fontes públicas; pipelines novos são entregues com fixtures claramente fictícias e testes; nenhuma fixture vai para produção |
| Custo novo | nenhum (regra da missão) |

## PRs

| PR | Conteúdo | Status | PR | SHA | Produção |
|---|---|---|---|---|---|
| B | Vínculo votável → candidatura idempotente pelo conteúdo das entradas; vínculo de escopo arquivado; lake com token e 503 "indisponível"; guardas do PR #4 no loader estadual | DONE | [#16](https://github.com/eliasandraade/REPBrasil/pull/16) | `128d98b` | validado |
| A | Brand Kit, busca, segurança HTTP, SEO, nomes oficiais, home com cobertura real | DONE | [#17](https://github.com/eliasandraade/REPBrasil/pull/17) | `5f0d1f2` | validado |
| C | Base Eleitoral + rankings determinísticos e guardas de comparabilidade | DONE | [#18](https://github.com/eliasandraade/REPBrasil/pull/18) | `561187a` | validado |
| D | Partidos e força partidária (sigla oficial, BU, variação comparável, municípios, candidaturas, camada Partido, `/partidos`) | DONE | [#19](https://github.com/eliasandraade/REPBrasil/pull/19) | `f86be3e` | validado |
| E | Data Intelligence: socioeconomia, proveniência, SIDRA/Atlas, Pearson/Spearman, `candidacy_share`, clusters, `/dados` | IN PROGRESS | [#20](https://github.com/eliasandraade/REPBrasil/pull/20) | — | após merge + carga oficial |
| F | Parlamento + emendas | TODO | — | — | — |
| G | Busca, comparações, insights, exports | TODO | — | — | — |
| H | Auth (Google + magic link), favoritos, watchlist, alertas, entitlements, API comercial | TODO | — | — | — |
| I | Município, estado, eleição, perfil unificado, SEO | TODO | — | — | — |
| J | Pesquisas eleitorais + apuração ao vivo | TODO | — | — | — |
| K | PWA, mobile, segurança, performance, screenshots | TODO | — | — | — |

## Checklist — produto (Ceará)

| Item | Status |
|---|---|
| Eleições 2022 / 2024 / 2026 (dados, explorador, Raio X) | DONE |
| Arquitetura híbrida PostGIS + lake Parquet | DONE |
| Vínculo do BU idempotente por conteúdo | DONE (#16) |
| Base Eleitoral | DONE (#18) — `docs/ELECTORAL_BASE.md` |
| Rankings | DONE (#18) — `docs/ELECTORAL_BASE.md` §2 |
| Partidos / força partidária | DONE (#19) — `docs/PARTY_INTELLIGENCE.md` |
| Mapas temáticos (base, partido, socioeconomia, emendas) | IN PROGRESS — base e partido concluídos; socioeconomia/emendas dependem dos PRs E/F |
| Data Intelligence / correlações / clusters | IN PROGRESS (#20) — `docs/DATA_INTELLIGENCE.md` |
| Atividade parlamentar / emendas × votos | TODO |
| Comparador universal | TODO |
| Município / estado / eleição como entidades | TODO |
| Pesquisas eleitorais | TODO |
| Apuração ao vivo | TODO |
| Insights determinísticos | TODO |
| Exports (CSV, XLSX, PDF, PNG) | TODO |
| Auth / favoritos / watchlist / alertas | TODO |
| Entitlements / API comercial | TODO |

## Checklist — dados, infra, qualidade

| Item | Status |
|---|---|
| Proveniência de todo dataset novo | IN PROGRESS — PR E cria `socioeconomic_source` com URL, dataset, SHA-256, parser e instante de coleta |
| Ausência de dado nunca vira zero | DONE na camada eleitoral; guardado explicitamente no PR E |
| Reedição oficial preserva histórico | IN PROGRESS (#20) — nova fonte por SHA; mesma SHA é idempotente |
| Correlação com N/período/método e caveat causal | IN PROGRESS (#20) |
| Zero serviço pago novo | DONE |
| CI verde por PR | obrigatório antes de merge |
| Smoke de produção | DONE para baseline anterior ao PR E; repetir `/dados` depois do merge |

## Regras do PR E

- `-` no SIDRA é zero verdadeiro; `..`, `...`, `X` e vazio são ausência.
- Código municipal no armazenamento aceita qualquer código de sete dígitos para fixtures de teste; os importadores validam sete dígitos e a carga real continua vinculada à proveniência oficial.
- PIB per capita não recebe identificador SIDRA inventado: é derivado de PIB total em R$ mil e população do mesmo município/período.
- Correlação de `candidacy_share` só executa quando a candidatura pertence exatamente à eleição, turno, cargo e UF pedidos.
- Correlação não implica causalidade; essa ressalva permanece visível na UI.
