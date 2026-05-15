# REPBrasil Fase 0 — Bloco 5: Scaffold do ETL

> **Para execução:** Use `superpowers:subagent-driven-development` ou `superpowers:executing-plans`.
> **Depende de:** Bloco 1 (pastas `etl/` criadas). Python 3.12 e `uv` instalados.

**Objetivo:** Criar a estrutura do ETL em Python com `pyproject.toml` funcional, classe abstrata `BasePipeline`, schema Pydantic básico, placeholders para os dois primeiros pipelines (TSE e Câmara) e tooling configurado (`ruff`, `mypy`, `pytest`). O resultado deve passar em `uv sync`, `uv run ruff check .` e `uv run mypy src/`.

---

## Arquivos criados

```
etl/
├── pyproject.toml
├── .python-version
├── README.md
└── src/
    ├── __init__.py
    ├── sources/
    │   ├── __init__.py
    │   ├── tse/
    │   │   └── __init__.py
    │   └── camara/
    │       └── __init__.py
    ├── models/
    │   ├── __init__.py
    │   └── politician.py
    └── pipeline/
        ├── __init__.py
        └── base.py
```

---

## Decisões arquiteturais

- **`uv`** como gerenciador de pacotes: mais rápido que pip/poetry, determinístico com `uv.lock`.
- **`BasePipeline` abstrata**: cada fonte implementa `collect()`, `transform()` e `load()`. O método `run()` orquestra os três. Garante interface consistente para todos os pipelines futuros.
- **Pydantic v2 para validação**: dados coletados são validados antes de chegar no banco. Erros de schema são capturados cedo no pipeline.
- **`Polars` em vez de Pandas**: mais rápido para datasets grandes (bases TSE têm milhões de linhas), API mais previsível.
- **`Loguru`** para logs: logs estruturados desde o início, sem configuração manual do `logging` padrão.
- **`Tenacity`** para retry: APIs governamentais são instáveis — retry automático com backoff exponencial é essencial.
- **Placeholders explícitos**: `tse/__init__.py` e `camara/__init__.py` contêm apenas `TODO` estruturado — não há nada funcional ainda. Isso orienta o contribuidor da Fase 1 sem fingir que algo funciona.
- **`mypy` com `strict = false` na Fase 0**: apenas checagem básica. Strict será ativado progressivamente.

---

## Steps

- [ ] **1. Verificar pré-requisitos**

```bash
python --version    # deve ser 3.12.x
uv --version        # deve estar instalado
```

Se `uv` não estiver instalado:
```bash
pip install uv
# ou no Windows:
# curl -LsSf https://astral.sh/uv/install.sh | sh
```

- [ ] **2. Criar `etl/.python-version`**

```
3.12
```

- [ ] **3. Criar `etl/pyproject.toml`**

```toml
[project]
name = "repbrasil-etl"
version = "0.1.0"
description = "Pipelines de coleta e processamento de dados públicos para o REPBrasil"
requires-python = ">=3.12"
dependencies = [
    "httpx>=0.27.0",
    "polars>=1.0.0",
    "pydantic>=2.0.0",
    "loguru>=0.7.0",
    "tenacity>=9.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.23.0",
    "ruff>=0.4.0",
    "mypy>=1.10.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "W", "F", "I", "B", "C4", "UP"]
ignore = ["E501"]

[tool.mypy]
python_version = "3.12"
warn_return_any = false
warn_unused_configs = true
ignore_missing_imports = true

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
```

- [ ] **4. Criar `etl/README.md`**

```markdown
# REPBrasil ETL

Pipelines de coleta, transformação e carga de dados públicos oficiais.

## Stack

- Python 3.12
- uv (gerenciador de pacotes)
- Polars (transformação de dados)
- Pydantic v2 (validação de schema)
- httpx (chamadas HTTP)
- Loguru (logs estruturados)
- Tenacity (retry automático)

## Setup

```bash
# Instalar dependências
uv sync --extra dev

# Ativar ambiente virtual (opcional — uv run gerencia automaticamente)
source .venv/bin/activate   # Linux/macOS
.venv\Scripts\activate      # Windows
```

## Comandos

```bash
# Lint
uv run ruff check .

# Lint com correção automática
uv run ruff check . --fix

# Typecheck
uv run mypy src/

# Testes
uv run pytest

# Testes com cobertura
uv run pytest --tb=short -v
```

## Estrutura

```
src/
├── sources/          # Um subpacote por fonte de dados
│   ├── tse/          # Tribunal Superior Eleitoral
│   └── camara/       # Câmara dos Deputados
├── models/           # Schemas Pydantic para validação
└── pipeline/         # Classe base e orquestração
```

## Como adicionar um novo pipeline

1. Criar subpasta em `src/sources/<nome-da-fonte>/`
2. Criar classe que herda de `BasePipeline`
3. Implementar `collect()`, `transform()`, `load()`
4. Adicionar entrada na matriz de fontes em `docs/matriz-de-fontes.md`
5. Escrever testes em `tests/sources/<nome-da-fonte>/`

## Fase atual

**Fase 0 — Fundação.** Nenhum pipeline está funcional.
A estrutura existe para orientar os contribuidores da Fase 1.
```

- [ ] **5. Criar `etl/src/__init__.py`**

```python
```

(arquivo vazio — necessário para que `src` seja um pacote Python)

- [ ] **6. Criar `etl/src/pipeline/__init__.py`**

```python
from .base import BasePipeline

__all__ = ["BasePipeline"]
```

- [ ] **7. Criar `etl/src/pipeline/base.py`**

```python
from abc import ABC, abstractmethod
from typing import Any

from loguru import logger


class BasePipeline(ABC):
    """
    Interface base para todos os pipelines de coleta do REPBrasil.

    Todo pipeline implementa três etapas:
    - collect(): busca dados brutos da fonte
    - transform(): valida e transforma os dados
    - load(): persiste no banco de dados

    Use run() para executar o pipeline completo.
    """

    @property
    def name(self) -> str:
        return self.__class__.__name__

    @abstractmethod
    def collect(self) -> Any:
        """Coleta dados brutos da fonte oficial."""
        ...

    @abstractmethod
    def transform(self, raw: Any) -> Any:
        """Valida e transforma os dados brutos para o schema interno."""
        ...

    @abstractmethod
    def load(self, data: Any) -> None:
        """Persiste os dados transformados no destino (PostgreSQL, Neo4j)."""
        ...

    def run(self) -> None:
        """Executa collect → transform → load com logging."""
        logger.info(f"[{self.name}] Iniciando pipeline")
        try:
            raw = self.collect()
            logger.info(f"[{self.name}] Coleta concluída")
            data = self.transform(raw)
            logger.info(f"[{self.name}] Transformação concluída")
            self.load(data)
            logger.info(f"[{self.name}] Carga concluída")
        except Exception as e:
            logger.error(f"[{self.name}] Erro no pipeline: {e}")
            raise
```

- [ ] **8. Criar `etl/src/models/__init__.py`**

```python
from .politician import PoliticianSchema

__all__ = ["PoliticianSchema"]
```

- [ ] **9. Criar `etl/src/models/politician.py`**

```python
from datetime import datetime
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class PoliticianSchema(BaseModel):
    """
    Schema de validação para dados de político coletados de fontes externas.
    Usado nos pipelines de transformação antes de persistir no PostgreSQL.
    """

    id: UUID = Field(default_factory=uuid4)
    name: str
    ballot_name: str
    tse_id: str | None = None
    camara_id: str | None = None
    senate_id: str | None = None
    collected_at: datetime = Field(default_factory=datetime.utcnow)
    source_url: str | None = None

    model_config = {"str_strip_whitespace": True}
```

- [ ] **10. Criar `etl/src/sources/__init__.py`**

```python
```

(arquivo vazio)

- [ ] **11. Criar `etl/src/sources/tse/__init__.py`**

```python
"""
Pipeline TSE — Tribunal Superior Eleitoral.

Fontes planejadas:
- Candidatos (dados.tse.jus.br/candidatos)
- Bens declarados (dados.tse.jus.br/candidatos/download)
- Resultados eleitorais (dados.tse.jus.br/eleicoes/eleicoes)
- Filiação partidária (dados.tse.jus.br/partidos/filiados)

Status: Fase 0 — placeholder. Implementação na Fase 1.

TODO (Fase 1):
- Implementar TseCandidatesPipeline(BasePipeline)
- Implementar TseAssetsPipeline(BasePipeline)
- Implementar TseResultsPipeline(BasePipeline)
- Implementar TsePartyMembershipPipeline(BasePipeline)
"""
```

- [ ] **12. Criar `etl/src/sources/camara/__init__.py`**

```python
"""
Pipeline Câmara dos Deputados.

Fontes planejadas:
- Deputados (dadosabertos.camara.leg.br/api/v2/deputados)
- Votações (dadosabertos.camara.leg.br/api/v2/votacoes)
- Despesas (dadosabertos.camara.leg.br/api/v2/deputados/{id}/despesas)
- Proposições (dadosabertos.camara.leg.br/api/v2/proposicoes)

Status: Fase 0 — placeholder. Implementação na Fase 1.

TODO (Fase 1):
- Implementar CamaraDeputadosPipeline(BasePipeline)
- Implementar CamaraExpensesPipeline(BasePipeline)
- Implementar CamaraVotesPipeline(BasePipeline)
"""
```

- [ ] **13. Instalar dependências**

```bash
cd etl
uv sync --extra dev
```

Esperado: `uv.lock` criado, ambiente virtual em `.venv/`, saída terminando com `Installed N packages`.

- [ ] **14. Rodar lint**

```bash
uv run ruff check .
```

Esperado: sem output (sem erros de lint).

- [ ] **15. Rodar typecheck**

```bash
uv run mypy src/
```

Esperado:
```
Success: no issues found in N source files
```

- [ ] **16. Rodar testes (estrutura vazia)**

```bash
uv run pytest
```

Esperado: `no tests ran` ou `0 passed` — não há testes ainda na Fase 0, mas o comando deve funcionar sem erro.

- [ ] **17. Commit**

```bash
cd ..
git add etl/
git commit -m "feat(etl): scaffold Python com BasePipeline, schemas Pydantic, tooling ruff/mypy/pytest"
git push
```

---

## Critérios de sucesso

- [ ] `uv sync --extra dev` completa sem erro
- [ ] `uv run ruff check .` retorna sem erros
- [ ] `uv run mypy src/` retorna `Success: no issues found`
- [ ] `uv run pytest` executa sem crash
- [ ] `BasePipeline` tem `collect()`, `transform()`, `load()`, `run()` documentados
- [ ] `PoliticianSchema` valida campos obrigatórios com Pydantic v2
- [ ] `tse/__init__.py` e `camara/__init__.py` têm TODOs estruturados para Fase 1

---

## Riscos / Pontos de atenção

| Risco | Mitigação |
|-------|-----------|
| `uv` não disponível no PATH | Instalar conforme documentação em astral.sh/uv |
| Python 3.12 não disponível | Instalar via `uv python install 3.12` |
| `mypy` reclamando de `loguru` sem stubs | `ignore_missing_imports = true` já configurado no `pyproject.toml` |
| `hatchling` não reconhecido como build backend | Garantir que `pyproject.toml` está correto antes de `uv sync` |
| `src/` não sendo reconhecido como pacote | Garantir `src/__init__.py` vazio criado no Step 5 |
