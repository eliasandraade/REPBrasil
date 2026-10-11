# Base Eleitoral e Rankings

> Escopo: Ceará (multi-UF por construção). Eleições 2022/2024 (arquivadas no lake) e 2026 (quente no PostGIS).
> Princípios que valem aqui: **ausência ≠ zero**, **comparar só disputas comparáveis**, **nenhum índice opaco**,
> **descrever, nunca avaliar/recomendar/prever**.

## 1. O que é a Base Eleitoral

A Base Eleitoral responde, para **uma candidatura**, onde ela é forte, fraca ou disputada — por município, zona,
seção ou local de votação — e como isso mudou desde a candidatura anterior **na mesma disputa**.

- Endpoint: `GET /api/v1/elections/candidacies/{id}/base?level=municipality|zone|section|place&uf=&municipality=&zone=&compareTo=`
- Camada do mapa: `GET /api/v1/elections/{year}/{round}/states/{uf}/map?layer=base&candidacy={id}&municipality=`
  (legenda ordinal de 5 classes, um matiz).
- Tela: aba **Base eleitoral** do perfil do político; link "Ver a base no mapa do explorador" (`?camada=base`).

Vice e suplente são votados na chapa: a API responde **400** e a tela orienta a abrir a candidatura titular.

### 1.1 Fatos × métricas × classificação

| Tipo | Exemplos | Origem |
|---|---|---|
| **Fato** | votos no território, votos válidos do cargo, posição entre os números votados | Boletim de Urna vigente (PostGIS quente ou lake arquivado) |
| **Métrica derivada** | participação (%), margem (p.p.), capilaridade, HHI, concentração top 5, variação | calculada sobre os fatos, com definição publicada em `definitions` |
| **Classificação** | Fortaleza eleitoral, Forte, Competitivo, Fraco, Muito fraco | fórmula versionada `electoral-base/v1`, sempre com decomposição |

### 1.2 Fórmula `electoral-base/v1`

Pontuação = Σ (componente × peso), de 0 a 1.

| Componente | Peso | Definição |
|---|---|---|
| `share_percentile` — Participação relativa | 0,35 | percentil (mid-rank) da % dos válidos da candidatura no território, entre os territórios do recorte |
| `position` — Posição | 0,25 | `1 − (posição − 1) ÷ min(concorrentes votados − 1, 9)`; 1º = 1; 10º ou além = 0 |
| `leader_ratio` — Distância do primeiro | 0,25 | votos da candidatura ÷ votos do mais votado no território (1 = lidera) |
| `volume_percentile` — Volume | 0,15 | percentil (mid-rank) dos votos absolutos no território |

- Com **menos de 5 territórios** classificáveis, os percentis ficam de fora e os pesos restantes são reescalados para somar 1.
- Classes: **Fortaleza eleitoral ≥ 0,80 · Forte ≥ 0,60 · Competitivo ≥ 0,40 · Fraco ≥ 0,20 · Muito fraco < 0,20**.
- Cada território devolve `components[]` (valor, peso, contribuição) — a tela mostra em "Por quê?".
- Território **sem cobertura, fora da disputa, sem vínculo auditado ou sem estatística da disputa não é classificado** (nunca vira "Muito fraco").
- Mudar pesos, limiares ou componentes exige **nova versão** (`electoral-base/v2`), nunca edição silenciosa da v1.

### 1.3 Posição na disputa (estatística por território)

`ContestStatsAsync` devolve, por território: votos do líder, melhor dos outros, número de concorrentes votados,
quantos estão à frente e os votos da candidatura. A posição considera **todos os números votados da disputa**
(vinculados ou não a um perfil) — assim a posição não depende da qualidade do vínculo de identidade.

- Seção/local em eleição arquivada → lake (`POST /v1/section-contest-stats` no worker), mesmo contrato.
- Município/zona → `votable_zone_votes_current` (vivo ∪ snapshot arquivado).

### 1.4 Margem, competitivo, crítico

- **Margem (p.p. dos válidos)**: vantagem sobre o 2º quando lidera; distância até o 1º quando não lidera. Sem válidos → sem margem (nunca 0).
- **Competitivo**: |margem| ≤ 5 p.p. com pelo menos 2 concorrentes votados.
- **Crítico**: território que, somado aos de mais votos, forma **metade da votação** da candidatura **e** está competitivo
  ou caiu **10% ou mais** em relação à candidatura comparável anterior.

### 1.5 Mudança entre eleições

Compara com a candidatura anterior da mesma pessoa/perfil **na mesma disputa** (cargo + unidade eleitoral), escolhida
automaticamente ou por `compareTo`. Regras:

- Disputa diferente → `comparedWith.comparability` diz o motivo e **não há delta**.
- Seção recomposta (membros agregados mudaram) → `section_composition_changed`, **sem delta** naquela seção.
- Cobertura ou seção ausente em qualquer lado → `coverage_or_section_missing`, sem delta.
- Destaques: crescimento, queda, ganhou/perdeu posição — só de territórios comparáveis.

### 1.6 Regressão General Sampaio (Prefeito 2024)

Teste `General_sampaio_mayor_2024_keeps_every_section_and_the_official_total`: 30/30 seções, total 4.078, seções
27 = 151, 29 (+agregada 231) = 169, 30 (+agregada 232) = 166, 226 = 195, 206 = 175; membros agregados preservados.

## 2. Rankings

- `GET /api/v1/rankings/kinds` — tipos com definição, unidade, filtros obrigatórios, regra de comparabilidade e fonte.
- `GET /api/v1/rankings?kind=&year=&round=&office=&uf=&municipality=&party=&page=&pageSize=` (máx. 100 por página).
- Tela: `/rankings` — filtros na URL (`tipo`, `ano`, `turno`, `cargo`, `uf`, `municipio`, `partido`, `pagina`).

| Tipo (`kind` / `tipo`) | Mede | Exige |
|---|---|---|
| `votes` / mais-votados | votos nominais no recorte | eleição, cargo, UF; **município para cargo municipal** |
| `share` / participacao | votos ÷ válidos do cargo na unidade da própria disputa | eleição, cargo, UF |
| `growth`, `decline` / crescimento, queda | votos atuais − anteriores na **mesma disputa**, só com cobertura completa nas duas eleições; cargo municipal sem município ordena pela variação % | eleição, cargo, UF |
| `capillarity` / capilaridade | municípios com voto ÷ municípios com BU | só cargos estaduais/federais |
| `concentration` / concentracao | HHI entre municípios (0–10.000) | só cargos estaduais/federais |
| `territorial_strength` / forca-territorial | municípios em que foi a mais votada | só cargos estaduais/federais |
| `assets`, `asset_growth` / patrimonio, crescimento-patrimonial | bens declarados (valor declarado, nominal) | eleição, UF |
| `revenue`, `spending` / arrecadacao, gastos | prestação de contas | eleição, UF |
| `votes_per_real` / votos-por-real | votos ÷ despesas contratadas (> 0) — razão descritiva, não eficiência | eleição, cargo, UF |
| `parties` / partidos | nominais + legenda (proporcional) ou nominais (majoritário) | eleição, cargo, UF |
| `recurrence` / recorrencia | candidaturas da mesma pessoa/perfil nas eleições importadas | UF |

Regras invariantes:

- **Recorte incompatível = 400 com o motivo** (ex.: vice/suplente; vereador sem município em "mais votados";
  capilaridade de cargo municipal). A tela verifica as mesmas regras antes de consultar.
- **Métrica ausente nunca vira zero**: a candidatura sai do ranking e entra em `excluded` + `excludedNote`.
- **Empates dividem a posição** (1, 2, 2, 4); desempate de exibição por votos, nome e id (determinístico).
- **Cobertura** do BU do cargo no recorte (`coverage`): sem BU → lista vazia com o aviso; parcial → aviso de valores parciais.
- Metodologia e atualização (`methodology`, `freshness`) em todo resultado.
- Sem cor de partido, sem adjetivos, sem recomendação. "Ranking descreve dados oficiais; não é avaliação, recomendação ou previsão."

## 3. Testes

- Backend: `ElectoralBaseTests` (fórmula, classes, margens, General Sampaio, mudança/recomposição, vice), `RankingTests`
  (posições com empate, guardas, ausência ≠ zero, SQL contra PostGIS), `Contest_stats_rank_every_voted_candidate_number_per_territory`.
- ETL: `test_lake_contest_stats.py` (estatística da disputa por seção/local no lake).
- Frontend: `electoral-base.test.tsx` (decomposição, não classificado, 400/503, carregando sem zero, camada do mapa),
  `rankings.test.tsx` (URL ida e volta, cargos por ano, recorte incompatível sem consulta, empates, cobertura, vazio).
