# Data Intelligence

O módulo **Data Intelligence** combina indicadores socioeconômicos oficiais com os dados eleitorais já importados pelo REPBrasil. O objetivo é permitir exploração e comparação sem transformar ausência de dado em zero e sem sugerir causalidade onde existe apenas associação estatística.

## Modelo

A migration `015_socioeconomic.sql` cria três tabelas em `electoral`:

- `indicator`: catálogo dos indicadores;
- `socioeconomic_source`: proveniência de cada snapshot completo de um indicador/período, incluindo URL, dataset, instante de coleta, SHA-256 do conteúdo bruto adquirido e versão do parser;
- `indicator_value`: observações por município IBGE e período.

Cada linha de `socioeconomic_source` representa um **snapshot completo de um indicador em um período**. A leitura usa exclusivamente o snapshot mais recente. Assim, se uma reedição oficial retirar ou marcar um município como indisponível, a observação antiga não reaparece.

A ausência de uma observação é representada pela **ausência de uma linha no snapshot atual**. `0` só é armazenado quando a fonte oficial publicou zero.

Cada reedição oficial com conteúdo diferente recebe uma nova linha de fonte. O SHA-256 é calculado sobre os bytes adquiridos, não sobre observações normalizadas: alterações de metadados ou de marcadores de ausência continuam auditáveis. O mesmo conteúdo bruto para o mesmo indicador/período é idempotente.

## Primeira carga socioeleitoral oficial: Censo 2022

A primeira carga de produção foi desenhada especificamente para análises territoriais da eleição geral de 2022. O preset `censo2022-core` usa o mesmo período da eleição e ingere, no Ceará:

- `ibge.population`: população residente municipal do Censo 2022, SIDRA tabela 4709, variável 93;
- `ibge.literacy_rate_15_plus`: taxa municipal de alfabetização das pessoas de 15 anos ou mais, SIDRA tabela 9543, variável 2513;
- `derived.illiteracy_rate_15_plus`: complemento exato `100 - taxa de alfabetização`, mantendo a proveniência da resposta oficial utilizada.

A carga é executada por `python scripts/ingest_socioeconomic.py --preset censo2022-core --uf CE`.

Antes de gravar observações, o ETL baixa e valida os payloads oficiais completos. Para o Ceará ele exige exatamente os **184 municípios** já vinculados por código IBGE na base eleitoral, rejeita municípios ausentes ou duplicados, valida população positiva e taxas no intervalo de 0 a 100. Uma resposta parcial ou estruturalmente inesperada aborta a execução em vez de publicar um snapshot incompleto.

O objetivo desse recorte não é descrever eleitores individualmente, mas responder perguntas territoriais como: **em que tipos de municípios uma candidatura teve maior ou menor participação nos votos válidos?**

## Fontes

### IBGE / SIDRA

O parser reconhece a notação do SIDRA: `-` é zero verdadeiro; `..`, `...` e `X` significam valor ausente. Períodos, tabela e variável passam por validação numérica antes de compor a URL. O fetcher preserva os bytes da resposta para o hash de proveniência.

O catálogo não fixa um identificador de tabela/variável de PIB per capita sem confirmação da fonte. A carga registra PIB municipal em `R$ mil` e população; `derived.gdp_per_capita` só é calculado quando os dois valores são do mesmo município e período.

### Atlas do Desenvolvimento Humano

O parser aceita fixtures/arquivos oficiais previamente baixados e exige código IBGE de sete dígitos, período e valor. Nenhum valor sintético é enviado para produção. O IDHM municipal mantém o período publicado pela fonte; não é reetiquetado como se fosse contemporâneo de uma eleição posterior.

## API

- `GET /api/v1/data/indicators`
- `GET /api/v1/data/values?indicator=...&period=...&uf=CE`
- `GET /api/v1/data/correlation?xIndicator=...&yIndicator=...&period=...&uf=CE`
- `GET /api/v1/data/correlation?...&candidacyId=...&year=...&round=...&office=...`
- `GET /api/v1/data/clusters?indicator=...&period=...&uf=CE&k=3`

A correlação eleitoral valida se a candidatura pertence exatamente à eleição, cargo e UF solicitados **e se existe vínculo auditável `votable_candidacy` para a UF**. Sem vínculo, a consulta falha fechada. Uma candidatura validamente mapeada pode ter zero votos em um município; nesse caso zero é performance eleitoral observada, e não dado socioeconômico ausente convertido em zero.

A métrica eleitoral municipal é a participação da candidatura nos votos válidos do mesmo cargo e turno naquele município:

`100 × votos da candidatura / votos válidos do cargo`

## Estatística

A API devolve Pearson e Spearman, além de `N`, período e os pares observados. Empates de Spearman recebem posto médio. Se não houver pelo menos dois pares ou houver variância zero, o coeficiente é `null`.

O clustering usa K-means unidimensional determinístico: centróides iniciais por quantis ordenados, desempate pelo menor índice e no máximo 100 iterações.

> Correlação não implica causalidade. O resultado descreve associação nos municípios observados e não demonstra efeito causal.

### Limite de inferência: falácia ecológica

Os cruzamentos eleitorais são agregados por município. Portanto, uma associação como “a candidatura teve maior participação em municípios com maior taxa de analfabetismo” **não autoriza** a afirmação “pessoas analfabetas votam mais nessa candidatura”. O REPBrasil trata isso como uma limitação metodológica permanente da interface.

O perfil socioeleitoral apresenta o indicador municipal no eixo X e a participação da candidatura nos votos válidos no eixo Y, além de Pearson, Spearman, `N`, quintis territoriais e os municípios de maior participação. Todos os textos devem permanecer no nível territorial.

## Frontend

`/dados` exibe catálogo, período, dispersão, tabela dos pares, Pearson, Spearman, `N`, proveniência das observações e clusters. Estados sem dados são explícitos e nunca renderizados como zero. Os seletores impedem correlação de um indicador com ele mesmo.

O perfil do político possui a aba **Perfil socioeleitoral**, vinculada à candidatura selecionada. Para uma eleição com indicador municipal do mesmo período, a aba mostra dispersão, coeficientes e quintis. Quando não existe período comparável, a interface informa ausência de cobertura em vez de reaproveitar silenciosamente dados de outro ano.
