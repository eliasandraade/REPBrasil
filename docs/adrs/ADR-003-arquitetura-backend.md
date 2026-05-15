# ADR-003 — Arquitetura do backend

**Status:** Aceito
**Data:** 2026-05-15

## Contexto

O backend precisa ser sustentável a longo prazo, com separação clara de
responsabilidades, testável sem dependência de infraestrutura, e extensível
para novos casos de uso sem refatorações destrutivas.

## Decisão

**Clean Architecture com .NET 8**, organizada em quatro projetos:

- `RepBrasil.Domain`: entidades, value objects, enums, interfaces de repositório.
  Zero dependências externas. É o núcleo do sistema.
- `RepBrasil.Application`: use cases, DTOs, interfaces de serviço.
  Depende apenas de `Domain`. Não conhece EF Core, HTTP ou banco de dados.
- `RepBrasil.Infrastructure`: implementações de repositório, EF Core, Redis, contexto.
  Depende de `Domain` e `Application`.
- `RepBrasil.API`: controllers, middleware, configuração, Swagger.
  Depende de `Application` e `Infrastructure`.

**Convenções de domínio:**
- `Guid` como identificador interno universal (independente de IDs externos do TSE/Câmara).
- IDs externos armazenados em campos separados (`TseId`, `CamaraId`).
- Todas as entidades herdam de `AuditableEntity` (`CreatedAt`, `UpdatedAt`, `DeletedAt`, `SourceUpdatedAt`).
- `ScoreSnapshot` é imutável: novos cálculos geram novos registros.
- Versionamento de API: `/api/v1/`.

## Consequências

- Alta testabilidade: `Application` pode ser testada sem banco de dados.
- Curva de aprendizado moderada para novos contribuidores.
- Adição de novos casos de uso não requer mudanças nas camadas inferiores.
- Swagger habilitado apenas em `Development`.
