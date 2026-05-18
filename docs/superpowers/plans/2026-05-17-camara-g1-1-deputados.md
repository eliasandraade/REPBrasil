# G1-1: CamaraDeputadosPipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar dados oficiais da Câmara dos Deputados (57ª legislatura) ao REPBrasil: preencher `Politician.CamaraId`, criar entidade `Mandate` com mandato federal, registrar TransformationChain + Evidence da decisão de matching, e expor endpoint + aba frontend para visualização — sem score, sem inferência, sem grafo.

**Architecture:** `CamaraDeputadosPipeline` segue o padrão `BasePipeline` (collect → transform → load). `collect()` busca deputados via API REST paginada da Câmara. `transform()` normaliza nomes e executa matching TSE↔Câmara em três níveis de confiança. `load()` aplica o resultado: UPDATE `Politician.CamaraId`, INSERT `Mandate`, INSERT `Evidence` rastreando a decisão, tudo via `get_db()` (curto, não interfere com o seed Nordeste). **Schema:** additive-only (nova tabela `Mandates`, nenhum ALTER TABLE em tabelas existentes). **Escrita em `Politicians`:** row-level UPDATE no campo `CamaraId`, risco muito baixo de contention com seed Nordeste (que faz INSERT de novos rows, não UPDATE dos mesmos campos). Monitorar locks se necessário.

**Tech Stack:** Python 3.12, httpx, psycopg2-binary, loguru, pytest, pytest-mock. Backend .NET 8, EF Core migrations additive. Frontend Next.js 14, TanStack Query, TypeScript.

**Constraint ativa:** Seed Nordeste rodando em background. NUNCA alterar estrutura de `Politicians`, `ElectionResults`, `AssetDeclarations`, `AssetItems`. NUNCA reiniciar Railway durante o seed.

---

## Fonte Oficial

**API da Câmara dos Deputados v2**
- Base URL: `https://dadosabertos.camara.leg.br/api/v2`
- Sem autenticação
- Endpoint principal: `GET /deputados?idLegislatura=57&itens=500&pagina=N&ordem=ASC&ordenarPor=nome`
- Resposta:
  ```json
  {
    "dados": [
      { "id": 204554, "nome": "Abilio Brunini", "siglaPartido": "PL",
        "siglaUf": "MT", "idLegislatura": 57,
        "urlFoto": "https://www.camara.leg.br/internet/deputado/bandep/204554.jpg",
        "email": "dep.abiliobrunini@camara.leg.br" }
    ],
    "links": [{"rel": "self",...}, {"rel": "next",...}],
    "meta": { "totalItens": 513 }
  }
  ```
- Paginação: seguir `links[rel=next]` até não existir
- 57ª Legislatura: 2023-02-01 → 2027-01-31, ~513 deputados

**Mandato 57ª Legislatura:**
- Start: 2023-02-01
- End: 2027-01-31
- URL do perfil: `https://www.camara.leg.br/deputados/{camaraId}`

---

## Estratégia de Matching TSE ↔ Câmara

### Pool de candidatos TSE a fazer match
Somente políticos **eleitos** para **DEPUTADO FEDERAL**:
```sql
SELECT p."Id", p."Name", p."BallotName", p."TseId", p."State", p."PartyAcronym"
FROM "Politicians" p
JOIN "ElectionResults" er ON er."PoliticianId" = p."Id"
WHERE p."Office" ILIKE '%DEPUTADO FEDERAL%'
  AND er."Elected" = true
  AND p."DeletedAt" IS NULL
```

### Algoritmo (3 níveis, ordem de prioridade)

```
Nível 1 — Full 3-way (ConfidenceLevel=5):
  norm(TSE.Name) == norm(Câmara.nome)
  AND TSE.State == Câmara.siglaUf
  AND TSE.PartyAcronym == Câmara.siglaPartido

Nível 2 — BallotName 3-way (ConfidenceLevel=4):
  norm(TSE.BallotName) == norm(Câmara.nome)
  AND TSE.State == Câmara.siglaUf
  AND TSE.PartyAcronym == Câmara.siglaPartido

Nível 3 — Name 2-way (ConfidenceLevel=3) — CONSERVADOR:
  norm(TSE.Name) == norm(Câmara.nome)
  AND TSE.State == Câmara.siglaUf
  (partido pode ter mudado após eleição)
  ⚠️ Aceitar SOMENTE se exatamente 1 TSE candidate corresponde por nome+UF.
  Se 2+ TSE candidates têm mesmo norm(Name)+State → skip + log como ambiguous.
  Sem fuzzy matching. Sem threshold numérico. Apenas exact match normalizado.

Descarte — Ambiguous (para revisão manual):
  Múltiplos TSE candidates correspondem ao mesmo Câmara deputy (qualquer nível) → skip + log
  Nível 3: múltiplos TSE com mesmo norm(Name)+State → skip + log
  Registrar todos os não-matchados e ambíguos em log para revisão posterior.
```

### Normalização de nomes

```python
def normalize_name(name: str) -> str:
    """
    "JOSÉ MARIA DA SILVA" → "jose maria silva"
    "María de los Ángeles" → "maria angeles"
    Remove acentos, lowercase, partículas PT-BR.
    """
    _PARTICLES = {"de", "da", "do", "dos", "das", "e", "em", "com", "no", "na"}
    import unicodedata, re
    nfd = unicodedata.normalize("NFD", name.lower())
    ascii_only = "".join(c for c in nfd if unicodedata.category(c) != "Mn")
    clean = re.sub(r"[^a-z0-9\s]", " ", ascii_only)
    words = [w for w in clean.split() if w and w not in _PARTICLES]
    return " ".join(words)
```

### Risco de homônimos

- **Mesmo nome + mesmo estado + mesmo partido** → match único, seguro (Nível 1)
- **Mesmo nome + mesmo estado + partido diferente** → Nível 3 (low confidence). Pode ocorrer após mudança de partido pós-eleição.
- **Mesmo nome + estados diferentes** → cada match é independente, sem risco
- **Dois TSE candidatos com mesmo nome + estado** → ambiguous, descartado + logado para revisão manual
- Estimativa: <1% de casos ambíguos no universo de ~513 deputados federais

---

## Entidades Impactadas

### Existentes (schema inalterado; escrita controlada em `Politicians`)

| Entidade | Campo | Mudança | Risco seed Nordeste |
|---|---|---|---|
| `Politician` | `CamaraId` | UPDATE row-level (coluna já existe) | Baixo — seed faz INSERT de novos rows; UPDATE em CamaraId não conflita |
| `Source` | — | INSERT nova fonte "Câmara API v2" |
| `TransformationChain` | — | INSERT por run do pipeline |
| `TransformationStep` | — | INSERT 4 steps por run |
| `Evidence` | — | INSERT 1 por matched politician |

### Nova entidade

```csharp
// backend/src/RepBrasil.Domain/Entities/Mandate.cs
public class Mandate : AuditableEntity
{
    public Guid PoliticianId { get; set; }
    public Politician Politician { get; set; } = null!;

    /// <summary>Valores: "CAMARA" | "SENADO" | "ASSEMBLEIA_ESTADUAL"</summary>
    public string House { get; set; } = string.Empty;
    public int Legislature { get; set; }
    public string? Title { get; set; }
    public string? State { get; set; }
    public string? PartyAcronym { get; set; }
    public DateTime? StartDate { get; set; }
    public DateTime? EndDate { get; set; }

    /// <summary>ID externo na Câmara/Senado (mesmo valor de Politician.CamaraId)</summary>
    public string? ExternalId { get; set; }
    public string? ExternalUrl { get; set; }

    public Guid? SourceId { get; set; }
    public Source? Source { get; set; }
}
```

---

## Mapa de Arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `etl/src/sources/camara/normalizer.py` | Criar | `normalize_name()`, `build_camara_index()`, `match_deputies()` |
| `etl/src/sources/camara/api.py` | Criar | `fetch_deputies(legislature)` — cliente paginado da API |
| `etl/src/sources/camara/deputies.py` | Criar | `CamaraDeputadosPipeline` collect + transform + load |
| `etl/tests/sources/camara/__init__.py` | Criar | Marcador de pacote |
| `etl/tests/sources/camara/test_normalizer.py` | Criar | Testes unitários do normalizer |
| `etl/tests/sources/camara/test_api.py` | Criar | Testes do cliente API (mock httpx) |
| `etl/tests/sources/camara/test_deputies.py` | Criar | Testes transform + load (mock) |
| `etl/scripts/seed_camara_deputados.py` | Criar | Driver script com validação pré/pós |
| `backend/src/RepBrasil.Domain/Entities/Mandate.cs` | Criar | Entidade Mandate |
| `backend/src/RepBrasil.Infrastructure/Persistence/ApplicationDbContext.cs` | Modificar | Adicionar `DbSet<Mandate> Mandates` + configuração EF |
| `backend/src/RepBrasil.Infrastructure/Migrations/YYYYMMDD_AddMandate.cs` | Gerar | Migration additive |
| `backend/src/RepBrasil.Api/Controllers/PoliticiansController.cs` | Modificar | Adicionar `GET /{id}/mandates` |
| `frontend/src/lib/types.ts` | Modificar | Adicionar tipo `Mandate` |
| `frontend/src/lib/api.ts` | Modificar | Adicionar `getMandates(id)` |
| `frontend/src/components/politicians/tabs/CamaraTab.tsx` | Criar | Aba Câmara com mandato + link + foto |
| `frontend/src/components/politicians/PoliticianProfile.tsx` | Modificar | Adicionar tab "Câmara" (condicional se CamaraId preenchido) |

---

## Task 1: Normalizer — `normalize_name()` + matching utils

**Files:**
- Create: `etl/src/sources/camara/normalizer.py`
- Create: `etl/tests/sources/camara/__init__.py`
- Create: `etl/tests/sources/camara/test_normalizer.py`

- [ ] **Step 1.1: Criar `etl/tests/sources/camara/__init__.py`** (vazio)

```powershell
New-Item -Path "C:\Users\Elias\Documents\RepBrasil\etl\tests\sources\camara\__init__.py" -ItemType File -Force
```

- [ ] **Step 1.2: Escrever testes que falham em `test_normalizer.py`**

```python
# etl/tests/sources/camara/test_normalizer.py
import pytest
from src.sources.camara.normalizer import normalize_name, build_camara_index, match_deputies


def test_normalize_removes_accents():
    assert normalize_name("JOSÉ MARIA") == "jose maria"


def test_normalize_removes_particles():
    assert normalize_name("JOSE DA SILVA") == "jose silva"
    assert normalize_name("MARIA DAS DORES") == "maria dores"
    assert normalize_name("ANTONIO DE SOUSA") == "antonio sousa"


def test_normalize_uppercase_camara_style():
    assert normalize_name("José Maria da Silva") == "jose maria silva"


def test_normalize_removes_special_chars():
    assert normalize_name("O'Brien-Costa") == "obrien costa"


def test_normalize_empty():
    assert normalize_name("") == ""


def test_normalize_only_particles():
    assert normalize_name("da de do") == ""


def test_build_camara_index_keyed_by_norm_uf_party():
    deputies = [
        {"id": 100, "nome": "José Silva", "siglaUf": "CE", "siglaPartido": "PT"},
        {"id": 200, "nome": "Maria Santos", "siglaUf": "BA", "siglaPartido": "PL"},
    ]
    idx = build_camara_index(deputies)
    assert ("jose silva", "CE", "PT") in idx
    assert idx[("jose silva", "CE", "PT")]["id"] == 100


def test_build_camara_index_also_by_name_uf():
    deputies = [{"id": 100, "nome": "José Silva", "siglaUf": "CE", "siglaPartido": "PT"}]
    idx = build_camara_index(deputies)
    # 2-way key (name, uf) should also be present
    assert ("jose silva", "CE") in idx


def test_match_deputies_full_3way():
    camara = [{"id": 100, "nome": "José Silva", "siglaUf": "CE", "siglaPartido": "PT"}]
    tse = [{"Id": "uuid-1", "Name": "JOSE SILVA", "BallotName": "ZE SILVA",
            "State": "CE", "PartyAcronym": "PT"}]
    results = match_deputies(camara, tse)
    matched = [r for r in results if r["camara_id"] is not None]
    assert len(matched) == 1
    assert matched[0]["camara_id"] == "100"
    assert matched[0]["confidence_level"] == 5
    assert matched[0]["match_method"] == "full_3way"


def test_match_deputies_ballot_3way():
    camara = [{"id": 200, "nome": "Ze Silva", "siglaUf": "CE", "siglaPartido": "PT"}]
    tse = [{"Id": "uuid-2", "Name": "JOSE DA SILVA", "BallotName": "ZE SILVA",
            "State": "CE", "PartyAcronym": "PT"}]
    results = match_deputies(camara, tse)
    matched = [r for r in results if r["camara_id"] is not None]
    assert len(matched) == 1
    assert matched[0]["confidence_level"] == 4
    assert matched[0]["match_method"] == "ballot_3way"


def test_match_deputies_name_2way_party_changed():
    camara = [{"id": 300, "nome": "Ana Costa", "siglaUf": "SP", "siglaPartido": "MDB"}]
    tse = [{"Id": "uuid-3", "Name": "ANA COSTA", "BallotName": "ANA COSTA",
            "State": "SP", "PartyAcronym": "PT"}]  # different party
    results = match_deputies(camara, tse)
    matched = [r for r in results if r["camara_id"] is not None]
    assert len(matched) == 1
    assert matched[0]["confidence_level"] == 3
    assert matched[0]["match_method"] == "name_2way"


def test_match_deputies_ambiguous_skipped():
    camara = [{"id": 400, "nome": "Joao Santos", "siglaUf": "MG", "siglaPartido": "PT"}]
    tse = [
        {"Id": "uuid-a", "Name": "JOAO SANTOS", "BallotName": "JOAO",
         "State": "MG", "PartyAcronym": "PL"},  # same name+uf, different party
        {"Id": "uuid-b", "Name": "JOAO SANTOS", "BallotName": "JOAO SANTOS",
         "State": "MG", "PartyAcronym": "PSDB"},
    ]
    results = match_deputies(camara, tse)
    matched = [r for r in results if r["camara_id"] is not None]
    assert len(matched) == 0


def test_match_deputies_no_match():
    camara = [{"id": 500, "nome": "Pedro Alves", "siglaUf": "RJ", "siglaPartido": "PT"}]
    tse = [{"Id": "uuid-5", "Name": "CARLOS FERREIRA", "BallotName": "CARLAO",
            "State": "RJ", "PartyAcronym": "PT"}]
    results = match_deputies(camara, tse)
    assert all(r["camara_id"] is None for r in results)
```

- [ ] **Step 1.3: Rodar e verificar falha**

```powershell
$env:PYTHONPATH = "C:\Users\Elias\Documents\RepBrasil\etl"
C:\Users\Elias\Documents\RepBrasil\etl\.venv\Scripts\python.exe -m pytest etl/tests/sources/camara/test_normalizer.py -v
```

Esperado: `ImportError: cannot import name 'normalize_name'` (arquivo não existe ainda).

- [ ] **Step 1.4: Implementar `etl/src/sources/camara/normalizer.py`**

```python
import re
import unicodedata
from typing import Any

_PARTICLES: frozenset[str] = frozenset({
    "de", "da", "do", "dos", "das", "e", "em", "com", "no", "na", "o", "a"
})


def normalize_name(name: str) -> str:
    """Remove acentos, coloca lowercase, remove partículas PT-BR e caracteres não-alfanuméricos."""
    nfd = unicodedata.normalize("NFD", name.lower())
    ascii_only = "".join(c for c in nfd if unicodedata.category(c) != "Mn")
    clean = re.sub(r"[^a-z0-9\s]", " ", ascii_only)
    words = [w for w in clean.split() if w and w not in _PARTICLES]
    return " ".join(words)


def build_camara_index(deputies: list[dict[str, Any]]) -> dict[tuple, dict[str, Any]]:
    """
    Constrói dois índices de lookup para o matching:
    - Chave 3-way: (norm_name, uf, party)  → deputado
    - Chave 2-way: (norm_name, uf)          → deputado ou "__ambiguous__" se múltiplos
    """
    idx: dict[tuple, Any] = {}

    for dep in deputies:
        norm = normalize_name(dep["nome"])
        uf = dep["siglaUf"]
        party = dep["siglaPartido"]

        key3 = (norm, uf, party)
        key2 = (norm, uf)

        # 3-way: partido específico não gera ambiguidade normalmente
        idx[key3] = dep

        # 2-way: detectar colisão
        if key2 in idx:
            idx[key2] = "__ambiguous__"
        else:
            idx[key2] = dep

    return idx


def match_deputies(
    camara_deputies: list[dict[str, Any]],
    tse_politicians: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Para cada TSE politician, tenta encontrar o deputado correspondente na Câmara.

    Retorna lista de dicts com:
      politician_id, tse_name, tse_ballot_name, tse_state, tse_party,
      camara_id (str|None), camara_name (str|None),
      match_method (str|None), confidence_level (int|None)
    """
    idx = build_camara_index(camara_deputies)

    # Pré-escaneamento: detectar ambiguidade pelo lado TSE (múltiplos TSE com mesmo norm_name+UF)
    # Caso: dois deputados federais homonimos no mesmo estado (raro, mas deve ser descartado)
    _tse_name_uf_count: dict[tuple, int] = {}
    for pol in tse_politicians:
        key = (normalize_name(pol["Name"]), pol["State"])
        _tse_name_uf_count[key] = _tse_name_uf_count.get(key, 0) + 1
    _tse_ambiguous_keys: set[tuple] = {k for k, v in _tse_name_uf_count.items() if v > 1}

    results: list[dict[str, Any]] = []

    for pol in tse_politicians:
        norm_name = normalize_name(pol["Name"])
        norm_ballot = normalize_name(pol["BallotName"])
        uf = pol["State"]
        party = pol["PartyAcronym"]

        camara_id = None
        camara_name = None
        method = None
        confidence = None

        # Nível 1: nome civil 3-way
        dep = idx.get((norm_name, uf, party))
        if dep and dep != "__ambiguous__":
            camara_id = str(dep["id"])
            camara_name = dep["nome"]
            method = "full_3way"
            confidence = 5

        # Nível 2: nome de urna 3-way
        if camara_id is None and norm_ballot:
            dep = idx.get((norm_ballot, uf, party))
            if dep and dep != "__ambiguous__":
                camara_id = str(dep["id"])
                camara_name = dep["nome"]
                method = "ballot_3way"
                confidence = 4

        # Nível 3: nome civil 2-way — conservador
        # Descarta se: (a) múltiplos Câmara deputies com mesmo nome+UF, ou
        #              (b) múltiplos TSE politicians com mesmo nome+UF (ambiguidade TSE-side)
        if camara_id is None:
            tse_ambiguous = (norm_name, uf) in _tse_ambiguous_keys
            dep2 = idx.get((norm_name, uf))
            if dep2 == "__ambiguous__" or tse_ambiguous:
                results.append({
                    "politician_id": pol["Id"],
                    "tse_name": pol["Name"],
                    "tse_ballot_name": pol["BallotName"],
                    "tse_state": uf,
                    "tse_party": party,
                    "camara_id": None,
                    "camara_name": None,
                    "match_method": "ambiguous_name_2way",
                    "confidence_level": None,
                })
                continue
            elif dep2 is not None:
                camara_id = str(dep2["id"])
                camara_name = dep2["nome"]
                method = "name_2way"
                confidence = 3

        results.append({
            "politician_id": pol["Id"],
            "tse_name": pol["Name"],
            "tse_ballot_name": pol["BallotName"],
            "tse_state": uf,
            "tse_party": party,
            "camara_id": camara_id,
            "camara_name": camara_name,
            "match_method": method,
            "confidence_level": confidence,
        })

    return results
```

- [ ] **Step 1.5: Rodar testes e verificar que passam**

```powershell
$env:PYTHONPATH = "C:\Users\Elias\Documents\RepBrasil\etl"
C:\Users\Elias\Documents\RepBrasil\etl\.venv\Scripts\python.exe -m pytest etl/tests/sources/camara/test_normalizer.py -v
```

Esperado: todos os 13 testes passam.

- [ ] **Step 1.6: Commitar**

```powershell
git -C "C:\Users\Elias\Documents\RepBrasil" add etl/src/sources/camara/normalizer.py etl/tests/sources/camara/__init__.py etl/tests/sources/camara/test_normalizer.py
git -C "C:\Users\Elias\Documents\RepBrasil" commit -m "feat(etl): normalizer TSE↔Câmara — normalize_name + match_deputies"
```

---

## Task 2: API Client — `fetch_deputies()`

**Files:**
- Create: `etl/src/sources/camara/api.py`
- Create: `etl/tests/sources/camara/test_api.py`

- [ ] **Step 2.1: Escrever testes que falham em `test_api.py`**

```python
# etl/tests/sources/camara/test_api.py
import pytest
from unittest.mock import MagicMock, patch
from src.sources.camara.api import fetch_deputies, CAMARA_API_BASE


def _make_page(dados: list, has_next: bool) -> dict:
    links = [{"rel": "self", "href": "..."}]
    if has_next:
        links.append({"rel": "next", "href": "..."})
    return {"dados": dados, "links": links, "meta": {"totalItens": len(dados)}}


def test_fetch_deputies_single_page(mocker):
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = _make_page(
        [{"id": 1, "nome": "João"}, {"id": 2, "nome": "Maria"}], has_next=False
    )
    mocker.patch("httpx.get", return_value=mock_response)
    result = fetch_deputies(legislature=57)
    assert len(result) == 2
    assert result[0]["id"] == 1


def test_fetch_deputies_paginates_until_no_next(mocker):
    page1 = _make_page([{"id": i} for i in range(500)], has_next=True)
    page2 = _make_page([{"id": 500}], has_next=False)
    mock_get = mocker.patch("httpx.get")
    mock_get.side_effect = [
        MagicMock(raise_for_status=MagicMock(), json=MagicMock(return_value=page1)),
        MagicMock(raise_for_status=MagicMock(), json=MagicMock(return_value=page2)),
    ]
    result = fetch_deputies(legislature=57)
    assert len(result) == 501
    assert mock_get.call_count == 2


def test_fetch_deputies_empty_dados_stops(mocker):
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {"dados": [], "links": [], "meta": {}}
    mocker.patch("httpx.get", return_value=mock_response)
    result = fetch_deputies(legislature=57)
    assert result == []


def test_fetch_deputies_uses_correct_params(mocker):
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = _make_page([], has_next=False)
    mock_get = mocker.patch("httpx.get", return_value=mock_response)
    fetch_deputies(legislature=57)
    call_kwargs = mock_get.call_args
    params = call_kwargs.kwargs.get("params", {})
    assert params.get("idLegislatura") == 57
    assert params.get("itens") == 500
```

- [ ] **Step 2.2: Rodar e verificar falha**

```powershell
$env:PYTHONPATH = "C:\Users\Elias\Documents\RepBrasil\etl"
C:\Users\Elias\Documents\RepBrasil\etl\.venv\Scripts\python.exe -m pytest etl/tests/sources/camara/test_api.py -v
```

Esperado: `ImportError` (arquivo não existe).

- [ ] **Step 2.3: Implementar `etl/src/sources/camara/api.py`**

```python
from typing import Any

import httpx
from loguru import logger

CAMARA_API_BASE = "https://dadosabertos.camara.leg.br/api/v2"
_ITEMS_PER_PAGE = 500


def fetch_deputies(legislature: int) -> list[dict[str, Any]]:
    """
    Busca todos os deputados de uma legislatura via API paginada da Câmara.
    Sem autenticação. Segue rel=next até não existir.
    """
    deputies: list[dict[str, Any]] = []
    page = 1

    while True:
        resp = httpx.get(
            f"{CAMARA_API_BASE}/deputados",
            params={
                "idLegislatura": legislature,
                "itens": _ITEMS_PER_PAGE,
                "pagina": page,
                "ordem": "ASC",
                "ordenarPor": "nome",
            },
            timeout=30,
        )
        resp.raise_for_status()
        body = resp.json()

        batch = body.get("dados", [])
        if not batch:
            break

        deputies.extend(batch)
        logger.debug(f"Página {page}: {len(batch)} deputados (total acumulado: {len(deputies)})")

        has_next = any(link.get("rel") == "next" for link in body.get("links", []))
        if not has_next:
            break

        page += 1

    logger.info(f"Deputados coletados: {len(deputies)} (legislatura {legislature})")
    return deputies
```

- [ ] **Step 2.4: Rodar testes**

```powershell
$env:PYTHONPATH = "C:\Users\Elias\Documents\RepBrasil\etl"
C:\Users\Elias\Documents\RepBrasil\etl\.venv\Scripts\python.exe -m pytest etl/tests/sources/camara/test_api.py -v
```

Esperado: 4/4 passam.

- [ ] **Step 2.5: Commitar**

```powershell
git -C "C:\Users\Elias\Documents\RepBrasil" add etl/src/sources/camara/api.py etl/tests/sources/camara/test_api.py
git -C "C:\Users\Elias\Documents\RepBrasil" commit -m "feat(etl): camara api client — fetch_deputies paginado"
```

---

## Task 3: Domain — `Mandate` entity + migration

**Files:**
- Create: `backend/src/RepBrasil.Domain/Entities/Mandate.cs`
- Modify: `backend/src/RepBrasil.Infrastructure/Persistence/ApplicationDbContext.cs`
- Generate + fix: migration `AddMandate`

- [ ] **Step 3.1: Criar `Mandate.cs`**

```csharp
// backend/src/RepBrasil.Domain/Entities/Mandate.cs
namespace RepBrasil.Domain.Entities;

public class Mandate : AuditableEntity
{
    public Guid PoliticianId { get; set; }
    public Politician Politician { get; set; } = null!;

    /// <summary>Valores: "CAMARA" | "SENADO" | "ASSEMBLEIA_ESTADUAL"</summary>
    public string House { get; set; } = string.Empty;

    public int Legislature { get; set; }

    public string? Title { get; set; }
    public string? State { get; set; }
    public string? PartyAcronym { get; set; }
    public DateTime? StartDate { get; set; }
    public DateTime? EndDate { get; set; }

    /// <summary>ID externo: CamaraId ou SenateId. Mesmo valor de Politician.CamaraId para deputados.</summary>
    public string? ExternalId { get; set; }
    public string? ExternalUrl { get; set; }

    public Guid? SourceId { get; set; }
    public Source? Source { get; set; }
}
```

- [ ] **Step 3.2: Adicionar `DbSet<Mandate>` e configuração ao `ApplicationDbContext.cs`**

Adicionar ao final dos DbSets existentes:
```csharp
public DbSet<Mandate> Mandates => Set<Mandate>();
```

Adicionar no método `OnModelCreating` (dentro do bloco existente):
```csharp
// Mandate
modelBuilder.Entity<Mandate>(b =>
{
    b.HasIndex(m => new { m.PoliticianId, m.House, m.Legislature }).IsUnique();
    b.HasOne(m => m.Politician).WithMany().HasForeignKey(m => m.PoliticianId)
        .OnDelete(DeleteBehavior.Restrict);
    b.HasOne(m => m.Source).WithMany().HasForeignKey(m => m.SourceId)
        .OnDelete(DeleteBehavior.SetNull);
    b.HasQueryFilter(m => m.DeletedAt == null);
});
```

- [ ] **Step 3.3: Gerar migration**

```powershell
Set-Location "C:\Users\Elias\Documents\RepBrasil\backend"
dotnet ef migrations add AddMandate --project src/RepBrasil.Infrastructure --startup-project src/RepBrasil.Api
```

Esperado: migration gerada em `src/RepBrasil.Infrastructure/Migrations/`.

- [ ] **Step 3.4: Verificar migration gerada — nenhum default indevido**

Abrir o arquivo gerado `..._AddMandate.cs` e verificar:
- `House` não tem `defaultValue: ""` — se tiver, corrigir para remover `defaultValue` (campo required, não deve ter default no banco)
- `Legislature` não tem `defaultValue: 0` — corrigir se tiver
- FKs: `PoliticianId` → `Restrict`, `SourceId` → `SetNull`
- Index unique em `(PoliticianId, House, Legislature)`

Se houver defaults indevidos (EF Core bug), remover manualmente as linhas `defaultValue: ...` no arquivo de migration.

- [ ] **Step 3.5: Buildar backend para confirmar que compila**

```powershell
Set-Location "C:\Users\Elias\Documents\RepBrasil\backend"
dotnet build --configuration Release
```

Esperado: `Build succeeded. 0 Warning(s) 0 Error(s)`.

- [ ] **Step 3.6: Commitar a migration**

```powershell
git -C "C:\Users\Elias\Documents\RepBrasil" add backend/src/RepBrasil.Domain/Entities/Mandate.cs
git -C "C:\Users\Elias\Documents\RepBrasil" add backend/src/RepBrasil.Infrastructure/
git -C "C:\Users\Elias\Documents\RepBrasil" commit -m "feat(domain): Mandate entity — mandato parlamentar com House/Legislature/ExternalId"
```

- [ ] **Step 3.7: Push + aguardar deploy Railway antes de migrar**

```powershell
git -C "C:\Users\Elias\Documents\RepBrasil" push origin main
```

Aguardar deploy do backend (~2–3 min). O Railway compila e sobe a nova versão com a migration incluída no assembly. **Não chamar `/migrate` antes do deploy completar** — o backend antigo não conhece a migration `AddMandate`.

Verificar que o deploy subiu:
```powershell
Invoke-RestMethod "https://back-production-8d1d.up.railway.app/api/v1/status"
```

- [ ] **Step 3.8: Aplicar migration via POST /migrate (somente após deploy confirmado)**

```powershell
Invoke-RestMethod -Uri "https://back-production-8d1d.up.railway.app/migrate" -Method POST
```

Esperado: resposta 200 com `"migrations applied"` ou lista incluindo `AddMandate`.

> ⚠️ **SAFE durante seed Nordeste**: cria apenas nova tabela `Mandates`. Sem ALTER TABLE em `Politicians`, `ElectionResults`, `AssetDeclarations`, `AssetItems`. Nenhum lock nas tabelas em uso pelo seed.

---

## Task 4: `CamaraDeputadosPipeline` — collect + transform

**Files:**
- Create: `etl/src/sources/camara/deputies.py`
- Create: `etl/tests/sources/camara/test_deputies.py` (transform tests)

- [ ] **Step 4.1: Escrever testes de transform que falham**

```python
# etl/tests/sources/camara/test_deputies.py
import pytest
from unittest.mock import MagicMock, patch
from src.sources.camara.deputies import CamaraDeputadosPipeline


# ─── collect ───────────────────────────────────────────────────────────────────

def test_collect_returns_list_of_deputies(mocker):
    mocker.patch(
        "src.sources.camara.deputies.fetch_deputies",
        return_value=[{"id": 1, "nome": "Teste", "siglaUf": "CE", "siglaPartido": "PT"}],
    )
    p = CamaraDeputadosPipeline()
    result = p.collect()
    assert isinstance(result, list)
    assert result[0]["id"] == 1


# ─── transform ─────────────────────────────────────────────────────────────────

def _make_tse_row(name, ballot, state, party, pid="uuid-1"):
    return {"Id": pid, "Name": name, "BallotName": ballot, "State": state, "PartyAcronym": party}


def test_transform_returns_dict_with_matched_unmatched_ambiguous(mocker):
    mocker.patch(
        "src.sources.camara.deputies.fetch_tse_federal_deputies",
        return_value=[_make_tse_row("JOSE SILVA", "ZE", "CE", "PT")],
    )
    camara = [{"id": 100, "nome": "Jose Silva", "siglaUf": "CE", "siglaPartido": "PT"}]
    result = CamaraDeputadosPipeline().transform(camara)
    assert "matched" in result
    assert "unmatched" in result
    assert "ambiguous" in result


def test_transform_matched_has_correct_fields(mocker):
    mocker.patch(
        "src.sources.camara.deputies.fetch_tse_federal_deputies",
        return_value=[_make_tse_row("JOSE SILVA", "ZE", "CE", "PT")],
    )
    camara = [{"id": 100, "nome": "Jose Silva", "siglaUf": "CE", "siglaPartido": "PT"}]
    result = CamaraDeputadosPipeline().transform(camara)
    assert len(result["matched"]) == 1
    m = result["matched"][0]
    assert m["politician_id"] == "uuid-1"
    assert m["camara_id"] == "100"
    assert m["confidence_level"] == 5
    assert m["match_method"] == "full_3way"
    assert "camara_photo_url" in m


def test_transform_unmatched_no_camara_id(mocker):
    mocker.patch(
        "src.sources.camara.deputies.fetch_tse_federal_deputies",
        return_value=[_make_tse_row("NINGUEM AQUI", "NINGUEM", "AC", "PT")],
    )
    camara = [{"id": 999, "nome": "Outro Nome", "siglaUf": "RO", "siglaPartido": "PT"}]
    result = CamaraDeputadosPipeline().transform(camara)
    assert len(result["unmatched"]) == 1
    assert len(result["matched"]) == 0


def test_transform_summary_logged(mocker, caplog):
    mocker.patch("src.sources.camara.deputies.fetch_tse_federal_deputies", return_value=[])
    CamaraDeputadosPipeline().transform([])
    # No crash on empty inputs
```

- [ ] **Step 4.2: Rodar e verificar falha**

```powershell
$env:PYTHONPATH = "C:\Users\Elias\Documents\RepBrasil\etl"
C:\Users\Elias\Documents\RepBrasil\etl\.venv\Scripts\python.exe -m pytest etl/tests/sources/camara/test_deputies.py -v
```

Esperado: `ImportError` (arquivo não existe).

- [ ] **Step 4.3: Implementar `etl/src/sources/camara/deputies.py`** (collect + transform; load no próximo task)

```python
import uuid
from datetime import UTC, datetime
from typing import Any

from loguru import logger

from src.db.connection import get_db
from src.pipeline.base import BasePipeline
from src.sources.camara.api import CAMARA_API_BASE, fetch_deputies
from src.sources.camara.normalizer import match_deputies

LEGISLATURE = 57
MANDATE_START = "2023-02-01"
MANDATE_END = "2027-01-31"

CAMARA_SOURCE_NAME = "Câmara dos Deputados API v2 — /deputados (57ª Legislatura)"
CAMARA_SOURCE_ORG = "Câmara dos Deputados"
CAMARA_SOURCE_URL = f"{CAMARA_API_BASE}/deputados"
CAMARA_SOURCE_LICENSE = "Dados Abertos"
PIPELINE_ID = "CamaraDeputadosPipeline"
PIPELINE_VERSION = "1.0.0"


def fetch_tse_federal_deputies(conn: Any) -> list[dict[str, Any]]:
    """Busca do DB os políticos TSE eleitos como DEPUTADO FEDERAL."""
    cur = conn.cursor()
    cur.execute("""
        SELECT DISTINCT p."Id", p."Name", p."BallotName", p."State", p."PartyAcronym"
        FROM "Politicians" p
        JOIN "ElectionResults" er ON er."PoliticianId" = p."Id"
        WHERE p."Office" ILIKE '%DEPUTADO FEDERAL%'
          AND er."Elected" = true
          AND p."DeletedAt" IS NULL
    """)
    rows = cur.fetchall()
    cur.close()
    return [
        {"Id": str(r[0]), "Name": r[1], "BallotName": r[2], "State": r[3], "PartyAcronym": r[4]}
        for r in rows
    ]


class CamaraDeputadosPipeline(BasePipeline):
    """
    Pipeline de matching TSE↔Câmara dos Deputados.

    collect(): Busca deputados via API paginada (57ª legislatura).
    transform(): Normaliza nomes e executa matching em 3 níveis de confiança.
    load(): UPDATE CamaraId + INSERT Mandate + TransformationChain + Evidence.
    """

    def __init__(self, legislature: int = LEGISLATURE) -> None:
        self.legislature = legislature

    def collect(self) -> list[dict[str, Any]]:
        return fetch_deputies(self.legislature)

    def transform(self, raw: list[dict[str, Any]]) -> dict[str, Any]:
        with get_db() as conn:
            tse_politicians = fetch_tse_federal_deputies(conn)

        logger.info(f"TSE deputados federais eleitos: {len(tse_politicians)}")
        logger.info(f"Câmara deputados coletados: {len(raw)}")

        # Enriquecer Câmara deputies com photo URL
        for dep in raw:
            dep["photo_url"] = dep.get(
                "urlFoto",
                f"https://www.camara.leg.br/internet/deputado/bandep/{dep['id']}.jpg",
            )

        all_results = match_deputies(raw, tse_politicians)

        matched = []
        unmatched = []
        ambiguous = []

        for r in all_results:
            if r["camara_id"] is not None:
                # Enriquecer com photo URL do match
                dep_lookup = {str(d["id"]): d for d in raw}
                dep = dep_lookup.get(r["camara_id"], {})
                r["camara_photo_url"] = dep.get("photo_url", "")
                r["camara_email"] = dep.get("email", "")
                matched.append(r)
            else:
                unmatched.append(r)

        logger.info(
            f"Resultado: {len(matched)} matched | "
            f"{len(unmatched)} sem match | "
            f"{len(ambiguous)} ambíguos"
        )
        for u in unmatched[:10]:
            logger.debug(f"Sem match: {u['tse_name']} ({u['tse_state']}/{u['tse_party']})")

        return {"matched": matched, "unmatched": unmatched, "ambiguous": ambiguous}

    def load(self, data: dict[str, Any]) -> None:
        # Implementado em Task 5
        raise NotImplementedError("load() será implementado em Task 5")
```

- [ ] **Step 4.4: Rodar testes**

```powershell
$env:PYTHONPATH = "C:\Users\Elias\Documents\RepBrasil\etl"
C:\Users\Elias\Documents\RepBrasil\etl\.venv\Scripts\python.exe -m pytest etl/tests/sources/camara/test_deputies.py -v
```

Esperado: todos os 5 testes passam (load ainda não está testado).

- [ ] **Step 4.5: Commitar**

```powershell
git -C "C:\Users\Elias\Documents\RepBrasil" add etl/src/sources/camara/deputies.py etl/tests/sources/camara/test_deputies.py
git -C "C:\Users\Elias\Documents\RepBrasil" commit -m "feat(etl): CamaraDeputadosPipeline — collect + transform com matching TSE↔Câmara"
```

---

## Task 5: `CamaraDeputadosPipeline.load()` — UPDATE CamaraId + Mandate + TransformationChain + Evidence

**Files:**
- Modify: `etl/src/sources/camara/deputies.py` (implementar `load()`)
- Modify: `etl/tests/sources/camara/test_deputies.py` (adicionar testes de load)

- [ ] **Step 5.1: Adicionar testes de load ao `test_deputies.py`**

Adicionar ao final de `etl/tests/sources/camara/test_deputies.py`:

```python
from decimal import Decimal


# ─── load ──────────────────────────────────────────────────────────────────────

def test_load_empty_matched_skips_db(mocker):
    mock_get_db = mocker.patch("src.sources.camara.deputies.get_db")
    # Mesmo com get_db mockado, load com matched=[] deve abrir conexão (para Source + Chain)
    # mas não rodar o loop de updates
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value = mock_cur
    mock_cur.fetchone.return_value = ("source-id",)
    mock_ctx = MagicMock()
    mock_ctx.__enter__ = MagicMock(return_value=mock_conn)
    mock_ctx.__exit__ = MagicMock(return_value=False)
    mock_get_db.return_value = mock_ctx

    CamaraDeputadosPipeline().load({"matched": [], "unmatched": [], "ambiguous": []})
    # execute chamado pelo menos para source upsert e chain insert
    assert mock_cur.execute.called


def test_load_updates_camara_id_for_matched(mocker):
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value = mock_cur
    mock_cur.fetchone.return_value = ("some-uuid",)
    mock_cur.fetchall.return_value = []
    mock_ctx = MagicMock()
    mock_ctx.__enter__ = MagicMock(return_value=mock_conn)
    mock_ctx.__exit__ = MagicMock(return_value=False)
    mocker.patch("src.sources.camara.deputies.get_db", return_value=mock_ctx)

    data = {
        "matched": [{
            "politician_id": "pol-uuid",
            "camara_id": "12345",
            "camara_name": "José Silva",
            "camara_photo_url": "https://camara.leg.br/foto/12345.jpg",
            "camara_email": "dep@camara.leg.br",
            "tse_name": "JOSE SILVA",
            "tse_ballot_name": "ZE SILVA",
            "tse_state": "CE",
            "tse_party": "PT",
            "match_method": "full_3way",
            "confidence_level": 5,
        }],
        "unmatched": [],
        "ambiguous": [],
    }

    CamaraDeputadosPipeline().load(data)

    # Verificar que UPDATE Politicians SET CamaraId foi chamado
    all_sqls = " ".join(str(call) for call in mock_cur.execute.call_args_list)
    assert "CamaraId" in all_sqls
    assert "Mandates" in all_sqls
```

- [ ] **Step 5.2: Rodar e verificar falha**

```powershell
$env:PYTHONPATH = "C:\Users\Elias\Documents\RepBrasil\etl"
C:\Users\Elias\Documents\RepBrasil\etl\.venv\Scripts\python.exe -m pytest etl/tests/sources/camara/test_deputies.py::test_load_updates_camara_id_for_matched -v
```

Esperado: `NotImplementedError`.

- [ ] **Step 5.3: Implementar `load()` em `deputies.py`**

Substituir o método `load()` pelo conteúdo abaixo (manter todo o resto do arquivo):

```python
    def load(self, data: dict[str, Any]) -> None:
        matched = data["matched"]
        now = datetime.now(UTC).isoformat()
        chain_id = str(uuid.uuid4())
        source_id = str(uuid.uuid4())

        with get_db() as conn:
            cur = conn.cursor()
            try:
                # ── 1. Source upsert ──────────────────────────────────────────
                cur.execute(
                    """
                    INSERT INTO "Sources"
                        ("Id","Name","Organization","SourceType","OriginalUrl",
                         "CollectedAt","License","CreatedAt","UpdatedAt")
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT ("Name","SourceType") DO UPDATE SET
                        "CollectedAt" = EXCLUDED."CollectedAt",
                        "UpdatedAt" = EXCLUDED."UpdatedAt"
                    RETURNING "Id"
                    """,
                    (
                        source_id, CAMARA_SOURCE_NAME, CAMARA_SOURCE_ORG, "api",
                        CAMARA_SOURCE_URL, now, CAMARA_SOURCE_LICENSE, now, now,
                    ),
                )
                source_id = str(cur.fetchone()[0])

                # ── 2. TransformationChain ────────────────────────────────────
                cur.execute(
                    """
                    INSERT INTO "TransformationChains"
                        ("Id","PipelineId","PipelineVersion","StartedAt","Status","CreatedAt","UpdatedAt")
                    VALUES (%s,%s,%s,%s,'Running',%s,%s)
                    """,
                    (chain_id, PIPELINE_ID, PIPELINE_VERSION, now, now, now),
                )

                # ── 3. Steps ─────────────────────────────────────────────────
                unmatched_count = len(data.get("unmatched", []))
                ambiguous_count = len(data.get("ambiguous", []))
                tse_sql = (
                    'SELECT DISTINCT p."Id",p."Name",p."BallotName",p."State",p."PartyAcronym" '
                    'FROM "Politicians" p JOIN "ElectionResults" er ON er."PoliticianId"=p."Id" '
                    'WHERE p."Office" ILIKE \'%DEPUTADO FEDERAL%\' AND er."Elected"=true AND p."DeletedAt" IS NULL'
                )
                steps = [
                    (
                        "collect_deputies",
                        f"Coleta de deputados via API Câmara — legislatura {self.legislature}",
                        _json.dumps({"source": CAMARA_SOURCE_URL, "legislature": self.legislature,
                                     "pipeline_version": PIPELINE_VERSION}),
                        f"api:{CAMARA_SOURCE_URL}",
                        None,
                    ),
                    (
                        "normalize_names",
                        "Normalização de nomes TSE e Câmara — remove acentos, lowercase, partículas PT-BR",
                        _json.dumps({"tse_query": tse_sql}),
                        "normalized_names",
                        None,
                    ),
                    (
                        "match_tse_camara",
                        (
                            f"Matching exact normalizado em 3 níveis (full_3way/ballot_3way/name_2way). "
                            f"Resultado: {len(matched)} matched, {unmatched_count} sem match, "
                            f"{ambiguous_count} ambíguos. pipeline_version={PIPELINE_VERSION}"
                        ),
                        _json.dumps({"algorithm": "exact_normalized_3level", "pipeline_version": PIPELINE_VERSION}),
                        _json.dumps({"matched": len(matched), "unmatched": unmatched_count,
                                     "ambiguous": ambiguous_count}),
                        None,
                    ),
                    (
                        "update_politicians",
                        f"UPDATE CamaraId + INSERT Mandates + Evidence (Derived) para {len(matched)} políticos",
                        None,
                        _json.dumps({"camara_ids_updated": len(matched), "mandates_inserted": len(matched),
                                     "evidences_inserted": len(matched)}),
                        None,
                    ),
                ]
                for order, (step_type, description, input_ref, output_ref, source_hash) in enumerate(steps, 1):
                    cur.execute(
                        """
                        INSERT INTO "TransformationSteps"
                            ("Id","ChainId","Order","StepType","Description","Parameters",
                             "InputReference","OutputReference","ExecutedAt","CreatedAt","UpdatedAt")
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        """,
                        (str(uuid.uuid4()), chain_id, order, step_type, description, None,
                         input_ref, output_ref, now, now, now),
                    )

                # ── 4. Loop: UPDATE CamaraId + INSERT Mandate + Evidence ──────
                updated = 0
                for m in matched:
                    pol_id = m["politician_id"]
                    camara_id = m["camara_id"]

                    # UPDATE Politician.CamaraId
                    cur.execute(
                        'UPDATE "Politicians" SET "CamaraId" = %s, "UpdatedAt" = %s WHERE "Id" = %s',
                        (camara_id, now, pol_id),
                    )

                    # INSERT/UPDATE Mandate
                    cur.execute(
                        """
                        INSERT INTO "Mandates"
                            ("Id","PoliticianId","House","Legislature","Title",
                             "State","PartyAcronym","StartDate","EndDate",
                             "ExternalId","ExternalUrl","SourceId","CreatedAt","UpdatedAt")
                        VALUES (%s,%s,'CAMARA',%s,'DEPUTADO FEDERAL',%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        ON CONFLICT ("PoliticianId","House","Legislature") DO UPDATE SET
                            "ExternalId" = EXCLUDED."ExternalId",
                            "ExternalUrl" = EXCLUDED."ExternalUrl",
                            "PartyAcronym" = EXCLUDED."PartyAcronym",
                            "SourceId" = EXCLUDED."SourceId",
                            "UpdatedAt" = EXCLUDED."UpdatedAt"
                        """,
                        (
                            str(uuid.uuid4()), pol_id, self.legislature,
                            m["tse_state"], m["tse_party"],
                            MANDATE_START, MANDATE_END,
                            camara_id,
                            f"https://www.camara.leg.br/deputados/{camara_id}",
                            source_id, now, now,
                        ),
                    )

                    # INSERT Evidence (rastrear decisão de matching)
                    import json as _json
                    cur.execute(
                        """
                        INSERT INTO "Evidences"
                            ("Id","SourceId","Description","EvidenceType","DatasetId",
                             "ConfidenceLevel","NormalizedReference","TransformationChainId",
                             "CollectedAt","ContestationStatus","Metadata","CreatedAt","UpdatedAt")
                        VALUES (%s,%s,%s,'Derived','camara-deputados-57',%s,%s,%s,%s,'None',%s,%s,%s)
                        """,
                        (
                            str(uuid.uuid4()), source_id,
                            f"Match TSE→Câmara: {m['tse_name']} [{m['tse_state']}/{m['tse_party']}] = CamaraId {camara_id} via {m['match_method']}",
                            m["confidence_level"],
                            f"https://dadosabertos.camara.leg.br/api/v2/deputados/{camara_id}",
                            chain_id, now,
                            _json.dumps({
                                "politician_id": pol_id,
                                "camara_id": camara_id,
                                "match_method": m["match_method"],
                                "camara_name": m["camara_name"],
                            }),
                            now, now,
                        ),
                    )
                    updated += 1

                # ── 5. Fechar TransformationChain ────────────────────────────
                cur.execute(
                    """
                    UPDATE "TransformationChains"
                    SET "Status" = 'Completed', "CompletedAt" = %s, "UpdatedAt" = %s
                    WHERE "Id" = %s
                    """,
                    (now, now, chain_id),
                )

            finally:
                cur.close()

        logger.info(
            f"Câmara load concluído: {updated} CamaraIds atualizados, "
            f"{updated} Mandates inseridos, {updated} Evidências registradas."
        )
```

- [ ] **Step 5.4: Rodar todos os testes do módulo camara**

```powershell
$env:PYTHONPATH = "C:\Users\Elias\Documents\RepBrasil\etl"
C:\Users\Elias\Documents\RepBrasil\etl\.venv\Scripts\python.exe -m pytest etl/tests/sources/camara/ -v
```

Esperado: todos passam.

- [ ] **Step 5.5: Rodar suite completa (sem regressões)**

```powershell
$env:PYTHONPATH = "C:\Users\Elias\Documents\RepBrasil\etl"
C:\Users\Elias\Documents\RepBrasil\etl\.venv\Scripts\python.exe -m pytest etl/tests/ -v --tb=short
```

Esperado: todos passam.

- [ ] **Step 5.6: Commitar**

```powershell
git -C "C:\Users\Elias\Documents\RepBrasil" add etl/src/sources/camara/deputies.py etl/tests/sources/camara/test_deputies.py
git -C "C:\Users\Elias\Documents\RepBrasil" commit -m "feat(etl): CamaraDeputadosPipeline.load() — UPDATE CamaraId + Mandate + TransformationChain + Evidence"
```

---

## Task 6: `seed_camara_deputados.py` — Driver Script

**Files:**
- Create: `etl/scripts/seed_camara_deputados.py`

- [ ] **Step 6.1: Criar o script**

```python
"""
seed_camara_deputados.py — Integração Câmara dos Deputados (G1-1).

Uso:
    cd etl
    $env:DATABASE_URL = "<RAILWAY_DATABASE_PUBLIC_URL>"
    $env:PYTHONPATH = "C:\\Users\\Elias\\Documents\\RepBrasil\\etl"
    .venv/Scripts/python.exe scripts/seed_camara_deputados.py

Pré-requisito: Pelo menos os politicians CE (ou Nordeste completo para cobertura total).
Idempotente: ON CONFLICT DO UPDATE em Mandates; UPDATE CamaraId é idempotente.

NÃO rodar durante migrations destrutivas.
SEGURO durante seed Nordeste (apenas SELECT em Politicians, UPDATE CamaraId, INSERT Mandates).
"""

import sys
import time
from datetime import UTC, datetime

import psycopg2
from loguru import logger

from src.db.connection import get_connection_string
from src.sources.camara.deputies import CamaraDeputadosPipeline

LEGISLATURE = 57

logger.remove()
logger.add(
    sys.stderr,
    format="<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | {message}",
    level="INFO",
)
_log_file = f"seed_camara_{datetime.now(UTC).strftime('%Y%m%d_%H%M%S')}.log"
logger.add(_log_file, level="DEBUG", rotation=None)
logger.info(f"Log em: {_log_file}")


def _get_counts(conn: psycopg2.extensions.connection) -> dict:
    cur = conn.cursor()
    counts = {}
    for t in ("Politicians", "Mandates"):
        try:
            cur.execute(f'SELECT COUNT(*) FROM "{t}" WHERE "DeletedAt" IS NULL')
            counts[t] = cur.fetchone()[0]
        except Exception:
            counts[t] = "N/A"
    cur.execute(
        'SELECT COUNT(*) FROM "Politicians" WHERE "CamaraId" IS NOT NULL AND "DeletedAt" IS NULL'
    )
    counts["Politicians_com_CamaraId"] = cur.fetchone()[0]
    cur.close()
    return counts


def main() -> None:
    logger.info(f"=== SEED CÂMARA G1-1 — legislatura {LEGISLATURE} ===")
    conn_str = get_connection_string()

    with psycopg2.connect(conn_str) as conn:
        pre = _get_counts(conn)
    logger.info(f"Pré-seed: {pre}")

    t0 = time.time()
    try:
        CamaraDeputadosPipeline(legislature=LEGISLATURE).run()
        elapsed = time.time() - t0
        logger.info(f"Pipeline concluído em {elapsed:.1f}s")
    except Exception:
        elapsed = time.time() - t0
        logger.exception(f"Pipeline falhou em {elapsed:.1f}s")
        sys.exit(1)

    with psycopg2.connect(conn_str) as conn:
        post = _get_counts(conn)

    logger.info("=== RESULTADO ===")
    for k in pre:
        delta = (post[k] - pre[k]) if isinstance(post[k], int) and isinstance(pre[k], int) else "?"
        sign = "+" if isinstance(delta, int) and delta >= 0 else ""
        logger.info(f"  {k}: {pre[k]} → {post[k]} ({sign}{delta})")
    logger.info("Seed Câmara G1-1 concluído.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 6.2: Verificar sintaxe**

```powershell
$env:DATABASE_URL = "dummy"
$env:PYTHONPATH = "C:\Users\Elias\Documents\RepBrasil\etl"
C:\Users\Elias\Documents\RepBrasil\etl\.venv\Scripts\python.exe -c "import ast; ast.parse(open(r'C:\Users\Elias\Documents\RepBrasil\etl\scripts\seed_camara_deputados.py').read()); print('OK')"
```

Esperado: `OK`

- [ ] **Step 6.3: Commitar**

```powershell
git -C "C:\Users\Elias\Documents\RepBrasil" add etl/scripts/seed_camara_deputados.py
git -C "C:\Users\Elias\Documents\RepBrasil" commit -m "feat(etl): seed_camara_deputados.py — driver G1-1 com validação pré/pós"
```

---

## Task 7: Backend — `GET /api/v1/politicians/{id}/mandates`

**Files:**
- Modify: `backend/src/RepBrasil.Api/Controllers/PoliticiansController.cs`

- [ ] **Step 7.1: Ler o controller atual para conhecer o padrão exato**

Ler `backend/src/RepBrasil.Api/Controllers/PoliticiansController.cs` completo antes de editar.

- [ ] **Step 7.2: Adicionar DTO e action ao controller**

Localizar o final do arquivo (antes do último `}` de fechamento da classe) e inserir:

```csharp
// ── Mandates ─────────────────────────────────────────────────────────────────

public record MandateResponse(
    Guid Id,
    string House,
    int Legislature,
    string? Title,
    string? State,
    string? PartyAcronym,
    DateTime? StartDate,
    DateTime? EndDate,
    string? ExternalId,
    string? ExternalUrl
);

[HttpGet("{id:guid}/mandates")]
public async Task<IActionResult> GetMandates(Guid id)
{
    var politician = await _db.Politicians
        .AsNoTracking()
        .FirstOrDefaultAsync(p => p.Id == id);

    if (politician is null)
        return NotFound();

    var mandates = await _db.Mandates
        .AsNoTracking()
        .Where(m => m.PoliticianId == id)
        .OrderByDescending(m => m.Legislature)
        .Select(m => new MandateResponse(
            m.Id, m.House, m.Legislature, m.Title,
            m.State, m.PartyAcronym, m.StartDate, m.EndDate,
            m.ExternalId, m.ExternalUrl
        ))
        .ToListAsync();

    return Ok(mandates);
}
```

- [ ] **Step 7.3: Buildar e verificar que compila**

```powershell
Set-Location "C:\Users\Elias\Documents\RepBrasil\backend"
dotnet build --configuration Release
```

Esperado: `Build succeeded. 0 Warning(s)`.

- [ ] **Step 7.4: Commitar**

```powershell
git -C "C:\Users\Elias\Documents\RepBrasil" add backend/src/RepBrasil.Api/Controllers/PoliticiansController.cs
git -C "C:\Users\Elias\Documents\RepBrasil" commit -m "feat(api): GET /api/v1/politicians/{id}/mandates — lista mandatos parlamentares"
```

- [ ] **Step 7.5: Deploy Railway**

```powershell
# Fazer push para main — Railway faz deploy automático
git -C "C:\Users\Elias\Documents\RepBrasil" push origin main
```

Aguardar deploy (Railway CI ~2-3 min). Verificar no dashboard ou via:
```powershell
Start-Sleep -Seconds 120
Invoke-RestMethod "https://back-production-8d1d.up.railway.app/api/v1/status"
```

> ⚠️ O deploy reinicia o backend mas NÃO o PostgreSQL. O seed Nordeste usa conexões diretas ao PostgreSQL e não é afetado pelo restart do backend.

---

## Task 8: Frontend — `CamaraTab` + PoliticianProfile

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/components/politicians/tabs/CamaraTab.tsx`
- Modify: `frontend/src/components/politicians/PoliticianProfile.tsx`

- [ ] **Step 8.1: Adicionar tipo `Mandate` em `types.ts`**

Ler `frontend/src/lib/types.ts` e adicionar ao final:

```typescript
export interface Mandate {
  id: string;
  house: string;
  legislature: number;
  title: string | null;
  state: string | null;
  partyAcronym: string | null;
  startDate: string | null;
  endDate: string | null;
  externalId: string | null;
  externalUrl: string | null;
}
```

- [ ] **Step 8.2: Adicionar `getMandates()` em `api.ts`**

Ler `frontend/src/lib/api.ts` e adicionar função seguindo o mesmo padrão das demais:

```typescript
export async function getMandates(id: string): Promise<Mandate[]> {
  const res = await fetch(`${API_BASE}/politicians/${id}/mandates`);
  if (!res.ok) throw new Error("Erro ao buscar mandatos");
  return res.json();
}
```

> Importar `Mandate` do types.ts no topo do arquivo se necessário.

- [ ] **Step 8.3: Verificar `next.config.js` — domínio Câmara em `remotePatterns`**

`next/image` com URLs externas requer allowlist. Ler `frontend/next.config.js` (ou `.mjs`). Se não houver `remotePatterns` para `www.camara.leg.br`, adicionar:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  // ... configurações existentes ...
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "www.camara.leg.br",
        pathname: "/internet/deputado/bandep/**",
      },
    ],
  },
};
```

> Alternativa se `next/image` com `unoptimized` for suficiente: `remotePatterns` não é estritamente necessário com `unoptimized={true}`, mas é boa prática declarar o domínio. Verificar se o lint exige.

- [ ] **Step 8.4: Criar `CamaraTab.tsx`**

```tsx
// frontend/src/components/politicians/tabs/CamaraTab.tsx
"use client";

import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { getMandates } from "@/lib/api";
import { Mandate } from "@/lib/types";

interface Props {
  politicianId: string;
  camaraId: string | null;
}

export function CamaraTab({ politicianId, camaraId }: Props) {
  const { data: mandates, isLoading, isError } = useQuery<Mandate[]>({
    queryKey: ["mandates", politicianId],
    queryFn: () => getMandates(politicianId),
  });

  if (isLoading) {
    return (
      <div className="text-sm text-zinc-400 py-8 text-center">
        Carregando dados da Câmara...
      </div>
    );
  }

  if (isError || !mandates) {
    return (
      <div className="text-sm text-red-400 py-8 text-center">
        Erro ao carregar dados da Câmara.
      </div>
    );
  }

  if (mandates.length === 0) {
    return (
      <div className="text-sm text-zinc-400 py-8 text-center">
        Nenhum mandato federal registrado para este político.
      </div>
    );
  }

  const mandate = mandates[0]; // Mandato mais recente

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-start gap-4">
        {camaraId && (
          <Image
            src={`https://www.camara.leg.br/internet/deputado/bandep/${camaraId}.jpg`}
            alt="Foto oficial Câmara"
            width={80}
            height={96}
            className="object-cover rounded border border-zinc-700"
            unoptimized
          />
        )}
        <div>
          <h3 className="text-lg font-semibold text-zinc-100">
            {mandate.title ?? "Deputado Federal"}
          </h3>
          <p className="text-sm text-zinc-400">
            {mandate.legislature}ª Legislatura · {mandate.state} · {mandate.partyAcronym}
          </p>
          {mandate.startDate && mandate.endDate && (
            <p className="text-xs text-zinc-500 mt-1">
              {new Date(mandate.startDate).getFullYear()} – {new Date(mandate.endDate).getFullYear()}
            </p>
          )}
        </div>
      </div>

      {/* Detalhes */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-zinc-500">ID Câmara</span>
          <p className="text-zinc-200 font-mono">{mandate.externalId ?? "—"}</p>
        </div>
        <div>
          <span className="text-zinc-500">Casa</span>
          <p className="text-zinc-200">{mandate.house}</p>
        </div>
        <div>
          <span className="text-zinc-500">Legislatura</span>
          <p className="text-zinc-200">{mandate.legislature}ª</p>
        </div>
        <div>
          <span className="text-zinc-500">Partido</span>
          <p className="text-zinc-200">{mandate.partyAcronym ?? "—"}</p>
        </div>
      </div>

      {/* Link externo */}
      {mandate.externalUrl && (
        <a
          href={mandate.externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          Ver perfil completo na Câmara dos Deputados ↗
        </a>
      )}

      {/* Múltiplos mandatos */}
      {mandates.length > 1 && (
        <div className="border-t border-zinc-800 pt-4">
          <p className="text-xs text-zinc-500 mb-2">Outros mandatos registrados:</p>
          <div className="space-y-1">
            {mandates.slice(1).map((m) => (
              <div key={m.id} className="text-xs text-zinc-400">
                {m.legislature}ª Legislatura · {m.house} · {m.partyAcronym}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 8.5: Adicionar tab "Câmara" em `PoliticianProfile.tsx`**

Ler `PoliticianProfile.tsx` completo. Localizar:
1. A definição do array `TABS`
2. O switch/map que renderiza o conteúdo de cada tab
3. A importação dos tab components no topo

**Modificação 1** — Importação:
```typescript
import { CamaraTab } from "./tabs/CamaraTab";
```

**Modificação 2** — Array TABS (adicionar tab nova):
```typescript
// Após { id: "assets", label: "Patrimônio" }:
...(politician.camaraId ? [{ id: "camara" as TabId, label: "Câmara" }] : []),
```

> Isso adiciona a tab "Câmara" apenas se `politician.camaraId` estiver preenchido. Sem dados não mostra.

**Modificação 3** — Tipo TabId:
```typescript
type TabId = "overview" | "elections" | "assets" | "metadata" | "score" | "camara";
```

**Modificação 4** — Renderização (no switch/map dos tabs):
```tsx
{activeTab === "camara" && (
  <CamaraTab
    politicianId={politician.id}
    camaraId={politician.camaraId ?? null}
  />
)}
```

**Modificação 5** — Garantir que `camaraId` está no tipo `Politician` em `types.ts`:
```typescript
// Adicionar ao interface Politician:
camaraId?: string | null;
```

- [ ] **Step 8.6: Verificar que o build do frontend passa**

```powershell
Set-Location "C:\Users\Elias\Documents\RepBrasil\frontend"
npm run build 2>&1 | Select-Object -Last 20
```

Esperado: `✓ Compiled successfully` ou `Route (app)` com todas as rotas.

- [ ] **Step 8.7: Commitar**

```powershell
git -C "C:\Users\Elias\Documents\RepBrasil" add frontend/next.config.js frontend/src/lib/types.ts frontend/src/lib/api.ts frontend/src/components/politicians/tabs/CamaraTab.tsx frontend/src/components/politicians/PoliticianProfile.tsx
git -C "C:\Users\Elias\Documents\RepBrasil" commit -m "feat(frontend): CamaraTab — mandato, foto oficial e link Câmara dos Deputados"
```

---

## Task 9: Execução + Smoke Test

> **Pré-requisito:** Seed Nordeste DEVE estar concluído para cobertura completa. Pode rodar com apenas CE se necessário (só matchará deputados CE).
>
> **Estratégia de execução sem interferir no seed Nordeste:**
> - `seed_camara_deputados.py` faz SELECT em `Politicians` e `ElectionResults` (read-only nas tabelas do seed)
> - UPDATE `CamaraId` em `Politicians` é row-level, não bloqueia INSERT de outros estados
> - INSERT em `Mandates` é nova tabela, zero conflito
> - Tempo estimado: ~5 min (API Câmara ~513 deputies, 1 page HTTP, matching em memória)

- [ ] **Step 9.1: Verificar que não há conexões idle bloqueando (opcional)**

```powershell
$env:DATABASE_URL = "<RAILWAY_DATABASE_PUBLIC_URL>"
$env:PYTHONPATH = "C:\Users\Elias\Documents\RepBrasil\etl"
Set-Location "C:\Users\Elias\Documents\RepBrasil\etl"
```

- [ ] **Step 9.2: Executar o seed**

```powershell
.venv\Scripts\python.exe scripts/seed_camara_deputados.py
```

Verificar nos logs:
- `Câmara deputados coletados: 513` (ou próximo)
- `TSE deputados federais eleitos: N` (todos estados seedados × ~8 deputados/estado)
- `Resultado: X matched | Y sem match | 0 ambíguos`
- `Câmara load concluído: X CamaraIds atualizados`

- [ ] **Step 9.3: Validar contagens no banco**

```python
# Salvar como etl/_validate_camara.py
import os, psycopg2
conn = psycopg2.connect(os.environ["DATABASE_URL"])
cur = conn.cursor()

cur.execute('SELECT COUNT(*) FROM "Mandates" WHERE "House" = \'CAMARA\' AND "DeletedAt" IS NULL')
mandates = cur.fetchone()[0]

cur.execute('SELECT COUNT(*) FROM "Politicians" WHERE "CamaraId" IS NOT NULL AND "DeletedAt" IS NULL')
with_camara_id = cur.fetchone()[0]

# Integridade: Mandates sem Politician
cur.execute('''
    SELECT COUNT(*) FROM "Mandates" m
    LEFT JOIN "Politicians" p ON m."PoliticianId" = p."Id"
    WHERE p."Id" IS NULL AND m."DeletedAt" IS NULL
''')
orphan = cur.fetchone()[0]

# Exemplo: deputado CE conhecido com CamaraId
cur.execute('''
    SELECT p."Name", p."CamaraId", m."Legislature"
    FROM "Politicians" p
    JOIN "Mandates" m ON m."PoliticianId" = p."Id"
    WHERE p."State" = 'CE' AND p."Office" ILIKE '%DEPUTADO FEDERAL%'
    LIMIT 5
''')
samples = cur.fetchall()

print(f"Mandates CAMARA   : {mandates:,}")
print(f"Politicians c/ CamaraId: {with_camara_id:,}")
print(f"Orphan Mandates   : {orphan}")
print(f"\nExemplos CE:")
for r in samples:
    print(f"  {r[0]} — CamaraId={r[1]} — Legislatura={r[2]}")

conn.close()
```

```powershell
.venv\Scripts\python.exe _validate_camara.py
```

Esperado: `Mandates > 0`, `Orphan = 0`, amostras CE com CamaraId preenchido.

- [ ] **Step 9.4: Smoke test — API backend**

Usar ID de um deputado CE com CamaraId (obtido no step anterior):

```powershell
# Substitua {politician_id} pelo ID real obtido na validação
$id = "..." # UUID do politician
Invoke-RestMethod "https://back-production-8d1d.up.railway.app/api/v1/politicians/$id/mandates"
```

Esperado:
```json
[{
  "id": "...",
  "house": "CAMARA",
  "legislature": 57,
  "title": "DEPUTADO FEDERAL",
  "state": "CE",
  "partyAcronym": "PT",
  "startDate": "2023-02-01T00:00:00",
  "endDate": "2027-01-31T00:00:00",
  "externalId": "204554",
  "externalUrl": "https://www.camara.leg.br/deputados/204554"
}]
```

- [ ] **Step 9.5: Smoke test — Frontend**

1. Acessar `https://repbrasil.up.railway.app/politicos`
2. Buscar o deputado CE usado no step anterior
3. Clicar no perfil
4. Verificar que a aba "Câmara" aparece (apenas para políticos com CamaraId)
5. Verificar que exibe: foto oficial da Câmara, legislatura, partido, link externo

- [ ] **Step 9.6: Limpar arquivos temporários e commitar relatório**

```powershell
Remove-Item "C:\Users\Elias\Documents\RepBrasil\etl\_validate_camara.py" -ErrorAction SilentlyContinue
```

Criar `docs/metrics/camara-g1-1-report.md` com os valores reais coletados (contagens, % matched, ambíguos, tempo).

```powershell
git -C "C:\Users\Elias\Documents\RepBrasil" add docs/metrics/camara-g1-1-report.md
git -C "C:\Users\Elias\Documents\RepBrasil" commit -m "docs(metrics): camara-g1-1-report — matching TSE↔Câmara concluído"
```

---

## Estratégia de Execução sem Interferir no Seed Nordeste

| Ação | Impacto nas tabelas do seed | Seguro? |
|---|---|---|
| Task 1-2: criar arquivos ETL | Nenhum (apenas arquivos) | ✅ |
| Task 3: migration `AddMandate` | Cria nova tabela, sem ALTER em tabelas existentes | ✅ |
| Task 4-6: criar pipeline | Nenhum até rodar o seed | ✅ |
| Task 7-8: backend + frontend | Deploy reinicia backend, não o PostgreSQL | ✅ |
| Task 9: rodar `seed_camara_deputados.py` | SELECT em Politicians (read-only no seed), UPDATE CamaraId (row-level, não bloqueia INSERT de outros estados), INSERT em nova tabela Mandates | ✅ (pode rodar em paralelo, mas recomendado após seed Nordeste para cobertura completa) |

**Regras absolutas durante seed Nordeste:**
- ❌ Não alterar schema de `Politicians`, `ElectionResults`, `AssetDeclarations`, `AssetItems`
- ❌ Não reiniciar Railway PostgreSQL
- ❌ Não rodar migrations destrutivas
- ✅ Tasks 1–8 são completamente seguras a qualquer momento
- ⚠️ Task 9 (execução do seed Câmara): seguro tecnicamente, mas melhor após Nordeste para ter todos os deputados nordestinos no banco

---

## Self-Review

### Cobertura dos 13 requisitos do spec

| Requisito | Coberto em |
|---|---|
| 1. Fontes/endpoints oficiais | Seção "Fonte Oficial" + Task 2 (api.py) |
| 2. Entidades atuais impactadas | Seção "Entidades Impactadas" |
| 3. Novas entidades necessárias | Mandate entity — Task 3 |
| 4. Estratégia matching TSE↔Câmara | Seção "Estratégia de Matching" + Task 1 |
| 5. Riscos de homônimos | Seção "Risco de homônimos" + test_match_deputies_ambiguous_skipped |
| 6. Evidências e Source | Task 5 load() — Source upsert + Evidence INSERT por match |
| 7. TransformationChain | Task 5 load() — Chain + 4 Steps |
| 8. ETL batch | CamaraDeputadosPipeline (collect paginado + load em get_db) |
| 9. Endpoints backend | Task 7 — GET /api/v1/politicians/{id}/mandates |
| 10. Impacto no frontend | Task 8 — CamaraTab + PoliticianProfile |
| 11. Testes | Tasks 1, 2, 4, 5 — 20+ testes unitários |
| 12. Smoke test | Task 9 — API + frontend |
| 13. Execução sem interferir no seed | Seção "Estratégia de Execução" + Task 9 Step 1 |

### Nenhum placeholder encontrado.

### Consistência de tipos

- `Mandate` DB record: `PoliticianId (Guid)`, `House (string)`, `Legislature (int)`, `ExternalId (string?)` — consistente em Task 3, 5, 7
- `MandateResponse` DTO: campos idênticos aos usados no frontend `Mandate` type
- `fetch_tse_federal_deputies()` retorna `list[dict]` com keys `Id, Name, BallotName, State, PartyAcronym` — consistente com `match_deputies()` em Task 1
- `match_deputies()` retorna `list[dict]` com keys `politician_id, camara_id, confidence_level, match_method` — consistente com Task 5 `load()`
- `build_camara_index()` usa tuples `(norm, uf, party)` e `(norm, uf)` — consistente com `match_deputies()` internamente
