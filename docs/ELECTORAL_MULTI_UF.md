# Inteligência eleitoral multi-UF

## Problema

O Boletim de Urna identifica um votável por eleição, cargo, tipo e número. Esse conjunto não é globalmente único no Brasil: em disputas estaduais, o mesmo número pode representar candidaturas diferentes em UFs distintas.

Enquanto o REPBrasil continha apenas o Ceará, `electoral.votable` usava a chave:

`CD_ELEICAO + cargo + tipo + NR_VOTAVEL`

Carregar uma segunda UF poderia, portanto, reutilizar indevidamente um votável do Ceará ou interromper a importação ao encontrar atributos diferentes.

## Contrato a partir da migration 005

A identidade persistida de `electoral.votable` passa a ser:

`UF do BU + CD_ELEICAO + cargo + tipo + NR_VOTAVEL`

A UF é a UF da seção/urna que originou o voto. Isso vale também para cargos de abrangência nacional: um candidato a Presidente pode ter um registro de `votable` por UF. A candidatura continua sendo uma entidade única da disputa `BR`; a duplicação por UF existe apenas na camada de representação do BU e evita compartilhar estado mutável entre cargas estaduais.

O vínculo BU → candidatura continua determinístico: a UF da seção delimita os votáveis e a disputa aplicável; cargos nacionais resolvem para a unidade eleitoral `BR`, enquanto cargos estaduais resolvem para a própria UF.

## Migração dos dados existentes

`005_votable_uf_identity.sql` é propositalmente fail-closed:

1. adiciona `votable.uf` inicialmente anulável;
2. verifica se algum votável legado aparece em resultados de mais de uma UF;
3. deriva a UF exclusivamente de `section_office_vote → section_office_result.uf`;
4. interrompe a migration se algum votável não tiver proveniência de seção;
5. torna `uf` obrigatória;
6. substitui a restrição única legada pela identidade multi-UF.

Nenhum voto é recalculado, movido ou agregado pela migration. `section_office_vote.votable_id` continua apontando para os mesmos IDs.

## Rollback

O downgrade só é permitido enquanto a chave antiga continuar sem colisões. Depois que duas UFs contiverem o mesmo conjunto `CD_ELEICAO + cargo + tipo + número`, o rollback é recusado em vez de fundir ou excluir registros.

## Gate para uma nova UF

Antes de disponibilizar uma nova UF:

1. migration 005 aplicada e baseline do Ceará preservado;
2. cadastro eleitoral da UF importado;
3. BU importado com SHA-512 oficial validado;
4. candidaturas importadas usando a mesma chave HMAC persistente do ambiente;
5. vínculo `votable_candidacy` executado;
6. invariantes da nova UF executadas;
7. baseline do Ceará executado novamente para provar ausência de regressão cruzada;
8. comparação independente contra os arquivos oficiais antes de considerar a carga concluída.

## Invariantes

Uma carga multi-UF válida deve garantir, no mínimo:

- um `votable` nunca representa duas UFs;
- votos de uma UF nunca resolvem para `votable` de outra UF;
- uma candidatura estadual só pertence à sua unidade eleitoral;
- candidaturas nacionais pertencem à unidade `BR` e podem ser referenciadas pelos votáveis de qualquer UF;
- identidade de pessoa continua baseada exclusivamente no HMAC do CPF oficial e no histórico de candidaturas do TSE, nunca em nome;
- adicionar uma UF não altera contagens, votos ou vínculos já auditados de outra UF.
