# REPBrasil Ceará — Product Complete (roadmap vivo)

Escopo geográfico ativo: **Ceará** (UF 23 / TSE CE). Eleições ativas: **2022, 2024, 2026**. Toda a
arquitetura é multi-UF e temporalmente genérica; o Ceará é só o dataset carregado nesta fase. Ao concluir,
a próxima missão é **Nordeste** — nenhuma expansão automática.

Status: `TODO` · `IN PROGRESS` · `BLOCKED` · `DONE`. Cada PR registra SHA de merge e situação em produção.

## Ambiente desta missão (11/10/2026)

| Item | Situação |
|---|---|
| Baseline `main` | `187e87f` (fix: serve XRay section votes from electoral lake) |
| Testes baseline | backend 64 ✓ / 3 só com dados reais; ETL 250 ✓; frontend lint, typecheck, 73 ✓, build ✓ |
| Rede da sessão de desenvolvimento | **BLOCKED** para `cdn.tse.jus.br`, `dadosabertos.tse.jus.br`, `servicodados.ibge.gov.br`, `apisidra.ibge.gov.br`, `dadosabertos.camara.leg.br`, `legis.senado.leg.br`, `api.portaldatransparencia.gov.br`, `www.atlasbrasil.org.br`, `*.up.railway.app` (política de egress). Pipelines novos são entregues com fixtures sintéticas e testes; a carga real depende de liberar esses hosts ou de rodar o ETL no Railway. |
| Railway (produção) | **BLOCKED** nesta sessão: sem credencial e host bloqueado. Rollout e smoke real ficam registrados como pendentes por PR. |
| Custo novo | nenhum (regra da missão) |

## PRs

| PR | Conteúdo | Status | PR | SHA | Produção |
|---|---|---|---|---|---|
| B | Vínculo votável → candidatura idempotente pelo conteúdo das entradas; vínculo de escopo arquivado; lake com token e 503 "indisponível"; guardas do PR #4 no loader estadual | IN PROGRESS | — | — | pendente |
| A | Brand Kit (tokens, Inter, light/dark, assets oficiais, favicon/PWA/OG), salvage do PR #8 (busca, segurança HTTP, SEO, nomes oficiais, home com cobertura real) | TODO | — | — | — |
| C | Base Eleitoral + rankings | TODO | — | — | — |
| D | Partidos + força partidária | TODO | — | — | — |
| E | Data Intelligence (socioeconomia, correlações, clusters) | TODO | — | — | — |
| F | Parlamento + emendas | TODO | — | — | — |
| G | Busca, comparações, insights, exports | TODO | — | — | — |
| H | Auth (Google + magic link), favoritos, watchlist, alertas, entitlements, API comercial | TODO | — | — | — |
| I | Município, estado, eleição, perfil unificado, SEO | TODO | — | — | — |
| J | Pesquisas eleitorais + apuração ao vivo | TODO | — | — | — |
| K | PWA, mobile, segurança, performance, screenshots | TODO | — | — | — |

PRs antigas: **#8** (product readiness) — auditada arquivo a arquivo; nada descartado, tudo reaproveitado
ou adaptado no PR A (ver seção "Auditoria do PR #8"). **#4** (importer estadual) — superseded pelos PRs
#5/#6 e por `scripts/import_electoral_state.py`; as guardas úteis (UF validada, checksum oficial conferido,
falha registrada no progresso) foram portadas no PR B.

## Checklist — produto (Ceará)

| Item | Status |
|---|---|
| Eleições 2022 / 2024 / 2026 (dados, explorador, Raio X) | DONE (antes desta missão) |
| Arquitetura híbrida PostGIS + lake Parquet (2022/2024 frios, 2026 quente) | DONE (antes desta missão) |
| Vínculo do BU idempotente por conteúdo (bug da invalidação manual) | IN PROGRESS (PR B) |
| Perfil unificado (cabeçalho = candidaturas do Raio X) | TODO |
| Base Eleitoral | TODO |
| Rankings | TODO |
| Partidos / força partidária | TODO |
| Patrimônio / contas (avançado) | TODO (dados já existem no Raio X) |
| Mapas temáticos (base, partido, socioeconomia, emendas) | TODO |
| Comparador universal | TODO |
| Município / estado / eleição como entidades | TODO |
| Data Intelligence / correlações / clusters | TODO |
| Atividade parlamentar / emendas × votos | TODO |
| Pesquisas eleitorais | TODO |
| Apuração ao vivo (arquitetura) | TODO |
| Busca determinística | TODO |
| Insights determinísticos | TODO |
| Exports (CSV, XLSX, PDF, PNG) | TODO |
| Auth / favoritos / watchlist / alertas | TODO |
| Entitlements (tudo liberado) / API comercial pronta | TODO |
| SEO / PWA / mobile first-class | TODO |

## Checklist — brand

| Item | Status |
|---|---|
| Brand Kit auditado | IN PROGRESS |
| Assets oficiais organizados (sem redesenho) | TODO |
| Teal `#00BAA6`, tokens semânticos, light/dark, Inter Variable | TODO |
| Logo responsiva, favicon, PWA, Apple icon, OG | TODO |
| `docs/BRAND.md` | TODO |
| Screenshots reais | TODO |

## Checklist — dados, infra, qualidade

| Item | Status |
|---|---|
| Proveniência de todo dataset novo | TODO |
| Zero serviço pago novo | DONE (mantido) |
| CI verde por PR | IN PROGRESS |
| Smokes reais (General Sampaio 2024: 4.078 votos, 30/30 seções) | TODO (regressão automatizada + smoke real pendente de rede) |
