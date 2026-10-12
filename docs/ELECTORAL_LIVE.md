# Pesquisas eleitorais e apuração oficial

O PR J adiciona ao REPBrasil duas leituras distintas do ciclo eleitoral: **pesquisas registradas** e **snapshots oficiais de totalização**. Elas compartilham proveniência auditável, mas não compartilham significado. Pesquisa é estimativa amostral; totalização é observação oficial do processo de apuração.

## Fontes oficiais

### Pesquisas

A aquisição base usa o arquivo oficial anual do **Sistema PesqEle/TSE** publicado no Portal de Dados Abertos:

`https://cdn.tse.jus.br/estatistica/sead/odsele/pesquisa_eleitoral/pesquisa_eleitoral_<ANO>.zip`

O arquivo é preservado em bytes, com SHA-256, URL e versão do parser. ETag e `Last-Modified` podem ser usados em GET condicional; `304 Not Modified` não produz uma nova versão.

O parser abre somente o membro esperado `pesquisa_eleitoral_<ANO>_BRASIL.csv`, exige as colunas estruturais que utiliza e falha fechado se o layout necessário mudar. O registro é modelado por **ano/ciclo + cargo + escopo**, e não por turno: uma mesma pesquisa pode testar cenários de 1º e 2º turno. O turno só é associado a `poll_scenario` quando essa classificação vier de uma publicação auditável do resultado.

O registro no PesqEle comprova a existência e os metadados oficiais da pesquisa. Ele **não autoriza inventar percentuais de intenção de voto** quando o resultado publicado não está disponível em fonte auditada. Por isso uma pesquisa pode existir no REPBrasil com instituto, número de registro, datas de campo, amostra e metodologia, mas sem cenários/resultados. Margem de erro e nível de confiança permanecem ausentes quando não vierem de campo estruturado ou publicação auditável; não são extraídos heuristicamente de texto livre.

### Apuração

A apuração usa artefatos JSON oficiais do TSE em:

`https://resultados.tse.jus.br/oficial/...`

O parser cobre o contrato EA20 de resultado unificado e valida, antes da persistência:

- código da eleição (`ele`), turno (`t`) e cargo;
- fase oficial (`f = o`); artefatos de simulação não entram no banco;
- tipo e código de abrangência (`tpabr`, `cdabr`);
- instante de geração (`dg`, `hg`), quando publicado;
- andamento (`and`): `n` = não iniciada, `p` = parcial, `f` = final;
- seções totalizadas (`s`), preservando ausência;
- candidatura oficial por `sqcand`, número, nome de urna, posição, votos e percentual quando publicados.

Para 2026, o construtor conhece os códigos oficiais vigentes das Eleições Gerais:

| Turno | Família | CD_ELEICAO |
|---|---|---:|
| 1º | federal | 6257 |
| 1º | estadual | 6259 |
| 2º | federal | 6258 |
| 2º | estadual | 6260 |

Esses códigos não são aceitos apenas por tabela fixa: o loader também exige correspondência com `electoral.contest.tse_election_code`, cargo, eleição e turno já auditados no banco.

## Contrato de dados

A migration `018_polling_and_live_count.sql` adiciona sete tabelas:

- `poll_source`
- `poll_institute`
- `poll`
- `poll_scenario`
- `poll_result`
- `totalization_snapshot`
- `totalization_result`

### Regras permanentes

1. **Ausência nunca vira zero.** `NULL` continua `NULL` na API e aparece como `—` na interface. Zero só é exibido quando a fonte publicou zero.
2. **Pesquisa não é previsão nem resultado eleitoral.** A UI mantém a ressalva visível.
3. **Margem de erro é ponto percentual.** Só é exibida quando publicada por campo/fonte auditável; nível de confiança idem.
4. **Registro e turno são conceitos diferentes.** O registro pertence ao ciclo; o turno pertence ao cenário quando auditável.
5. **Cenários não são misturados.** Cada cenário preserva sua própria lista, ordem e turno opcional.
6. **Registro sem resultado é válido.** O REPBrasil não fabrica percentuais para preencher uma pesquisa registrada.
7. **Escopo é exato.** Brasil, UF e município são consultas diferentes; uma pesquisa nacional não é tratada como pesquisa estadual.
8. **Reedição oficial é snapshot completo por escopo.** A consulta usa somente a edição PesqEle mais recente daquele ano/escopo; se uma pesquisa deixa de constar de uma reedição, uma linha antiga não é ressuscitada.
9. **Totalização parcial não é final.** O status `not_started`, `partial` ou `final` é explícito.
10. **Snapshots são imutáveis por conteúdo.** O SHA-256 é calculado sobre os bytes oficiais adquiridos; conteúdo idêntico é idempotente e nova edição oficial preserva o histórico.
11. **Vínculo de candidatura é documental.** Resultado do TSE usa `SQ_CANDIDATO` dentro da eleição/cargo/código de eleição; pesquisa só aceita `candidacy_id` previamente auditado e compatível com ano/turno/cargo. Nunca nome ou fuzzy match.
12. **Sem serviço pago novo.** O módulo usa a infraestrutura existente.

## APIs públicas

### Pesquisas

`GET /api/v1/elections/polls`

Parâmetros:

- `year`
- `round`
- `office`
- `uf` opcional
- `municipalityTseCode` opcional e permitido somente com `uf`

O `round` filtra cenários classificados naquele turno. Um registro sem resultados/cenários continua visível porque o PesqEle registra a pesquisa do ciclo, não um resultado por turno. Se uma pesquisa tiver cenários explicitamente classificados apenas para o outro turno, ela não é mostrada como se tivesse cenário compatível.

A resposta inclui fonte, data de coleta, metadados metodológicos e cenários auditados. Para a fonte PesqEle, a API parte da edição completa mais recente do escopo (`BR`, `CE`, etc.); dentro dela, ausência de registro também é informação de versão e não permite recorrer silenciosamente a uma edição antiga.

### Apuração

`GET /api/v1/elections/live`

Usa os mesmos parâmetros de recorte. Serve somente o snapshot oficial auditado mais recente daquele recorte. Não reconstrói “ao vivo” a partir de BUs históricos.

O cache de saída é de **15 segundos**, variando por query e `Origin`, para reduzir carga sem mascarar por minutos uma atualização oficial.

## Interface

A rota `/pesquisas` reúne:

- filtros de turno, cargo, abrangência e município TSE;
- cards de pesquisas com registro, período de campo, amostra, margem, confiança, metodologia e fonte;
- cenários somente quando há resultados auditados;
- painel da apuração com selo **NÃO INICIADA**, **PARCIAL** ou **FINAL**;
- percentual de seções, contagens, horário oficial e horário de captura;
- resultado do snapshot sem completar lacunas com zero;
- link direto para a fonte oficial.

## Ingestão real

A migration não semeia observações sintéticas em produção.

### Registro PesqEle

O comando `etl/scripts/ingest_poll_registry.py` adquire o ZIP oficial, valida o CSV, normaliza os registros do escopo pedido e grava a edição inteira em uma transação. Se qualquer linha necessária falhar, a edição não fica parcialmente publicada no banco. Cada UF e `BR` têm sua própria chave de snapshot completo.

Ceará em 2026:

```bash
python scripts/ingest_poll_registry.py --year 2026 --uf CE
```

Pesquisas nacionais:

```bash
python scripts/ingest_poll_registry.py --year 2026 --uf BR
```

O importador não cria cenários nem percentuais a partir do arquivo de registro porque o conjunto aberto do PesqEle é metadado de registro/desenho da pesquisa, não uma tabela de intenção de voto por candidata ou candidato. Resultados só entram depois por fonte de publicação auditável.

### Apuração TSE

O comando `etl/scripts/ingest_live_results.py` usa `DATABASE_URL`, adquire o JSON oficial, valida o contrato EA20, calcula SHA-256 dos bytes recebidos e persiste um snapshot idempotente.

Uma captura única do 1º turno de governador no Ceará em 2026:

```bash
python scripts/ingest_live_results.py --year 2026 --round 1 --office 3 --uf CE
```

Modo de acompanhamento, consultando a fonte a cada 30 segundos e encerrando apenas quando o TSE publicar estado final:

```bash
python scripts/ingest_live_results.py --year 2026 --round 1 --office 3 --uf CE --watch-seconds 30 --until-final
```

Um município usa seu código TSE de cinco dígitos:

```bash
python scripts/ingest_live_results.py --year 2026 --round 1 --office 3 --uf CE --municipality-tse-code 13897
```

Para 2026, o comando resolve automaticamente o `CD_ELEICAO` a partir de turno/cargo e ainda o reconfirma contra o `contest` auditado no banco. Fora desse mapeamento, `--election-code` é obrigatório. Intervalos de acompanhamento menores que 15 segundos são recusados; respostas HTTP `304` não criam snapshots duplicados.

Até haver observações reais carregadas, `/pesquisas` deve mostrar os estados vazios previstos. A existência dos comandos não autoriza fabricar uma pesquisa, um resultado ou uma totalização nem executar contra ambiente de simulação.

## Smoke manual

Após deploy:

1. abrir `/pesquisas` em desktop e mobile, tema claro e escuro;
2. alternar 1º/2º turno, cargo e Ceará/Brasil;
3. confirmar que município só é usado com código TSE de cinco dígitos;
4. confirmar que ausência de pesquisa auditada é explicada, sem afirmar que “não existem pesquisas”;
5. confirmar que registro sem percentual continua visível;
6. confirmar margem em `p.p.` e confiança em `%` quando existirem;
7. confirmar `NÃO INICIADA`, `PARCIAL` e `FINAL` conforme o snapshot oficial;
8. confirmar que valores ausentes aparecem `—`, nunca `0`;
9. abrir os links de proveniência;
10. verificar Console/Network sem 500/503 inesperado e refresh direto sem 404.
