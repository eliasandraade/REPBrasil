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
- As leituras de emendas (`/amendments`, `/amendments/map`) usam somente a edição mais recente de
  cada dataset. Uma emenda que deixou de aparecer na edição oficial mais nova não "ressuscita" da
  edição anterior.
- Edições anteriores nunca são apagadas: continuam no banco, com a URL e o hash de origem, para
  auditoria.

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

## Testes

- `backend/tests/RepBrasil.Tests/Electoral/ParliamentRepositoryTests.cs` (banco de teste do CI):
  edição vigente por dataset, histórico preservado, somas com contagem de ausentes, filtro de ano.
- `frontend/tests/parliament.test.ts`: texto do mapa para total completo, soma parcial e ausência.
- `etl/tests/sources/camara/test_activity.py` e `etl/tests/sources/transparencia/test_amendments.py`:
  parsers fail-closed, código IBGE oficial obrigatório, dinheiro ausente não vira zero.
