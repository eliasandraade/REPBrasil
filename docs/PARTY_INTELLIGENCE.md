# Partidos e força partidária

> Escopo: Ceará (multi-UF por construção). Só dados oficiais do TSE. Sem classificação ideológica, sem cor de partido,
> sem inferir fusões ou continuidade entre siglas.

## 1. Identidade

- O partido é identificado pela **sigla oficial do TSE** (`SG_PARTIDO`), normalizada para o endereço: sem acento,
  minúsculas, só letras e números (`PC do B` e `PCdoB` → `/partidos/pcdob`; `UNIÃO` → `/partidos/uniao`).
- O **número** de cada eleição fica registrado (`identity[]`); se a sigla usou mais de um número, a página avisa.
- **Fusões, incorporações e mudanças de sigla não são inferidas**: siglas diferentes são partidos diferentes.
- **Federação** aparece como informação da candidatura; votos e candidaturas contados são do partido.
- `/partido/:slug` redireciona para `/partidos/:slug` (308).

## 2. Fatos e métricas

| Item | Definição | Fonte |
|---|---|---|
| Votos | nominais nos números do partido (votável do BU) + **legenda** nos cargos proporcionais (Dep. Federal/Estadual/Distrital, Vereador) | Boletim de Urna (`votable_zone_votes_current`, híbrido quente + arquivado) |
| Válidos | nominais + legenda do cargo no recorte | `zone_office_totals_current` |
| Participação | votos ÷ válidos | derivada |
| Candidaturas / eleitos | candidaturas titulares do partido no cargo (vice e suplentes fora) / resultado oficial "eleita" | TSE — Candidatos |
| Variação | eleição anterior **importada** do mesmo cargo e turno, só com BU completo nas duas | derivada |

Regras invariantes:

- **Sem BU do cargo → votos e participação ausentes** (nunca zero). A lista mostra os partidos pelas candidaturas.
- Votos do partido vêm do próprio BU (número do votável) — **não dependem do vínculo de identidade** das candidaturas.
- Cargo municipal: município **sem candidatura do partido** = "não estava na urna" (sem cor no mapa, fora dos destaques);
  com candidatura e nenhum voto = **zero real**.
- Presidente: votos na UF; candidaturas e eleitos são nacionais.

## 3. API

- `GET /api/v1/parties?uf=CE` → `elections[]` (cargos e se há BU), `parties[]` (slug, sigla, nome, números, resultados por
  eleição × cargo com variação), `methodology`, `definitions`, `freshness`.
- `GET /api/v1/parties/{slug}?uf=CE&year=&round=&office=` → identidade por eleição, resultados, `detail` (municípios com
  maior e menor participação, candidaturas com mais votos, cobertura do BU), notas. 404 = sigla sem candidatura na UF;
  400 = o partido não disputou a eleição × cargo pedidos.
- Mapa: `GET /api/v1/elections/{year}/{round}/states/{uf}/map?layer=party&office=&party=` (número do partido); com
  `municipality=` o nível passa a zona.

## 4. Telas

- `/partidos` — eleição (padrão: a mais recente com BU), cargo, ordenação (votos, eleitos, candidaturas) na URL.
- `/partidos/[slug]` — resultados por eleição × cargo (clique escolhe o detalhe), municípios, candidaturas, registro
  oficial, "Ver no mapa" (`/eleicoes/{ano}/{turno}/{uf}?camada=party&cargo=&partido=`).
- Explorador eleitoral: camada **Partido** (cargo + partido), escala sequencial de um matiz.
- Rankings: tipo "Partidos mais votados" (`docs/ELECTORAL_BASE.md` §2).

## 5. Testes

Backend `PartyTests` (sigla/slug, ausência ≠ zero, variação comparável, municípios fora da disputa, mapa, 404/400, SQL
contra PostGIS com voto de legenda e partido sem candidatura). Frontend `parties.test.tsx` (padrão com BU, sem BU sem
zeros, variação, perfil, URL, 404, camada do mapa).
