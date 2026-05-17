"""
seed_assets_ce.py — Re-seed cirúrgico de bens declarados CE após fix do TseAssetsPipeline.

Uso:
    cd etl
    $env:DATABASE_URL = "<RAILWAY_DATABASE_PUBLIC_URL>"
    $env:PYTHONPATH = "C:\\Users\\Elias\\Documents\\RepBrasil\\etl"
    .venv/Scripts/python.exe scripts/seed_assets_ce.py

Pré-requisito: seed_ce.py já executado — Politicians CE carregados com TseId.
Idempotente: ON CONFLICT DO UPDATE em todos os upserts.
"""

import sys
import time
from datetime import UTC, datetime

import psycopg2
from loguru import logger

from src.db.connection import get_connection_string
from src.sources.tse.assets import TseAssetsPipeline

STATE = "CE"
BATCH_SIZE = 250

logger.remove()
logger.add(
    sys.stderr,
    format="<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | {message}",
    level="INFO",
)
_log_file = f"seed_assets_ce_{datetime.now(UTC).strftime('%Y%m%d_%H%M%S')}.log"
logger.add(_log_file, level="DEBUG", rotation=None)
logger.info(f"Log detalhado em: {_log_file}")


def _get_ce_tse_ids(conn: psycopg2.extensions.connection) -> set[str]:
    cur = conn.cursor()
    cur.execute(
        'SELECT "TseId" FROM "Politicians"'
        ' WHERE "State" = %s AND "TseId" IS NOT NULL AND "DeletedAt" IS NULL',
        (STATE,),
    )
    ids = {row[0] for row in cur.fetchall()}
    cur.close()
    return ids


def _get_asset_counts(conn: psycopg2.extensions.connection) -> dict[str, int]:
    cur = conn.cursor()
    result = {}
    for t in ("AssetDeclarations", "AssetItems"):
        cur.execute(f'SELECT COUNT(*) FROM "{t}" WHERE "DeletedAt" IS NULL')
        result[t] = cur.fetchone()[0]
    cur.close()
    return result


def main() -> None:
    logger.info(f"=== RE-SEED ASSETS {STATE} — batch_size={BATCH_SIZE} ===")
    logger.info(f"Timestamp: {datetime.now(UTC).isoformat()}")
    conn_str = get_connection_string()

    with psycopg2.connect(conn_str) as conn:
        ce_tse_ids = _get_ce_tse_ids(conn)
        pre_counts = _get_asset_counts(conn)

    logger.info(f"Politicians {STATE} com TseId: {len(ce_tse_ids):,}")
    logger.info(f"Pré-seed: {pre_counts}")

    if not ce_tse_ids:
        logger.error(f"Nenhum Politician {STATE} com TseId — rodar seed_ce.py primeiro.")
        sys.exit(1)

    t0 = time.time()
    try:
        TseAssetsPipeline(tse_ids_filter=ce_tse_ids, batch_size=BATCH_SIZE).run()
        elapsed = time.time() - t0
        logger.info(f"Pipeline concluído em {elapsed:.1f}s ({elapsed / 60:.1f} min)")
    except Exception as e:
        elapsed = time.time() - t0
        logger.exception(f"Pipeline falhou em {elapsed:.1f}s")
        sys.exit(1)

    with psycopg2.connect(conn_str) as conn:
        post_counts = _get_asset_counts(conn)

    logger.info("=== RESULTADO ===")
    for t, pre in pre_counts.items():
        delta = post_counts[t] - pre
        sign = "+" if delta >= 0 else ""
        logger.info(f"  {t}: {pre:,} → {post_counts[t]:,} ({sign}{delta:,})")
    logger.info("Re-seed assets CE concluído com SUCESSO.")


if __name__ == "__main__":
    main()
