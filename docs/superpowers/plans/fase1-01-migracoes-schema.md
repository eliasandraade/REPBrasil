# REPBrasil Fase 1 — Bloco 1: Migrações EF Core e Schema

> **Para execução:** Use `superpowers:subagent-driven-development` ou `superpowers:executing-plans`.
> **Depende de:** Fase 0 completa. Docker rodando (`docker compose up -d` em `infra/`). .NET 8 SDK instalado.

**Objetivo:** Instalar o EF Core CLI, criar a migration inicial a partir das entidades de domínio existentes, aplicar ao PostgreSQL local e verificar que as tabelas foram criadas corretamente.

---

## Decisões arquiteturais

- **Code-first migrations**: entidades já existem no Domain — a migration é gerada a partir delas, não escrita manualmente.
- **`dotnet-ef` como ferramenta global**: instalado uma vez, disponível em todos os projetos.
- **Migration no projeto Infrastructure**: o `ApplicationDbContext` vive em Infrastructure; a migration também fica lá (`src/RepBrasil.Infrastructure/Migrations/`).
- **Startup project = RepBrasil.API**: o CLI precisa de um entry point com DI para instanciar o DbContext.
- **Conexão local**: usa a string do `appsettings.json` (`Host=localhost;Port=5432;Database=repbrasil;Username=repbrasil;Password=repbrasil`).

---

## Pré-requisitos

Docker deve estar rodando. Verificar:

```bash
docker compose ps
# Todos devem estar healthy
```

Se não estiver:
```bash
cd infra
cp .env.example .env   # se .env ainda não existir
docker compose up -d
```

---

## Steps

- [ ] **1. Instalar `dotnet-ef` globalmente**

```bash
dotnet tool install --global dotnet-ef
```

Verificar:
```bash
dotnet ef --version
```

Se já estiver instalado e desatualizado:
```bash
dotnet tool update --global dotnet-ef
```

- [ ] **2. Adicionar pacote de design ao projeto Infrastructure**

O EF Core CLI precisa do pacote `Microsoft.EntityFrameworkCore.Design` no projeto de startup ou no projeto que contém o DbContext:

```bash
cd backend
dotnet add src/RepBrasil.Infrastructure/RepBrasil.Infrastructure.csproj package Microsoft.EntityFrameworkCore.Design --version 8.*
```

- [ ] **3. Criar a migration inicial**

Executar a partir de `backend/`, passando o projeto que contém o DbContext (`--project`) e o projeto de startup (`--startup-project`):

```bash
dotnet ef migrations add InitialCreate \
  --project src/RepBrasil.Infrastructure \
  --startup-project src/RepBrasil.API \
  --output-dir Migrations
```

Esperado: pasta `src/RepBrasil.Infrastructure/Migrations/` criada com 3 arquivos:
- `YYYYMMDDHHMMSS_InitialCreate.cs`
- `YYYYMMDDHHMMSS_InitialCreate.Designer.cs`
- `ApplicationDbContextModelSnapshot.cs`

- [ ] **4. Adicionar índice único filtrado em `TseId` à migration gerada**

**Este passo é obrigatório antes de aplicar a migration.** O ETL usa `ON CONFLICT ("TseId") DO NOTHING` — sem o índice único, o insert falhará.

Abrir o arquivo `YYYYMMDDHHMMSS_InitialCreate.cs` e adicionar, **dentro do método `Up()`**, após a criação da tabela `Politicians`:

```csharp
migrationBuilder.CreateIndex(
    name: "IX_Politicians_TseId",
    table: "Politicians",
    column: "TseId",
    unique: true,
    filter: "\"TseId\" IS NOT NULL");
```

E, **dentro do método `Down()`**, antes de `DropTable("Politicians")`:

```csharp
migrationBuilder.DropIndex(
    name: "IX_Politicians_TseId",
    table: "Politicians");
```

> **Por que filtrado (`IS NOT NULL`)?** Políticos sem `TseId` (ex: importados de outras fontes futuras) não devem conflitar entre si. O índice único parcial garante unicidade apenas onde o valor existe.

- [ ] **5. Aplicar a migration ao banco**

```bash
dotnet ef database update \
  --project src/RepBrasil.Infrastructure \
  --startup-project src/RepBrasil.API
```

Esperado: saída terminando com `Done.`

- [ ] **6. Verificar tabelas criadas**

```bash
docker exec repbrasil-postgres psql -U repbrasil -d repbrasil -c "\dt"
```

Esperado: listagem com tabelas `Politicians`, `Parties`, `Elections`, `ElectionResults`, `AssetDeclarations`, `Companies`, `Contracts`, `Amendments`, `Municipalities`, `LegalCases`, `ScoreSnapshots`, `Flags`, `Sources`, `Evidences`, `Contestations` e `__EFMigrationsHistory`.

- [ ] **7. Verificar estrutura da tabela Politicians e índice TseId**

```bash
docker exec repbrasil-postgres psql -U repbrasil -d repbrasil -c "\d \"Politicians\""
```

Esperado: colunas `Id` (uuid), `Name` (text), `BallotName` (text), `TseId` (text nullable), `CamaraId` (text nullable), `SenateId` (text nullable), `CreatedAt` (timestamp), `UpdatedAt` (timestamp), `DeletedAt` (timestamp nullable), `SourceUpdatedAt` (timestamp nullable).

A saída deve também listar o índice:
```
Indexes:
    "PK_Politicians" PRIMARY KEY, btree ("Id")
    "IX_Politicians_TseId" UNIQUE, btree ("TseId") WHERE "TseId" IS NOT NULL
```

- [ ] **8. Commit**

```bash
cd ..
git add backend/src/RepBrasil.Infrastructure/Migrations/
git add backend/src/RepBrasil.Infrastructure/RepBrasil.Infrastructure.csproj
git commit -m "feat(backend): migration inicial EF Core — schema PostgreSQL"
git push
```

---

## Critérios de sucesso

- [ ] `dotnet ef migrations add` cria os arquivos de migration sem erros
- [ ] `dotnet ef database update` aplica ao banco local sem erros
- [ ] Tabela `Politicians` existe no PostgreSQL com todas as colunas esperadas
- [ ] Índice `IX_Politicians_TseId` existe como UNIQUE filtrado (`WHERE "TseId" IS NOT NULL`)
- [ ] `__EFMigrationsHistory` registra a migration `InitialCreate`

---

## Riscos / Pontos de atenção

| Risco | Mitigação |
|-------|-----------|
| Docker não está rodando | Subir com `docker compose up -d` em `infra/` |
| `dotnet ef` não encontra DbContext | Garantir `--startup-project` aponta para RepBrasil.API |
| EF Core versão 10 instalada (incompatível com net8.0) | Usar `--version 8.*` no `dotnet add package` |
| Erro de conexão com PostgreSQL | Verificar que Docker está healthy e porta 5432 acessível |
| `HasQueryFilter` com soft-delete causa problema na migration | Nenhum — filters são aplicados em runtime, não afetam DDL |
