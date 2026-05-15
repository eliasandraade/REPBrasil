# ADR-001 — Idioma da documentação e nomenclatura de código

**Status:** Aceito
**Data:** 2026-05-15

## Contexto

O REPBrasil é uma plataforma voltada ao cidadão brasileiro, com documentação
institucional que precisa ser acessível para jornalistas, pesquisadores e
colaboradores sem formação técnica. Ao mesmo tempo, o código precisa ser legível
para desenvolvedores internacionais que possam contribuir com o projeto open source.

## Decisão

- **Documentação institucional e metodológica em Português (BR):** README, manifesto,
  metodologia, ADRs, governança, auditoria, contestação, LGPD, UX docs.
- **Código, entidades e nomenclaturas técnicas em Inglês:** nomes de classes, métodos,
  variáveis, schemas Pydantic, nós e arestas do Neo4j, colunas de banco de dados.
- **Futuramente:** `README.en.md` e CONTRIBUTING em inglês para colaboradores internacionais.

## Consequências

- Colaboradores brasileiros sem inglês fluente podem contribuir com documentação.
- Desenvolvedores internacionais podem ler e contribuir com código sem barreira.
- Entidades de domínio (`Politician`, `Election`, `ScoreSnapshot`) são universalmente legíveis.
- ADRs em português garantem que decisões técnicas sejam compreensíveis para o time fundador.
