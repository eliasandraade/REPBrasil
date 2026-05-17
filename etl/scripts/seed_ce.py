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
