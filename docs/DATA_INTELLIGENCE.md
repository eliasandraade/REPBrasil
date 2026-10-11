# Data Intelligence

O módulo **Data Intelligence** combina indicadores socioeconômicos oficiais com os dados eleitorais já importados pelo REPBrasil. O objetivo é permitir exploração e comparação sem transformar ausência de dado em zero e sem sugerir causalidade onde existe apenas associação estatística.

## Modelo

A migration `015_socioeconomic.sql` cria três tabelas em `electoral`:

- `socioeconomic_source`: proveniência de cada arquivo/resposta importada, incluindo URL, dataset, instante de coleta, SHA-256 e versão do parser;
- `indicator`: catálogo dos indicadores;
- `indicator_value`: observações por município IBGE e período.

A ausência de uma observação é representada pela **ausência de uma linha**. `0` só é armazenado quando a fonte oficial publicou zero.

Cada reedição oficial recebe uma nova linha de fonte. O loader é idempotente para o mesmo SHA-256 e preserva versões anteriores para auditoria.

## Fontes

### IBGE / SIDRA

O parser reconhece a notação do SIDRA: `-` é zero verdadeiro; `..`, `...` e `X` significam valor ausente. Períodos, tabela e variável passam por validação numérica antes de compor a URL.

O catálogo não fixa um identificador de tabela/variável de PIB per capita sem confirmação da fonte. A carga registra PIB municipal em `R$ mil` e população; `derived.gdp_per_capita` só é calculado quando os dois valores são do mesmo município e período.

### Atlas do Desenvolvimento Humano

O parser aceita fixtures/arquivos oficiais previamente baixados e exige código IBGE de sete dígitos, período e valor. Nenhum valor sintético é enviado para produção.

## API

- `GET /api/v1/data/indicators`
- `GET /api/v1/data/values?indicator=...&period=...&uf=CE`
- `GET /api/v1/data/correlation?xIndicator=...&yIndicator=...&period=...&uf=CE`
- `GET /api/v1/data/correlation?...&candidacyId=...&year=...&round=...&office=...`
- `GET /api/v1/data/clusters?indicator=...&period=...&uf=CE&k=3`

A correlação eleitoral valida se a candidatura pertence exatamente à eleição, cargo e UF solicitados. Mismatch retorna `400`; não vira participação zero.

## Estatística

A API devolve Pearson e Spearman, além de `N`, período e os pares observados. Empates de Spearman recebem posto médio. Se não houver pelo menos dois pares ou houver variância zero, o coeficiente é `null`.

O clustering usa K-means unidimensional determinístico: centróides iniciais por quantis ordenados, desempate pelo menor índice e no máximo 100 iterações.

> Correlação não implica causalidade. O resultado descreve associação nos dados observados e não demonstra efeito causal.

## Frontend

`/dados` exibe catálogo, período, dispersão, tabela dos pares, Pearson, Spearman, `N`, proveniência das observações e clusters. Estados sem dados são explícitos e nunca renderizados como zero.
