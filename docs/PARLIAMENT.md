# Parlamento — identidade, edições e ausência de dados

Contrato da camada parlamentar (`electoral.parliament_*`, `/api/v1/parliament/*`, `/parlamento`).

## Identidade

- Parlamentares são entidades próprias, identificadas pelo identificador oficial da instituição
  (`camara`, `senado`, `alece` + `external_id`).
- O vínculo entre parlamentar e pessoa/candidatura do cadastro eleitoral só existe com evidência
  documental auditada (`identity_method = official_document` + hash do documento oficial; ver
  `017_parliament.sql`). Sem essa evidência o parlamentar fica `unlinked`.
- **Nome nunca é identidade.** Nem nome civil, nem nome de urna, nem nome parlamentar, normalizado
  ou não, com ou sem UF/partido. O antigo pipeline de "matching" Câmara↔TSE por nome
  (`etl/src/sources/camara/normalizer.py`, `deputies.py`, `scripts/seed_camara_deputados.py`) foi
  removido: ele gravava `Politicians.CamaraId` e `Mandates` a partir de nome + UF (+ partido).
  Verificado em 13/10/2026: nenhum dos 467 candidatos a deputado federal do CE em produção tinha
  `camaraId`, ou seja, o vínculo por nome não estava exposto; o código que podia criá-lo deixou de
  existir.
- O autor textual de uma emenda (`author_name`) é exibido como publicado pela fonte; ele não cria
  vínculo com parlamentar. `author_member_id` só é preenchido a partir de um mapeamento auditado.

## Edições

- Cada `(provider, dataset)` de `parliament_source` é uma edição **completa** do seu recorte,
  identificada pelo SHA-256 dos bytes oficiais.
- As leituras de emendas (`/amendments`, `/amendments/map`, `/amendments/years`) usam somente a
  edição mais recente de cada dataset, decidida em `parliament_source` **antes** de olhar as emendas.
  Uma edição vigente sem nenhuma emenda é ausência oficial no recorte: nada da edição anterior
  aparece. Uma emenda que deixou de aparecer na edição oficial mais nova não "ressuscita".
- Edições anteriores nunca são apagadas: continuam no banco, com a URL e o hash de origem, para
  auditoria.

## Recorte territorial

- O recorte de UF de `/amendments` é o escopo oficial da edição, gravado pela ingestão em
  `parliament_source.metadata.uf` a partir dos códigos IBGE oficiais da fonte (município ou UF). Nada
  é derivado de `locality`, do nome do dataset ou de nome de lugar.
- `/amendments?uf=CE` lista **todas** as emendas da edição vigente do CE, inclusive as que a fonte
  publica só com a UF (`municipalityIbgeCode = null`). O município ausente continua ausente.
- `/amendments/map` só agrega emendas com código IBGE oficial de município, da edição vigente da UF.

## Totais e listagens

- `/activities` e `/amendments` são listagens limitadas (até 100 e 200 linhas na interface). Nenhuma
  delas serve de contagem.
- `/activities/count` devolve `{ "total": N }` para o mesmo recorte de `/activities`; "Atos no
  recorte" usa esse total, e a lista informa quando exibe só parte dele.
- `/amendments/years` devolve todos os anos com emenda na edição vigente do recorte; o seletor de
  ano de `/parlamento` usa essa lista, nunca os anos da listagem limitada.

## Ausência de dados

- Valor empenhado/pago não publicado fica `NULL`/"—"; nunca vira zero.
- O mapa por município soma somente valores publicados e informa quantas emendas ficaram sem valor
  (`committedAmountMissing`, `paidAmountMissing`). Soma parcial aparece identificada no texto
  ("soma parcial: N emendas sem valor publicado") e não entra na escala de cor; só totais completos
  são coloridos.
- Município só é associado a uma emenda quando a fonte publica o código IBGE oficial de 7 dígitos;
  `locality` textual nunca é convertido em município.
- Sem dados carregados, `/parlamento` diz explicitamente que nada foi carregado ("Nenhum ato oficial
  carregado para este recorte") em vez de afirmar zero atividade.

## Ingestão (operação explícita)

`etl/scripts/ingest_parliament.py` carrega uma UF a partir das fontes oficiais e só escreve em
`electoral.parliament_*`. Não roda no deploy: é uma operação auditável, como a ingestão de
pesquisas.

```bash
DATABASE_URL=... python scripts/ingest_parliament.py --uf CE --legislature 57
```

| Etapa | Fonte oficial | Dataset (`parliament_source`) |
|---|---|---|
| Deputados federais da UF | Câmara `/deputados?siglaUf=&idLegislatura=` + `/deputados/{id}` (`ultimoStatus`) | `deputados:CE:legislatura-57` |
| Proposições de autoria | Câmara `/proposicoes?idDeputadoAutor=&ano=` (um ano por consulta; a API recusa intervalos de datas maiores que 3 meses) | `proposicoes:deputado-{id}` |
| Emendas destinadas à UF | Portal da Transparência, `EmendasParlamentares.zip` → `EmendasParlamentares.csv` | `emendas-parlamentares:CE` |

- O detalhe do deputado publica CPF e dados pessoais: nada disso é guardado (`raw` leva só os
  campos usados).
- Download de emendas: redirecionamentos seguidos à mão (no máximo 5). A URL inicial e cada
  `Location` são validadas **antes** da requisição: só HTTPS, porta padrão, sem credenciais na URL e
  host exatamente `portaldatransparencia.gov.br` ou `dadosabertos-download.cgu.gov.br`; nenhum outro
  host chega a ser contatado. A URL final oficial vai para a proveniência.
- O ZIP é pedido sem codificação de transporte e lido em streaming com teto rígido de 200 MB:
  `Content-Length` acima do teto é recusado antes de ler o corpo, e um corpo sem tamanho declarado é
  interrompido assim que passa do teto. O CSV dentro do ZIP tem teto próprio (600 MB declarados).
- Layout oficial verificado em 13/10/2026: Latin-1, `;`, "Sem informação" como ausência, código de
  município em `Código Município IBGE`, UF em `Código UF IBGE` (`2300000`); `-1`/`-14` são
  escopos oficiais não estaduais (Nacional/Exterior/região, Múltiplo) e não pertencem a nenhuma UF.
- Linhas sem código oficial de emenda não viram emenda (contadas em
  `rows_without_official_identifier` nos metadados da edição). Um código dividido em várias linhas
  orçamentárias é uma emenda: valores somados só se todos foram publicados.
- O resumo JSON impresso traz contagens por etapa; os metadados da edição de emendas guardam
  `last_modified`, linhas lidas, no recorte, sem identificador e com município.

## Testes

- `backend/tests/RepBrasil.Tests/Electoral/ParliamentRepositoryTests.cs` (banco de teste do CI):
  edição vigente por dataset, edição vigente vazia sem ressuscitar a anterior, emenda só com UF
  listada e fora do mapa, outra UF fora do recorte, anos além do limite da listagem, total de atos
  além do limite, histórico preservado, somas com contagem de ausentes, filtro de ano.
- `frontend/tests/parliament.test.ts`: texto do mapa para total completo, soma parcial e ausência.
- `frontend/tests/parliament-hub.test.tsx`: seletor com todos os anos da edição vigente e "Atos no
  recorte" com o total da API, nunca o tamanho da listagem.
- `etl/tests/sources/camara/test_activity.py` e `etl/tests/sources/transparencia/test_amendments.py`:
  parsers fail-closed, código IBGE oficial obrigatório, dinheiro ausente não vira zero.
- `etl/tests/pipeline/test_parliament_download.py`: redirecionamento fora da lista, com downgrade
  para HTTP, credenciais ou porta estranha recusado sem que o host seja contatado; limite de saltos;
  `Content-Length` acima do teto recusado antes de ler o corpo; corpo sem tamanho cortado no teto.
