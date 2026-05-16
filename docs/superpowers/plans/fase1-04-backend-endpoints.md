# REPBrasil Fase 1 — Bloco 4: Backend — Endpoints da API

> **Para execução:** Use `superpowers:subagent-driven-development` ou `superpowers:executing-plans`.
> **Depende de:** Bloco 3 (Application layer completa, DI registrado).

**Objetivo:** Criar o `PoliticiansController` com dois endpoints: `GET /api/v1/politicians` (busca paginada) e `GET /api/v1/politicians/{id}` (perfil por ID). Verificar que o Swagger documenta corretamente e que os endpoints respondem conforme especificado.

---

## Decisões arquiteturais

- **Controller fino**: nenhuma lógica de negócio no controller — apenas delegação ao use case e serialização da resposta.
- **Parâmetros via query string**: `q` (busca), `page` (padrão 1), `pageSize` (padrão 20, máximo 100).
- **404 explícito**: `GET /api/v1/politicians/{id}` retorna 404 com mensagem estruturada quando não encontrado.
- **Envelope de resposta consistente**: lista retorna `{ items, totalCount, page, pageSize, totalPages, hasNext, hasPrevious }`.
- **Sem autenticação em Fase 1**: todos os endpoints são públicos.
- **CORS habilitado** para desenvolvimento local: permite `http://localhost:3000`.

---

## Arquivos criados/modificados

```
backend/src/RepBrasil.API/
├── Controllers/
│   └── PoliticiansController.cs    (novo)
└── Program.cs                      (adicionar CORS)
```

---

## Steps

- [ ] **1. Criar `src/RepBrasil.API/Controllers/PoliticiansController.cs`**

```csharp
using Microsoft.AspNetCore.Mvc;
using RepBrasil.Application.Common;
using RepBrasil.Application.Politicians.DTOs;
using RepBrasil.Application.Politicians.Queries;

namespace RepBrasil.API.Controllers;

[ApiController]
[Route("api/v1/politicians")]
public class PoliticiansController(
    SearchPoliticiansQuery searchQuery,
    GetPoliticianByIdQuery getByIdQuery) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(PagedResult<PoliticianSummaryDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> Search(
        [FromQuery] string? q,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken ct = default)
    {
        var result = await searchQuery.ExecuteAsync(q, page, pageSize, ct);
        return Ok(result);
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(PoliticianDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct = default)
    {
        var result = await getByIdQuery.ExecuteAsync(id, ct);
        if (result is null)
            return NotFound(new { message = $"Político {id} não encontrado." });
        return Ok(result);
    }
}
```

- [ ] **2. Configurar CORS em `Program.cs`**

Adicionar **antes** de `builder.Build()`:

```csharp
builder.Services.AddCors(options =>
{
    options.AddPolicy("LocalDev", policy =>
    {
        policy
            .WithOrigins("http://localhost:3000")
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});
```

Adicionar **após** `app.UseHttpsRedirection()`:

```csharp
app.UseCors("LocalDev");
```

- [ ] **3. Compilar**

```bash
cd backend
dotnet build
```

Esperado: `Build succeeded. 0 Warning(s) 0 Error(s)`

- [ ] **4. Rodar a API localmente**

Com Docker rodando e banco populado:

```bash
cd src/RepBrasil.API
dotnet run
```

Esperado: `Now listening on: http://localhost:5000`

- [ ] **5. Verificar endpoint de busca**

Em outro terminal:

```bash
curl -s "http://localhost:5000/api/v1/politicians?q=silva&page=1&pageSize=5" | python -m json.tool
```

Esperado:
```json
{
  "items": [
    {
      "id": "...",
      "name": "...",
      "ballotName": "...",
      "tseId": "..."
    }
  ],
  "totalCount": N,
  "page": 1,
  "pageSize": 5,
  "totalPages": N,
  "hasNext": true,
  "hasPrevious": false
}
```

- [ ] **6. Verificar endpoint de perfil**

Pegar um ID do resultado anterior e testar:

```bash
# Substituir {id} por um UUID real do banco
curl -s "http://localhost:5000/api/v1/politicians/{id}" | python -m json.tool
```

Esperado:
```json
{
  "id": "...",
  "name": "...",
  "ballotName": "...",
  "tseId": "...",
  "camaraId": null,
  "senateId": null,
  "createdAt": "...",
  "sourceUpdatedAt": "..."
}
```

- [ ] **7. Verificar 404**

```bash
curl -s -o /dev/null -w "%{http_code}" \
  "http://localhost:5000/api/v1/politicians/00000000-0000-0000-0000-000000000000"
```

Esperado: `404`

- [ ] **8. Verificar Swagger**

Abrir `http://localhost:5000/swagger` no browser. Verificar:
- Endpoint `GET /api/v1/politicians` listado com parâmetros `q`, `page`, `pageSize`
- Endpoint `GET /api/v1/politicians/{id}` listado
- Health e Status endpoints presentes

- [ ] **9. Commit**

```bash
cd ../../..
git add backend/
git commit -m "feat(backend): PoliticiansController — GET /api/v1/politicians e /api/v1/politicians/{id}"
git push
```

---

## Critérios de sucesso

- [ ] `dotnet build` sem erros
- [ ] `GET /api/v1/politicians?q=silva` retorna JSON paginado com políticos
- [ ] `GET /api/v1/politicians?q=` (sem query) retorna todos os políticos (paginado)
- [ ] `GET /api/v1/politicians/{id}` retorna detalhes do político
- [ ] `GET /api/v1/politicians/00000000-0000-0000-0000-000000000000` retorna 404
- [ ] Swagger acessível em `/swagger` com endpoints documentados
- [ ] CORS permite requisições de `http://localhost:3000`

---

## Riscos / Pontos de atenção

| Risco | Mitigação |
|-------|-----------|
| API falha ao subir sem PostgreSQL rodando | Docker deve estar rodando antes de `dotnet run` |
| Serialização camelCase vs PascalCase | ASP.NET Core serializa em camelCase por padrão — correto para o frontend |
| `{id:guid}` route constraint rejeita UUIDs inválidos | Retorna 400 automaticamente — comportamento correto |
| CORS bloqueando em produção | Em produção, CORS será configurado com origem real; para Fase 0–1 apenas localhost |
