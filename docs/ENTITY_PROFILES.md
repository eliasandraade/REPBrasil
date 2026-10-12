# PR I — Entidades territoriais e perfil unificado

## Objetivo

Transformar estado, município e eleição em entidades navegáveis do REPBrasil, ligando em uma mesma experiência o catálogo eleitoral, os resultados do TSE, rankings, Data Intelligence e o explorador territorial.

O perfil não cria uma nova fonte de verdade. Ele agrega somente dados oficiais que já estejam importados e preserva as mesmas regras de comparabilidade das APIs existentes.

## URLs canônicas

- Estado: `/estados/<uf>` — exemplo: `/estados/ce`.
- Município: `/municipios/<uf>/<slug>` — exemplo: `/municipios/ce/fortaleza`.
- Eleição: `/eleicoes/<ano>/<turno>`.

Zona e seção continuam sendo níveis do explorador eleitoral e não viram páginas-entidade independentes.

## Estado

O perfil estadual reúne:

- linha do tempo dos pleitos do catálogo;
- disponibilidade de cadastro e de resultados em cada eleição;
- cobertura municipal;
- candidaturas e partidos em destaque em um cargo titular determinístico;
- cobertura dos indicadores socioeconômicos oficiais;
- diretório de municípios com links para seus perfis;
- atalhos para o explorador, rankings e comparador.

O cargo de destaque é escolhido por uma regra de código, nunca por opinião editorial. Em eleições gerais a preferência começa por Deputado Federal; em eleições municipais, por Prefeito. Vice e suplente não são usados como ranking de voto próprio.

## Município

A identidade municipal atravessa eleições usando código oficial: IBGE quando disponível, com código TSE preservado. Não existe ligação por similaridade de nome.

O perfil municipal reúne:

- códigos oficiais e UF;
- histórico dos pleitos em que o território foi localizado;
- zonas e seções do cadastro eleitoral;
- candidatos e partidos em destaque no recorte comparável;
- indicadores socioeconômicos com período, unidade, provedor e dataset;
- links para o explorador e para o comparador de municípios.

Para cada indicador é mostrada a observação oficial mais recente disponível. Isso não autoriza misturar períodos em correlações; análises comparativas continuam sujeitas às regras do Data Intelligence.

## Eleição

A raiz de cada eleição (`/eleicoes/<ano>/<turno>`) passa a funcionar também como perfil do pleito, sem substituir o explorador já existente. O resumo mostra:

- descrição e data do pleito;
- UFs com cadastro/resultados efetivamente carregados;
- quantidade observada de municípios cobertos;
- cargos presentes na cobertura importada;
- um recorte estadual destacado quando houver dados;
- rankings auditáveis e links para perfis estaduais;
- acesso imediato ao explorador e ao comparador.

Rotas profundas (`/eleicoes/<ano>/<turno>/<uf>/...`) continuam com a experiência territorial atual.

## Busca e navegação

Resultados de busca do grupo “Lugares” passam a abrir as páginas-entidade:

- estado → `/estados/<uf>`;
- município → `/municipios/<uf>/<slug>`.

Uma busca sem eleição importada continua sem link. Resultados específicos de eleição/cargo continuam levando ao explorador daquele pleito e território.

## SEO e sitemap

Os perfis recebem canonical, Open Graph e descrição baseada apenas nos dados localizados. O sitemap passa a incluir, quando a indexação estiver habilitada:

- raízes das eleições importadas;
- estados cobertos;
- municípios conhecidos pelo catálogo oficial;
- as URLs do explorador que já eram publicadas.

Ambientes sem `NEXT_PUBLIC_ALLOW_INDEXING=true` continuam fora do índice.

## Integridade dos dados

Regras permanentes:

1. ausência de dado nunca vira zero;
2. falha temporária de API não é apresentada como “sem dado” — vira estado indisponível;
3. município não é ligado entre fontes por nome;
4. rankings respeitam eleição, turno, cargo, UF e, quando necessário, município;
5. cargo municipal sem município não recebe ranking de votos absolutos entre disputas distintas; usa participação quando o recorte permitir comparação;
6. indicadores exibem seu próprio período e fonte;
7. associação territorial não permite inferência sobre características individuais do eleitor;
8. nenhuma conclusão causal é derivada de correlação.

## Teste humano após deploy

1. buscar `Fortaleza` e abrir o perfil `/municipios/ce/fortaleza`;
2. abrir `/estados/ce` e navegar para um município pelo diretório;
3. abrir `/eleicoes/2022/1` e confirmar o resumo do pleito acima do explorador;
4. navegar perfil → eleição → explorador → perfil e usar voltar/avançar;
5. conferir indicadores municipais, períodos e estados de ausência;
6. conferir rankings e links para políticos/partidos;
7. testar URLs diretas, refresh, mobile, light e dark;
8. validar que nenhum erro 500/503 aparece no fluxo normal.
