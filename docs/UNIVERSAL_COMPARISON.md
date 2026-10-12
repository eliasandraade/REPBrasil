# PR G — Busca, comparações, insights e exports

## Objetivo

Fechar a camada analítica e de compartilhamento do REPBrasil com o fluxo **achar → comparar → entender → compartilhar/exportar**, sem alterar os contratos permanentes de integridade dos dados.

## Comparador universal

A rota `/comparar` aceita no máximo cinco itens e compara apenas entidades do mesmo tipo:

- candidaturas × candidaturas;
- partidos × partidos;
- municípios × municípios;
- eleições × eleições.

Tipos diferentes não são colocados na mesma matriz. A relação entre candidatura e indicador socioeconômico continua sendo tratada pelo Perfil Socioeleitoral, onde o recorte, o período e a ressalva de falácia ecológica ficam explícitos.

A URL é a fonte de verdade dos filtros. Um link compartilhado deve reconstruir o mesmo recorte sempre que os mesmos dados oficiais continuarem disponíveis.

### Candidaturas

Reutiliza `/eleicoes/comparar`, que já aplica as guardas de disputa e território, suporta até cinco candidaturas e níveis estado, município, zona, seção e local de votação. O PR G acrescenta os quatro formatos de exportação ao contrato já existente.

### Partidos

Compara, dentro da mesma eleição, turno, cargo e UF:

- votos;
- participação nos votos válidos;
- candidaturas;
- eleitos;
- municípios com votos.

Partido que não disputou o recorte não recebe zero artificial.

### Municípios

A identidade municipal é resolvida exclusivamente pelo código IBGE. Nunca se faz join por semelhança de nome. O usuário pode escolher até cinco indicadores oficiais do Data Intelligence para um mesmo período.

### Eleições

Compara pleitos dentro da mesma UF e explicita a disponibilidade/cobertura dos datasets importados: cadastro, resultados e municípios cobertos. Indisponibilidade não é zero.

## Insights determinísticos

Insights são regras de código versionadas (`code/v1`) calculadas somente sobre valores auditáveis já exibidos. Exemplos iniciais:

- maior participação partidária;
- maior número de eleitos;
- maior presença territorial;
- maior valor observado de um indicador entre municípios selecionados;
- maior cobertura municipal entre pleitos selecionados.

Regras permanentes:

1. nenhuma IA generativa produz conclusão factual em runtime;
2. empate é preservado;
3. valor ausente fica fora do cálculo e continua ausente na interface;
4. um insight descreve a métrica, não classifica moralmente uma entidade;
5. correlação nunca é convertida em causalidade;
6. dado territorial nunca autoriza inferência sobre o comportamento individual do eleitor.

## Busca global

A busca continua determinística e agrupada. O backend preserva sua ordenação para políticos, lugares, eleições e partidos. O frontend acrescenta o catálogo oficial de indicadores já carregado pelo Data Intelligence, com regra simples e auditável: correspondência exata → prefixo → contém.

Atalhos existentes (`/`, `Ctrl+K`/`Cmd+K`, setas, Enter e Esc) são preservados. Resultado de indicador abre `/dados?x=<codigo>`, e o Data Explorer lê seus filtros da URL.

Parlamentares e emendas só entram na busca quando houver carga oficial ampla e uma API pública do domínio parlamentar; a existência do schema do PR F não é tratada como se o dataset já estivesse populado.

## Exports

Os formatos liberados são:

- CSV;
- XLSX;
- PDF;
- PNG.

O arquivo inclui, conforme o recorte:

- título e entidade comparada;
- filtros/período;
- fonte(s);
- metodologia;
- instante de geração;
- URL reproduzível;
- representação explícita de ausência (`—`) em vez de zero.

CSV, XLSX e PDF são gerados no próprio frontend sem serviço externo. O PNG usa Canvas no navegador e limita a visualização a 1.000 linhas quando necessário; CSV e XLSX preservam todas as linhas do relatório.

## Testes e gates

Antes do merge:

- lint, typecheck, testes e build do frontend;
- backend e banco sem regressão;
- ETL sem regressão;
- SonarCloud aprovado;
- GitGuardian aprovado;
- revisão de código sem finding aberto relevante;
- smoke de produção em busca, `/dados`, `/comparar` e `/eleicoes/comparar`.
