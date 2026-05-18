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
        logger.info(f"  {k}: {pre[k]} -> {post[k]} ({sign}{delta})")
    logger.info("Seed Câmara G1-1 concluído.")


if __name__ == "__main__":
    main()
