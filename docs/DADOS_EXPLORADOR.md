# Explorador territorial (`/dados`)

O mapa é o protagonista: uma instância persistente de Brasil → UF → município, com a tabela equivalente logo abaixo e um painel "o que você vê". Tudo o que a tela mostra está na URL. A disponibilidade vem da API; onde não há dado, a tela diz isso, e a malha oficial continua navegável.

## Estado na URL

| Parâmetro | Significado |
|---|---|
| `uf` | Sigla da UF. |
| `municipio` | Código IBGE (7 dígitos). Sem `uf`, a UF sai do próprio código; de outra UF, é descartado. |
| `modo` | `socioeconomico` (padrão), `eleitoral` ou `emendas`. |
| `vista` | `mapa` (padrão), `relevo`, `intensidade` ou `comparar`. |
| `x`, `y`, `periodo` | Indicador principal, segundo indicador e período (modo socioeconômico). |
| `ano`, `turno`, `cargo` | Pleito e cargo (eleitoral). `ano` também é o ano das emendas. |
| `metrica` | `empenhado` (padrão), `pago` ou `quantidade` (emendas). |
| `antes` | Lado "antes" da comparação: `ano:turno` (eleitoral) ou `ano` (emendas). |

Trocar de território empilha no histórico (o "voltar" do navegador sobe um nível); trocar de recorte substitui. Links antigos (`/dados?x=&periodo=`, usados pelos alertas de indicador) continuam abrindo o modo socioeconômico.

## Disponibilidade

`GET /api/v1/data/coverage` (público, em cache) devolve, por UF:
- indicadores vigentes por período e quantos municípios têm valor;
- pleitos com Boletim de Urna carregado e quantos municípios;
- anos de emendas da edição vigente: total de emendas destinadas à UF (com ou sem município identificado) e quantos municípios foram identificados por código IBGE.

Lista vazia = nada carregado. Indicador do catálogo sem valor na UF aparece desabilitado ("sem dados nesta UF"); nada é deduzido de outra fonte.

Ausência só é dita com a cobertura em mãos. Enquanto ela chega, ou se a consulta falha:
- o painel diz "verificando" ou "não foi possível verificar";
- as listas de escolha dizem "carregando" ou "indisponível agora";
- a tabela continua navegável, com os valores "carregando" ou "indisponíveis", nunca "sem dado".

O mesmo vale para os valores de cada modo.

## Geometria

As malhas municipais oficiais do IBGE (API de malhas v3, qualidade "minima") das 27 UFs ficam em `frontend/public/geo/municipios/<UF>.json`. Cada arquivo tem SHA-256, bytes e contagem em `meta.json`, e uma UF só é baixada quando entra em cena.

Município que existe nas localidades do IBGE mas ainda não tem polígono na malha publicada fica registrado em `meta.json` (hoje: Boa Esperança do Norte/MT). Ele aparece na tabela e não é desenhado.

Para regenerar: `node frontend/scripts/fetch-ibge-geo.mjs`. O teste `tests/territory-geo.test.ts` confere cada arquivo contra a proveniência.

## Modos

- **Socioeconômico:**
  - indicador por município em classes de quantil (cada cor reúne uma parte igual dos municípios com dado; a legenda mostra os limites reais);
  - leitura rápida em frases (faixa, mediana, posição);
  - comparação X × Y com a associação em linguagem simples, o que ela mostra e o que não prova;
  - com menos de 10 municípios com os dois dados, a força da associação não é rotulada (a matriz mostra o coeficiente sem cor);
  - a vista de comparação mostra dois indicadores do mesmo período lado a lado, por isso se chama "Lado a lado" neste modo;
  - agrupamentos, matriz (plano) e exportações (plano).
- **Eleitoral:**
  - candidatura mais votada em cada município, em paleta neutra pela ordem da legenda, nunca cor de partido;
  - empate na primeira colocação aparece como empate, nunca como candidatura, e fica fora da contagem das mais votadas;
  - antes/depois: o lado "antes" é sempre um pleito anterior (por padrão, o mais próximo); no pleito mais antigo carregado, a tela explica que não há anterior;
  - o *perfil socioeleitoral* cruza a parcela de votos válidos de duas candidaturas com um indicador do mesmo ano ("nos municípios com maior taxa de analfabetismo, A teve, em média, parcela maior dos votos válidos") e compara as duas pontas (20% dos municípios em cada);
  - é leitura por município, nunca por pessoa, e a tela diz isso;
  - cargos municipais não entram no cruzamento (cada município tem a própria disputa);
  - regras, limites e alternativas: [ADR-008](adrs/ADR-008-leitura-simples-e-cruzamento-territorial.md) (aceito).
- **Emendas:**
  - valor empenhado, valor pago ou quantidade por município e ano;
  - soma parcial (emenda sem valor publicado) fica sem cor e é dita no detalhe;
  - a soma do painel é só dos municípios com valor completo e diz quantos ficaram fora;
  - antes/depois: o lado "antes" é sempre um ano anterior; no ano mais antigo carregado, a tela explica que não há anterior;
  - só entram emendas com o código IBGE oficial do município;
  - linha do tempo: escolher um ano é aberto a todos; reproduzir a série (uma consulta, transição cruzada entre anos) é do plano.

## Os 20 efeitos

| # | Efeito | Situação |
|---|---|---|
| 01 | Extrusão | Relevo 3D com altura proporcional ao valor, nota na legenda, câmera inclinada. Fora do celular. Plano Avançado. |
| 02 | Hover com elevação | Contorno e véu sobre os demais territórios, entrando com atraso curto. |
| 03 | Câmera Brasil → UF → município | `survey`/`traverse` com a curva `traverse`; Reduced Motion corta seco. |
| 04 | Fronteiras progressivas | Contorno da seleção traçado (largura e opacidade). |
| 05 | Coroplético animado | Transição cruzada entre duas camadas (A/B) a cada troca de recorte. |
| 06 | Pulso por dado | Anel único nos 5 maiores valores, só em grandeza somável, só na chegada do dado. Nunca em laço; nunca com Reduced Motion. |
| 07 | Arcos/fluxos | **Omitido:** não existe dado de fluxo entre territórios. |
| 08 | Pontos semânticos | Locais de votação continuam no explorador eleitoral. Capitais **omitidas**: não há cadastro de capital carregado. |
| 09 | Mapa de calor | Pontos internos calculados da malha oficial, só em grandeza somável. Plano Avançado. |
| 10 | Rótulo inteligente | Dentro do mapa, evitando a seleção, com unidade e período. A seleção fixa a leitura no painel. |
| 11 | Holofote | Território escolhido em destaque, resto com contraste reduzido (também no lado "antes"). |
| 12 | Troca entre modos | Transição cruzada mantendo câmera e seleção. |
| 13 | Linha do tempo | Emendas (anos carregados). Socioeconômico **omitido**: há um período por indicador hoje. |
| 14 | Replay de apuração | **Omitido:** não há snapshots de apuração em produção. |
| 15 | Antes/depois | Divisor (`input range`, teclado); mesmo cargo num pleito anterior ou um ano anterior de emendas (escala comum). O lado "antes" nunca é posterior. No socioeconômico, dois indicadores do mesmo período ("Lado a lado"). Plano Avançado. |
| 16 | Enquadramento automático | `cameraForBounds` da seleção com margem para os controles e a legenda. |
| 17 | Mapa ↔ interface | Hover/foco na tabela destaca no mapa e o hover no mapa destaca a linha. |
| 18 | Revelação de texto | Leitura rápida em sequência curta; valor por troca com máscara (`value-swap`), sem contagem. |
| 19 | Elemento compartilhado | Nome do território no painel → `<h1>` do perfil do município ou da UF. |
| 20 | Microinterações | Controle segmentado, traço de consulta no mapa, retorno de ação na exportação. |

## Acessibilidade e alternativas

- A tabela é o caminho pelo teclado: um item focável por vez, com setas, Home/End e Enter. Também é o caminho sem WebGL, porque o mapa diz quando não está disponível.
- Gestos cooperativos: rolar a página sobre o mapa não vira zoom (Ctrl/⌘ + rolagem; dois dedos no celular).
- Reduced Motion: câmera e camadas cortam seco, e não há pulso.

## Testes

- `frontend/tests/territory-lib.test.ts`: URL, escalas, ponto interno, rótulo, leituras, cobertura, camadas, preposições e movimento.
- `frontend/tests/data-explorer.test.tsx`:
  - disponibilidade no Brasil e na UF sem dado;
  - cobertura ainda desconhecida (consultando ou falha) nunca vira "sem dado";
  - Brasil → UF → município → volta;
  - leitura, comparação e causalidade;
  - ferramentas do plano para anônimo e para assinante;
  - eleitoral: empate, antes/depois só com pleito anterior;
  - emendas: soma só dos valores completos, antes/depois só com ano anterior;
  - lista pelo teclado, valores ainda não conhecidos e ordem que segue a medida sem perder o filtro.
- `frontend/tests/territory-canvas.test.tsx`: sem WebGL.
- `frontend/tests/territory-geo.test.ts`: malhas e proveniência.
- Backend: `AccountFlowDataToolsTests` e `DataExplorerUnitTests`.
