# Seed Controlado CE — Staging Railway

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carregar todos os candidatos, resultados eleitorais e bens declarados TSE 2024 do estado do Ceará no staging Railway com deduplicação, integridade e relatório final.

**Architecture:** Adicionar `state_filter` e `tse_ids_filter` aos três pipelines TSE existentes de forma incremental (patch mínimo — preservando `load()`, `Sources`, idempotência e logs existentes), criar script orquestrador `seed_ce.py` com métricas pre/post, executar contra Railway via `DATABASE_URL` (variável de ambiente — nunca hardcoded), gerar `docs/metrics/staging-seed-report.md`.

**Tech Stack:** Python 3.12, Polars, psycopg2, loguru, pipelines TSE existentes (`TseCandidatesPipeline`, `TseResultsPipeline`, `TseAssetsPipeline`), Railway Postgres (acesso via `DATABASE_URL` exportado da variável `DATABASE_PUBLIC_URL` do serviço).

> ⚠️ **REGRA DE SEGURANÇA PERMANENTE**
> Nunca commitar `DATABASE_URL` real, senha, token ou credencial em qualquer arquivo versionado.
> Credenciais são sempre variáveis de ambiente na sessão local — nunca em código, plano ou doc.

---

## Mapa de Arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `etl/src/sources/tse/candidates.py` | Patch incremental | Adicionar `state_filter` ao `__init__` e bloco de filtro no início de `transform` |
| `etl/src/sources/tse/results.py` | Patch incremental | Adicionar `state_filter` ao `__init__` e bloco de filtro no início de `transform` |
| `etl/src/sources/tse/assets.py` | Patch incremental | Adicionar `tse_ids_filter` ao `__init__` e bloco de filtro no início de `transform` |
| `etl/scripts/__init__.py` | Criar | Pacote vazio |
| `etl/scripts/seed_ce.py` | Criar | Orquestrador: métricas pre/post, timing, execução sequencial dos 3 pipelines |
| `docs/metrics/staging-seed-report.md` | Criar | Relatório final preenchido com valores reais após execução |

**Invariante para Tasks 1–3:** O método `load()` de cada pipeline não é tocado. O seed de `Sources`, os upserts ON CONFLICT e todos os logs existentes são preservados integralmente. Apenas o `__init__` e o início de `transform` recebem patch mínimo.

---

## Task 0: Verificar conectividade com Railway Postgres

**Files:** nenhum arquivo permanente — validação apenas.

- [ ] **Step 0.1: Obter DATABASE_PUBLIC_URL do Railway CLI e exportar**

```powershell
# Obter a URL pública do Postgres (exibe no terminal — NÃO redirecionar para arquivo)
railway variables --service back
# Copiar o valor de DATABASE_PUBLIC_URL da saída acima e exportar na sessão:
$env:DATABASE_URL = "<RAILWAY_DATABASE_PUBLIC_URL>"
# Exemplo de formato (nunca commitar o valor real):
# $env:DATABASE_URL = "postgresql://postgres:<SENHA>@<HOST>:<PORTA>/railway"
```

- [ ] **Step 0.2: Confirmar conexão e estado atual do banco**

```powershell
cd C:\Users\Elias\Documents\RepBrasil\etl
.\.venv\Scripts\python.exe -c "
import os, psycopg2
conn = psycopg2.connect(os.environ['DATABASE_URL'])
cur = conn.cursor()
queries = [
    ('Politicians',       'SELECT COUNT(*) FROM \"Politicians\" WHERE \"DeletedAt\" IS NULL'),
    ('ElectionResults',   'SELECT COUNT(*) FROM \"ElectionResults\" WHERE \"DeletedAt\" IS NULL'),
    ('Elections',         'SELECT COUNT(*) FROM \"Elections\" WHERE \"DeletedAt\" IS NULL'),
    ('AssetDeclarations', 'SELECT COUNT(*) FROM \"AssetDeclarations\" WHERE \"DeletedAt\" IS NULL'),
    ('AssetItems',        'SELECT COUNT(*) FROM \"AssetItems\" WHERE \"DeletedAt\" IS NULL'),
    ('Sources',           'SELECT COUNT(*) FROM \"Sources\" WHERE \"DeletedAt\" IS NULL'),
    ('DB size',           'SELECT pg_size_pretty(pg_database_size(current_database()))'),
]
print('=== ESTADO PRÉ-SEED ===')
for name, q in queries:
    cur.execute(q)
    print(f'  {name}: {cur.fetchone()[0]}')
conn.close()
"
```

Saída esperada (valores do seed anterior): `Politicians: 1000`, `ElectionResults: 4`, etc.
Se falhar com timeout/connection refused: verificar se `DATABASE_URL` foi exportada corretamente.

---

## Task 1: Patch incremental em TseCandidatesPipeline — adicionar state_filter

**Files:**
- Modify: `etl/src/sources/tse/candidates.py`

**Princípio:** Patch mínimo. Preservar `load()`, seed de `Sources`, ON CONFLICT, todos os logs. Apenas adicionar parâmetro e bloco de filtro.

- [ ] **Step 1.1: Ler o arquivo atual antes de editar**

```powershell
Get-Content C:\Users\Elias\Documents\RepBrasil\etl\src\sources\tse\candidates.py
```

Confirmar que `load()` e os logs existentes estão intactos antes de qualquer mudança.

- [ ] **Step 1.2: Patch no __init__ — adicionar state_filter**

Localizar a linha:
```python
    def __init__(self, limit: int | None = None) -> None:
        self.limit = limit
```

Substituir por:
```python
    def __init__(self, limit: int | None = None, state_filter: str | None = None) -> None:
        self.limit = limit
        self.state_filter = state_filter.upper() if state_filter else None
```

- [ ] **Step 1.3: Patch no transform — adicionar bloco de filtro após select/rename**

No método `transform`, localizar o bloco que faz `raw.select(available)` e `df.rename(...)`.
Após o rename (quando `df` já tem os nomes internos com coluna `state`), inserir:

```python
        # Filtro de UF — aplicado APÓS rename, opera em coluna "state"
        if self.state_filter and "state" in df.columns:
            before = len(df)
            df = df.filter(pl.col("state") == self.state_filter)
            logger.info(f"Filtro UF={self.state_filter}: {before} → {len(df)} registros")
```

**Atenção:** No COLUMN_MAP, `"SG_UF"` é mapeado para `"state"`. Após o rename, a coluna se chama `state`. O filtro opera no nome pós-rename.

O restante de `transform` (filtro de `VALID_STATUSES`, `self.limit`, construção de `records`) permanece idêntico.

- [ ] **Step 1.4: Verificar que load() não foi alterado**

```powershell
Get-Content C:\Users\Elias\Documents\RepBrasil\etl\src\sources\tse\candidates.py | Select-String -Pattern "def load|INSERT INTO|ON CONFLICT|Sources"
```

Saída esperada: todas as linhas do `load()` original presentes e inalteradas.

- [ ] **Step 1.5: Testar sintaxe**

```powershell
cd C:\Users\Elias\Documents\RepBrasil\etl
.\.venv\Scripts\python.exe -c "
from src.sources.tse.candidates import TseCandidatesPipeline
p = TseCandidatesPipeline(state_filter='CE')
print('state_filter:', p.state_filter)
p2 = TseCandidatesPipeline()
print('sem filtro:', p2.state_filter)
"
```

Saída esperada:
```
state_filter: CE
sem filtro: None
```

- [ ] **Step 1.6: Commitar**

```bash
git add etl/src/sources/tse/candidates.py
git commit -m "feat(etl): state_filter em TseCandidatesPipeline — patch incremental"
```

---

## Task 2: Patch incremental em TseResultsPipeline — adicionar state_filter

**Files:**
- Modify: `etl/src/sources/tse/results.py`

**Princípio:** Mesmo que Task 1 — patch mínimo, `load()` intocado.

- [ ] **Step 2.1: Ler o arquivo atual antes de editar**

```powershell
Get-Content C:\Users\Elias\Documents\RepBrasil\etl\src\sources\tse\results.py
```

- [ ] **Step 2.2: Patch no __init__ — adicionar state_filter**

Localizar:
```python
    def __init__(self, limit: int | None = None) -> None:
        self.limit = limit
```

Substituir por:
```python
    def __init__(self, limit: int | None = None, state_filter: str | None = None) -> None:
        self.limit = limit
        self.state_filter = state_filter.upper() if state_filter else None
```

- [ ] **Step 2.3: Patch no transform — adicionar bloco de filtro**

No método `transform`, logo após `df = raw.select(available)` e antes do primeiro `with_columns`, inserir:

```python
        # Filtro de UF — aplicado sobre coluna original SG_UF antes de qualquer cast
        if self.state_filter and "SG_UF" in df.columns:
            before = len(df)
            df = df.filter(pl.col("SG_UF") == self.state_filter)
            logger.info(f"Filtro UF={self.state_filter}: {before} → {len(df)} linhas")
```

**Atenção:** No pipeline de resultados o rename não acontece — as colunas TSE originais (SG_UF, SQ_CANDIDATO, etc.) são usadas até o final do transform. O filtro opera em `SG_UF`.

O restante de `transform` (casts, group_by, agg, construção de records) e todo o `load()` permanecem idênticos.

- [ ] **Step 2.4: Verificar que load() não foi alterado**

```powershell
Get-Content C:\Users\Elias\Documents\RepBrasil\etl\src\sources\tse\results.py | Select-String -Pattern "def load|INSERT INTO|ON CONFLICT|Sources|tse_to_politician"
```

Saída esperada: todas as linhas do `load()` original presentes.

- [ ] **Step 2.5: Testar sintaxe**

```powershell
.\.venv\Scripts\python.exe -c "
from src.sources.tse.results import TseResultsPipeline
p = TseResultsPipeline(state_filter='CE')
print('state_filter:', p.state_filter)
"
```

Saída esperada: `state_filter: CE`

- [ ] **Step 2.6: Commitar**

```bash
git add etl/src/sources/tse/results.py
git commit -m "feat(etl): state_filter em TseResultsPipeline — patch incremental"
```

---

## Task 3: Patch incremental em TseAssetsPipeline — adicionar tse_ids_filter

**Files:**
- Modify: `etl/src/sources/tse/assets.py`

**Por que tse_ids_filter e não state_filter:** O CSV de bens (`bem_candidato_2024_BRASIL.csv`) não contém coluna de UF — apenas `SQ_CANDIDATO`. O filtro precisa ser pelo conjunto de TseIds dos políticos CE já carregados.

**Princípio:** Patch mínimo, `load()` intocado.

- [ ] **Step 3.1: Ler o arquivo atual antes de editar**

```powershell
Get-Content C:\Users\Elias\Documents\RepBrasil\etl\src\sources\tse\assets.py
```

- [ ] **Step 3.2: Patch no __init__ — adicionar tse_ids_filter**

Localizar:
```python
    def __init__(self, limit: int | None = None) -> None:
        self.limit = limit
```

Substituir por:
```python
    def __init__(
        self,
        limit: int | None = None,
        tse_ids_filter: set[str] | None = None,
    ) -> None:
        self.limit = limit
        self.tse_ids_filter = tse_ids_filter
```

- [ ] **Step 3.3: Patch no transform — adicionar bloco de filtro**

No método `transform`, logo após `df = raw.select(available)` e antes do bloco `if self.limit:`, inserir:

```python
        # Filtro por TseIds específicos — evita iterar todo o BRASIL para candidatos de uma UF
        if self.tse_ids_filter is not None and "SQ_CANDIDATO" in df.columns:
            before = len(df)
            df = df.filter(pl.col("SQ_CANDIDATO").is_in(list(self.tse_ids_filter)))
            logger.info(
                f"Filtro tse_ids ({len(self.tse_ids_filter)} IDs): "
                f"{before} → {len(df)} linhas"
            )
```

O restante de `transform` (bloco `if self.limit:`, loop `for row in df.iter_rows`) e todo o `load()` permanecem idênticos.

- [ ] **Step 3.4: Verificar que load() não foi alterado**

```powershell
Get-Content C:\Users\Elias\Documents\RepBrasil\etl\src\sources\tse\assets.py | Select-String -Pattern "def load|INSERT INTO|ON CONFLICT|Sources|tse_to_politician"
```

Saída esperada: todas as linhas do `load()` original presentes.

- [ ] **Step 3.5: Testar sintaxe**

```powershell
.\.venv\Scripts\python.exe -c "
from src.sources.tse.assets import TseAssetsPipeline
p = TseAssetsPipeline(tse_ids_filter={'123', '456'})
print('tse_ids_filter size:', len(p.tse_ids_filter))
p2 = TseAssetsPipeline()
print('sem filtro:', p2.tse_ids_filter)
"
```

Saída esperada:
```
tse_ids_filter size: 2
sem filtro: None
```

- [ ] **Step 3.6: Commitar**

```bash
git add etl/src/sources/tse/assets.py
git commit -m "feat(etl): tse_ids_filter em TseAssetsPipeline — patch incremental"
```

---

## Task 4: Criar script orquestrador seed_ce.py

**Files:**
- Create: `etl/scripts/__init__.py`
- Create: `etl/scripts/seed_ce.py`

- [ ] **Step 4.1: Criar pacote scripts**

```powershell
New-Item -Path "C:\Users\Elias\Documents\RepBrasil\etl\scripts\__init__.py" -ItemType File -Force
```

Arquivo fica vazio.

- [ ] **Step 4.2: Criar etl/scripts/seed_ce.py**

```python
"""
seed_ce.py — Carga controlada TSE 2024 (Ceará) no staging Railway.

Uso:
    cd etl
    # Exportar DATABASE_URL na sessão (nunca hardcodar):
    # $env:DATABASE_URL = "<RAILWAY_DATABASE_PUBLIC_URL>"
    .\.venv\Scripts\python.exe scripts/seed_ce.py

Requisitos:
    - DATABASE_URL definida no ambiente (variável de sessão local)
    - Pipelines TSE disponíveis e com patches de state_filter aplicados
    - CSVs TSE 2024 em data/raw/tse/ (baixados automaticamente se ausentes)

Comportamento:
    - Aborta se candidatos falharem (resultados e bens dependem deles)
    - Continua se resultados ou bens falharem (documenta, não aborta)
    - Nunca improvisa arquitetura nova — falha limpa e documentada
"""

import sys
import time
from datetime import UTC, datetime

import psycopg2
from loguru import logger

from src.db.connection import get_connection_string
from src.sources.tse.assets import TseAssetsPipeline
from src.sources.tse.candidates import TseCandidatesPipeline
from src.sources.tse.results import TseResultsPipeline

STATE = "CE"

# Logging: stderr (colorido) + arquivo de log com timestamp
logger.remove()
logger.add(
    sys.stderr,
    format="<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | {message}",
    level="INFO",
)
_log_file = f"seed_ce_{datetime.now(UTC).strftime('%Y%m%d_%H%M%S')}.log"
logger.add(_log_file, level="DEBUG", rotation=None)
logger.info(f"Log detalhado em: {_log_file}")


def get_table_counts(conn: psycopg2.extensions.connection) -> dict[str, int]:
    """Retorna contagem de registros ativos por tabela principal."""
    tables = [
        "Politicians",
        "Elections",
        "ElectionResults",
        "AssetDeclarations",
        "AssetItems",
        "Sources",
    ]
    cur = conn.cursor()
    counts: dict[str, int] = {}
    for t in tables:
        cur.execute(f'SELECT COUNT(*) FROM "{t}" WHERE "DeletedAt" IS NULL')
        counts[t] = cur.fetchone()[0]
    cur.close()
    return counts


def get_db_size(conn: psycopg2.extensions.connection) -> str:
    cur = conn.cursor()
    cur.execute("SELECT pg_size_pretty(pg_database_size(current_database()))")
    size = cur.fetchone()[0]
    cur.close()
    return size


def get_ce_politician_tse_ids(conn: psycopg2.extensions.connection) -> set[str]:
    """Retorna TseIds dos políticos CE já carregados no banco."""
    cur = conn.cursor()
    cur.execute(
        'SELECT "TseId" FROM "Politicians"'
        ' WHERE "State" = %s AND "TseId" IS NOT NULL AND "DeletedAt" IS NULL',
        (STATE,),
    )
    ids = {row[0] for row in cur.fetchall()}
    cur.close()
    return ids


def print_counts(label: str, counts: dict[str, int], db_size: str = "") -> None:
    logger.info(f"=== {label} ===")
    for table, count in counts.items():
        logger.info(f"  {table}: {count:,}")
    if db_size:
        logger.info(f"  DB size: {db_size}")


def run_pipeline(name: str, pipeline_fn) -> tuple[bool, float]:
    """Executa pipeline, retorna (sucesso, segundos_decorridos)."""
    logger.info(f">>> Iniciando: {name}")
    t0 = time.time()
    try:
        pipeline_fn()
        elapsed = time.time() - t0
        logger.info(f"<<< Concluído: {name} em {elapsed:.1f}s")
        return True, elapsed
    except Exception as e:
        elapsed = time.time() - t0
        logger.error(f"!!! FALHOU: {name} em {elapsed:.1f}s — {e}")
        return False, elapsed


def main() -> None:
    logger.info(f"=== SEED CONTROLADO — Estado: {STATE} ===")
    logger.info(f"Timestamp início: {datetime.now(UTC).isoformat()}")

    conn_str = get_connection_string()

    # Snapshot pré-seed
    with psycopg2.connect(conn_str) as conn:
        pre_counts = get_table_counts(conn)
        pre_size = get_db_size(conn)
    print_counts("PRÉ-SEED", pre_counts, pre_size)

    timing: dict[str, float] = {}
    failures: list[str] = []

    # ── PIPELINE 1: Candidatos CE ────────────────────────────────────────────
    ok, elapsed = run_pipeline(
        "TseCandidatesPipeline (CE)",
        lambda: TseCandidatesPipeline(state_filter=STATE).run(),
    )
    timing["candidates"] = elapsed
    if not ok:
        failures.append("candidates")
        logger.error(
            "Candidatos falharam — abortando. "
            "Resultados e bens dependem dos Politicians carregados."
        )
        _print_summary(pre_counts, None, "", timing, failures)
        sys.exit(1)

    # Obter TseIds CE para filtrar bens
    with psycopg2.connect(conn_str) as conn:
        ce_tse_ids = get_ce_politician_tse_ids(conn)
    logger.info(f"Politicians CE carregados com TseId: {len(ce_tse_ids):,}")

    if not ce_tse_ids:
        logger.error(
            "Nenhum Politician CE com TseId encontrado após carga — "
            "verificar se state_filter='CE' está aplicado corretamente."
        )
        sys.exit(1)

    # ── PIPELINE 2: Resultados Eleitorais CE ─────────────────────────────────
    ok, elapsed = run_pipeline(
        "TseResultsPipeline (CE)",
        lambda: TseResultsPipeline(state_filter=STATE).run(),
    )
    timing["results"] = elapsed
    if not ok:
        failures.append("results")
        logger.warning("Resultados falharam — continuando para bens declarados.")

    # ── PIPELINE 3: Bens Declarados (filtrado por TseIds CE) ─────────────────
    ok, elapsed = run_pipeline(
        "TseAssetsPipeline (CE via tse_ids_filter)",
        lambda: TseAssetsPipeline(tse_ids_filter=ce_tse_ids).run(),
    )
    timing["assets"] = elapsed
    if not ok:
        failures.append("assets")
        logger.warning("Bens declarados falharam.")

    # Snapshot pós-seed
    with psycopg2.connect(conn_str) as conn:
        post_counts = get_table_counts(conn)
        post_size = get_db_size(conn)
    print_counts("PÓS-SEED", post_counts, post_size)

    _print_summary(pre_counts, post_counts, post_size, timing, failures)

    if failures:
        logger.error(f"Seed concluído com falhas: {failures}")
        sys.exit(1)
    else:
        logger.info("Seed concluído com SUCESSO COMPLETO.")


def _print_summary(
    pre: dict[str, int],
    post: dict[str, int] | None,
    post_size: str,
    timing: dict[str, float],
    failures: list[str],
) -> None:
    logger.info("=== RESUMO ===")
    if post:
        for table in pre:
            delta = post[table] - pre[table]
            sign = "+" if delta >= 0 else ""
            logger.info(f"  {table}: {pre[table]:,} → {post[table]:,} ({sign}{delta:,})")
        logger.info(f"  DB size pós: {post_size}")
    logger.info("  Tempos:")
    total = 0.0
    for step, secs in timing.items():
        logger.info(f"    {step}: {secs:.1f}s")
        total += secs
    logger.info(f"    TOTAL: {total:.1f}s ({total/60:.1f} min)")
    if failures:
        logger.error(f"  FALHAS: {failures}")
    else:
        logger.info("  STATUS: SUCESSO COMPLETO")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4.3: Verificar sintaxe**

```powershell
cd C:\Users\Elias\Documents\RepBrasil\etl
.\.venv\Scripts\python.exe -c "import scripts.seed_ce; print('Sintaxe OK')"
```

Saída esperada: `Sintaxe OK`

- [ ] **Step 4.4: Commitar**

```bash
git add etl/scripts/__init__.py etl/scripts/seed_ce.py
git commit -m "feat(etl): orquestrador seed_ce.py com métricas pre/post, timing e abort em falha de candidatos"
```

---

## Task 5: Executar seed do Ceará no Railway staging

**Files:** nenhum arquivo novo — execução real.

> ⚠️ Se candidatos falharem → parar, documentar, não re-tentar automaticamente.
> Se resultados ou bens falharem → continuar, documentar a falha no relatório.
> Nunca improvisar arquitetura nova durante execução.

- [ ] **Step 5.1: Confirmar DATABASE_URL está na sessão**

```powershell
# Verificar se a variável foi exportada (não exibe o valor completo — apenas confirma presença)
if ($env:DATABASE_URL) { "DATABASE_URL definida: OK" } else { "ERRO: DATABASE_URL não definida" }
```

Se não estiver definida: voltar ao Step 0.1.

- [ ] **Step 5.2: Executar o seed com output capturado**

```powershell
cd C:\Users\Elias\Documents\RepBrasil\etl
.\.venv\Scripts\python.exe scripts/seed_ce.py 2>&1 | Tee-Object -FilePath seed_ce_run.txt
```

`Tee-Object` salva output completo em `seed_ce_run.txt` (não versionado) enquanto exibe no terminal.

**Sinais de progresso esperados:**
```
HH:MM:SS | INFO     | === SEED CONTROLADO — Estado: CE ===
HH:MM:SS | INFO     | === PRÉ-SEED ===
HH:MM:SS | INFO     |   Politicians: 1000
...
HH:MM:SS | INFO     | >>> Iniciando: TseCandidatesPipeline (CE)
HH:MM:SS | INFO     | [TseCandidatesPipeline] Iniciando pipeline
HH:MM:SS | INFO     | CSV já extraído: ...
HH:MM:SS | INFO     | Registros brutos: 46XXXX
HH:MM:SS | INFO     | Filtro UF=CE: 46XXXX → ~15000 registros
HH:MM:SS | INFO     | Registros após transformação: ~15000
HH:MM:SS | INFO     | Fonte 'candidates' registrada/atualizada em Sources.
HH:MM:SS | INFO     | Submetidos ao banco: ~15000 registros
HH:MM:SS | INFO     | <<< Concluído: TseCandidatesPipeline (CE) em XX.Xs
...
```

**Se o script retornar exit code 1:**
- Não re-executar
- Ler o erro no terminal/log
- Reportar exatamente qual pipeline falhou e a mensagem de erro

- [ ] **Step 5.3: Verificar contagens finais e integridade referencial**

```powershell
.\.venv\Scripts\python.exe -c "
import os, psycopg2
conn = psycopg2.connect(os.environ['DATABASE_URL'])
cur = conn.cursor()

print('=== CONTAGENS FINAIS ===')
queries_count = [
    ('Politicians total',  'SELECT COUNT(*) FROM \"Politicians\" WHERE \"DeletedAt\" IS NULL'),
    ('Politicians CE',     'SELECT COUNT(*) FROM \"Politicians\" WHERE \"State\"=\'CE\' AND \"DeletedAt\" IS NULL'),
    ('ElectionResults',    'SELECT COUNT(*) FROM \"ElectionResults\" WHERE \"DeletedAt\" IS NULL'),
    ('Elections',          'SELECT COUNT(*) FROM \"Elections\" WHERE \"DeletedAt\" IS NULL'),
    ('AssetDeclarations',  'SELECT COUNT(*) FROM \"AssetDeclarations\" WHERE \"DeletedAt\" IS NULL'),
    ('AssetItems',         'SELECT COUNT(*) FROM \"AssetItems\" WHERE \"DeletedAt\" IS NULL'),
    ('Sources',            'SELECT COUNT(*) FROM \"Sources\" WHERE \"DeletedAt\" IS NULL'),
    ('Eleitos CE',         'SELECT COUNT(*) FROM \"ElectionResults\" er JOIN \"Politicians\" p ON p.\"Id\"=er.\"PoliticianId\" WHERE p.\"State\"=\'CE\' AND er.\"Elected\"=true AND er.\"DeletedAt\" IS NULL'),
    ('DB size',            'SELECT pg_size_pretty(pg_database_size(current_database()))'),
]
for name, q in queries_count:
    cur.execute(q)
    print(f'  {name}: {cur.fetchone()[0]}')

print()
print('=== INTEGRIDADE REFERENCIAL ===')

cur.execute('''
    SELECT COUNT(*) FROM \"ElectionResults\" er
    WHERE NOT EXISTS (SELECT 1 FROM \"Politicians\" p WHERE p.\"Id\"=er.\"PoliticianId\")
''')
print(f'  Orphan ElectionResults: {cur.fetchone()[0]} (esperado: 0)')

cur.execute('''
    SELECT COUNT(*) FROM \"AssetDeclarations\" ad
    WHERE NOT EXISTS (SELECT 1 FROM \"Politicians\" p WHERE p.\"Id\"=ad.\"PoliticianId\")
''')
print(f'  Orphan AssetDeclarations: {cur.fetchone()[0]} (esperado: 0)')

cur.execute('''
    SELECT COUNT(*) FROM \"AssetItems\" ai
    WHERE NOT EXISTS (SELECT 1 FROM \"AssetDeclarations\" ad WHERE ad.\"Id\"=ai.\"DeclarationId\")
''')
print(f'  Orphan AssetItems: {cur.fetchone()[0]} (esperado: 0)')

conn.close()
"
```

**Se qualquer órfão > 0: parar, documentar, não tentar corrigir automaticamente.**

---

## Task 6: Gerar docs/metrics/staging-seed-report.md

**Files:**
- Create: `docs/metrics/staging-seed-report.md`

- [ ] **Step 6.1: Criar o relatório com valores reais dos Steps 5.2–5.3**

Preencher todos os `[VALOR]` com os números reais observados:

```markdown
# Staging Seed Report — Ceará (TSE 2024)

**Data:** 2026-05-17
**Ambiente:** Railway Postgres — staging (production environment)
**Estratégia:** Filtro por UF=CE nos pipelines existentes — sem novos conectores
**Datasets carregados:** TSE 2024 candidatos, resultados eleitorais, bens declarados

---

## Contagem de Registros por Tabela

| Tabela | Pré-seed | Pós-seed | Delta |
|---|---|---|---|
| Politicians | [PRÉ] | [PÓS] | +[DELTA] |
| ElectionResults | [PRÉ] | [PÓS] | +[DELTA] |
| Elections | [PRÉ] | [PÓS] | +[DELTA] |
| AssetDeclarations | [PRÉ] | [PÓS] | +[DELTA] |
| AssetItems | [PRÉ] | [PÓS] | +[DELTA] |
| Sources | [PRÉ] | [PÓS] | +[DELTA] |

**Politicians CE total:** [VALOR]
**Eleitos CE:** [VALOR]
**Tamanho do banco (pós):** [VALOR]

---

## Datasets Carregados

| Dataset | Fonte | Status | Tempo |
|---|---|---|---|
| TSE Candidatos 2024 (CE) | consulta_cand_2024_BRASIL.csv — UF=CE | ✅/❌ | [Xs] |
| TSE Resultados Eleitorais 2024 (CE) | votacao_candidato_munzona_2024_BRASIL.csv — UF=CE | ✅/❌ | [Xs] |
| TSE Bens Declarados 2024 (CE) | bem_candidato_2024_BRASIL.csv — TseIds CE | ✅/❌ | [Xs] |
| **TOTAL** | | | [Xs] ([min] min) |

---

## Datasets Pendentes (não carregados neste ciclo)

| Dataset | Motivo |
|---|---|
| TSE Filiações Partidárias | Pipeline não implementado — Roadmap G1-4 |
| TSE Doações de Campanha | Pipeline não implementado — Roadmap G2-2 |
| Câmara — Deputados federais | Pipeline não implementado — Roadmap G1-1 |
| Senado — Senadores | Pipeline não implementado — Roadmap G1-2 |
| Demais UFs do Brasil (25 UFs + DF) | Seed incremental futuro — mesmo padrão |
| Eleições anteriores (2018, 2020, 2022) | Seed histórico futuro |

---

## Match Rate — Resultados → Politicians

- Resultados CE processados: [VALOR]
- Politicians matchados (com TseId): [VALOR]
- Skipped (TseId não encontrado): [VALOR]
- Match rate: [VALOR]%

**Interpretação:** [Descrever se match rate foi alto/médio/baixo e por quê — ex: "match rate X% é esperado pois apenas candidatos com status DEFERIDO/APTO foram importados, e resultados incluem candidatos indeferidos que foram excluídos"]

---

## Integridade Referencial

| Verificação | Resultado | Status |
|---|---|---|
| Orphan ElectionResults | [VALOR] | ✅ OK / ❌ PROBLEMA |
| Orphan AssetDeclarations | [VALOR] | ✅ OK / ❌ PROBLEMA |
| Orphan AssetItems | [VALOR] | ✅ OK / ❌ PROBLEMA |

---

## Problemas Encontrados

[Descrever erros, warnings relevantes ou comportamento inesperado dos logs]

Se nenhum: `Nenhum problema encontrado. Seed concluído com sucesso.`

---

## Limitações Atuais

1. **Cobertura geográfica:** Apenas CE carregado — 25 UFs + DF pendentes.
2. **Cobertura temporal:** Apenas eleição 2024 — eleições 2018, 2020, 2022 não importadas.
3. **Entidade Person:** Não implementada — sem vínculos societários ou doadores mapeados.
4. **Filiações partidárias:** Pipeline não implementado — Party existe mas sem histórico de filiações.
5. **Neo4j:** Não populado — grafo de relacionamentos aguarda Fase de Expansão Grupo 3.
6. **Camada de evidência:** Migrations do Bloco 0 (ConfidenceLevel, EvidenceType, TransformationLog) não aplicadas — evidências atuais têm rastreabilidade básica.

---

## Recomendações para Próxima Expansão

1. **Próximo seed:** UFs nordestinas (MA, PI, RN, PB, PE, AL, SE, BA) — mesmo pattern, mínima complexidade adicional.
2. **Ampliar eleições:** Importar ciclos TSE 2018 e 2022 com mesmo filtro por UF.
3. **Câmara API (G1-1):** `CamaraId` já existe em `Politician` — conector pronto para vincular.
4. **Bloco 0 obrigatório:** Aplicar migrations de `ConfidenceLevel`, `EvidenceType`, `TransformationLog` antes do próximo ciclo de conectores.
5. **Filiações TSE (G1-4):** Alta confiabilidade histórica, schema estável — próximo pipeline a implementar.
```

- [ ] **Step 6.2: Commitar o relatório**

```bash
git add docs/metrics/staging-seed-report.md
git commit -m "docs(metrics): staging-seed-report.md — seed CE TSE 2024 com contagens reais"
```

---

## Critérios de Conclusão

**Seed COMPLETO:**
- [ ] `Politicians CE` > 10.000 no banco
- [ ] `ElectionResults` aumentou em relação ao pré-seed
- [ ] `AssetDeclarations` aumentou em relação ao pré-seed
- [ ] Todos os órfãos = 0 (integridade referencial OK)
- [ ] `staging-seed-report.md` preenchido com valores reais e commitado

**Seed PARCIAL (aceitável):**
- Candidatos carregados, resultados ou bens falharam → documentar exatamente o pipeline e erro

**Seed ABORTADO:**
- Pipeline de candidatos falhou → sem Politicians CE, nada mais faz sentido
