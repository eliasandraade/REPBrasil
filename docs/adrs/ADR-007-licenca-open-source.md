# ADR-007 — Licença AGPL-3.0

**Status:** Aceito
**Data:** 2026-05-15

## Contexto

O REPBrasil é um projeto open source. A escolha da licença afeta como terceiros
podem usar, modificar e redistribuir o código — especialmente em cenário onde
alguém hospede uma versão modificada como serviço web sem devolver as modificações.

## Decisão

**GNU Affero General Public License v3.0 (AGPL-3.0)**

## Justificativa

1. **Proteção de uso como serviço (SaaS)**: a AGPL exige que quem rode uma versão
   modificada como serviço web publique o código-fonte modificado. Isso previne
   que um ator crie um fork fechado do REPBrasil.

2. **Compatibilidade com br/acc**: o projeto br/acc, do qual podemos reaproveitar
   estrutura de ETL e grafo, também usa AGPL-3.0. Licenças incompatíveis impediriam
   reuso de código.

3. **Missão de transparência**: uma plataforma de transparência que não é transparente
   no próprio código seria contraditória.

## Alternativas consideradas

- **MIT**: permissiva demais para o caso de uso. Permitiria forks fechados.
- **GPL-2.0**: não cobre uso como serviço web (a "brecha SaaS").
- **CC-BY-SA**: inadequada para software (projetada para conteúdo).

## Consequências

- Contribuidores precisam aceitar que suas contribuições serão AGPL.
- Dados públicos (não código) não são afetados pela licença de software.
- Forks que rodam como serviço devem publicar o código-fonte modificado.
