# Inteligência eleitoral — arquitetura

O REPBrasil passa a responder, numa só plataforma: **quem é o político, como atua, como foi
eleito, onde recebeu votos**. A camada eleitoral é nativa do REPBrasil — mesma API .NET, mesmo
ETL Python, mesmo banco PostgreSQL, mesmo design system. A origem técnica (projeto Urnaí) está
registrada em [URNAI_MIGRATION.md](URNAI_MIGRATION.md).

## Separação de conceitos

```text
public."Persons"          identidade humana canônica (HMAC do CPF — TSE_IDENTITY.md)
  │
  ├── public."Politicians"   perfil político do REPBrasil (estado atual, Score, Câmara, bens…)
  │
  ├── electoral.candidacy    candidatura oficial (SQ_CANDIDATO) numa disputa: partido, número,
  │                          cargo e situação DAQUELA eleição
  │       └── electoral.contest   disputa: CD_ELEICAO + cargo + unidade eleitoral (BR ou UF)
  │               └── electoral.election   pleito + turno (ex.: Eleições Gerais 2026, 1º turno)
  │
  └── public."Mandates"      exercício de mandato (Câmara)

electoral.section_office_result / section_office_vote   votos por urna × cargo (Boletim de Urna)
electoral.votable_candidacy                            enriquecimento: votável do BU → candidatura
```

| Conceito | Não é |
|---|---|
| `Person` | um perfil, uma candidatura ou um mandato |
| `Politician` | uma candidatura (partido/cargo atuais não são histórico) |
| `Candidacy` | uma pessoa (SQ_CANDIDATO muda a cada eleição) |
| `ElectionResult` (legado, público) | voto por seção — continua como resumo agregado por candidato de 2024 |
| voto (`section_office_vote`) | algo que depende de identidade: o vínculo com o perfil é camada extra |

**Regras de produto**

- Dado eleitoral é descritivo: **não melhora nem piora o Score**. A metodologia do Score não foi
  tocada.
- FATO (votos do BU) ≠ MÉTRICA DERIVADA (participação nos válidos) ≠ CORRELAÇÃO ≠ SCORE. A API
  devolve `definitions` explicando cada um.
- Falha de mapa, perfil, identidade ou Score nunca altera voto.

## Componentes

```text
TSE (Dados Abertos) ─┬─ municipio_tse_ibge.zip ──────────┐
                     ├─ eleitorado_local_votacao_<ano> ──┤   etl/src/electoral (Python, psycopg 3)
                     ├─ bweb_<turno>_<UF>_*.zip (BU) ────┼─> schema electoral (PostGIS) ─> API .NET ─> Next.js /eleicoes
                     ├─ consulta_cand_<ano>.zip ─────────┤                                  └──> /politico/[id] (aba Desempenho eleitoral)
                     └─ historico_candidatura_<ano>.zip ─┘
IBGE (malhas v3) ──────────────────────────────────────────> frontend/public/geo (MapLibre)
```

### Banco

- Schema **`electoral`** (PostgreSQL + PostGIS), criado pela migration EF aditiva
  `AddElectoralIntelligence`, que aplica SQL versionado em
  `backend/src/RepBrasil.Infrastructure/Persistence/Electoral/Sql/` (001–004). Esses arquivos
  são a fonte única: os testes do ETL recriam o schema com eles. Um script aplicado é imutável;
  mudanças entram em `005_*.sql` + nova migration.
- Nenhuma tabela de `public` foi alterada além de um índice único parcial em
  `Persons (DocumentType, NormalizedDocumentHash)` (`AddPersonDocumentHashIndex`).
- Entidades EF `ElectionEvent`, `Contest`, `Candidacy` são mapeadas com
  `ExcludeFromMigrations` (o schema vem do SQL). Leituras de volume usam SQL explícito em
  `ElectoralReadRepository`.
- Extensões em `public` (`postgis`, `pgcrypto`, `pg_trgm`). O ETL conecta com
  `search_path = electoral, public`.
- **Requer PostGIS no servidor.** O compose local usa `postgis/postgis:16-3.4`. O PostgreSQL do
  Railway (18.6) precisa de um serviço com PostGIS antes de aplicar a migration.

### ETL (`etl/src/electoral`)

- Portado sem mudança de semântica: aquisição content-addressed com hashes e manifesto,
  território TSE↔IBGE, cadastro (zonas, locais, seções, agregações), BU (layout estrito,
  normalização, reconciliação com o cadastro, uma transação por zona, idempotência por
  impressão digital), EA11/EA12/EA16/EA18/EA20 e ASN.1.
- Sincronização estadual (`state_sync`) na versão corrigida (PR #13 do Urnaí): o CSV oficial
  NÃO é agrupado por município × zona; dois passes, contagem por escopo no preflight,
  distribuição em arquivos temporários por escopo com memória limitada, e o segundo passe
  precisa reproduzir exatamente as contagens do preflight.
- Novo: `candidates/` — disputas, candidaturas, identidade e vínculo votável→candidatura.

### API (.NET, `/api/v1`)

| Rota | Conteúdo |
|---|---|
| `GET /elections` | pleitos/turnos com disponibilidade de cadastro e resultados |
| `GET /elections/{ano}/{turno}/states` | UFs: `territoryKnown`, `cadasterAvailable`, `resultsAvailable` |
| `GET …/states/{uf}/municipalities?q=` | municípios da UF (busca por nome sem acento ou código) |
| `GET …/municipalities/{municipio}` | zonas + resumo + proveniência do cadastro (slug, TSE ou IBGE) |
| `GET …/municipalities/{municipio}/zones/{zona}` | locais com seções (principal seguida das agregadas) |
| `GET …/zones/{zona}/sections/{secao}/results` | resultado oficial da urna × cargo, filtros, proveniência, candidatura vinculada |
| `GET /elections/candidacies/{id}` | candidatura + desempenho por município |
| `GET /politicians/{id}/candidacies?top=` | candidaturas do perfil com desempenho |

Território sem cadastro responde `status: "cadaster_missing"` (200), não 404. Divergência de
agregação entre fonte e cadastro responde 500 `integrity_error` — nunca um dado "vazio".

### Frontend (`/eleicoes`)

- `/eleicoes/:ano/:turno[/:uf[/:municipio[/zona/:n[/secao/:n]]]]` — a URL é a fonte de verdade
  (deep link, refresh, voltar/avançar). Cargo (`cargo`) e tipo de voto (`tipo`) em search params.
- Uma zona ⇒ seleção automática (`router.replace`, sem laço no voltar); várias ⇒ o usuário
  escolhe. Seção agregada ⇒ aponta para a urna principal, sem votos próprios.
- Candidato com candidatura vinculada ⇒ link para `/politico/{id}?aba=eleicoes`; sem vínculo ⇒
  voto visível, marcado "perfil não vinculado".
- MapLibre 6 com malhas oficiais do IBGE (`public/geo`, proveniência em `meta.json`); cores
  neutras (destaque = dado disponível, nunca vencedor); pinos só com coordenada oficial;
  Reduced Motion respeitado; sem WebGL as listas continuam funcionando.

## Desempenho e cache

- Consultas filtram pelo lote vigente de cada zona (nunca somam versões de fonte).
- Índices adicionados: `section_office_vote(votable_id)`,
  `section_office_result(uf, municipality_tse_code, zone, office_code)`, candidatura por
  disputa/número/pessoa/perfil.
- Sem Redis nesta etapa (nada medido que justifique). Se entrar, a chave precisa incluir o lote
  (`import_batch_id`) para nunca esconder versão de fonte.

## Grafo (futuro, sem migração agora)

Os IDs permitem projetar, sem duplicar pessoas por eleição:
`Person -CANDIDATE_IN-> Contest` (via `candidacy`), `Person -MEMBER_OF-> Party` (partido da
candidatura, com o ano), `Person -HOLDS-> Mandate`, `Person -RECEIVED_VOTES_IN-> Territory`
(agregado de `section_office_vote` por município).
