"""
seed_nordeste.py — Expansão regional Nordeste: BA, PE, MA, PB, PI, RN, AL, SE.

Uso:
    cd etl
    $env:DATABASE_URL = "<RAILWAY_DATABASE_PUBLIC_URL>"
    $env:PYTHONPATH = "C:\\Users\\Elias\\Documents\\RepBrasil\\etl"
    .venv/Scripts/python.exe scripts/seed_nordeste.py

Comportamento por UF:
    - Candidatos falharam → pular UF (resultados e bens dependem dos Politicians)
    - Resultados falharam → logar warning, continuar para bens
    - Bens falharam → logar warning, continuar para próxima UF
    - Todos os upserts são idempotentes (ON CONFLICT DO UPDATE)

Tempo estimado: 15–20h (rodar como processo background).
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

# Nordeste sem CE (já seeded)
NORDESTE_UFS = ["BA", "PE", "MA", "PB", "PI", "RN", "AL", "SE"]
BATCH_SIZE = 250

logger.remove()
logger.add(
    sys.stderr,
    format="<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | {message}",
    level="INFO",
)
_log_file = f"seed_nordeste_{datetime.now(UTC).strftime('%Y%m%d_%H%M%S')}.log"
logger.add(_log_file, level="DEBUG", rotation=None)
logger.info(f"Log detalhado em: {_log_file}")


def _get_uf_tse_ids(conn: psycopg2.extensions.connection, uf: str) -> set[str]:
    cur = conn.cursor()
    cur.execute(
        'SELECT "TseId" FROM "Politicians"'
        ' WHERE "State" = %s AND "TseId" IS NOT NULL AND "DeletedAt" IS NULL',
        (uf,),
    )
    ids = {row[0] for row in cur.fetchall()}
    cur.close()
    return ids


def _get_table_counts(conn: psycopg2.extensions.connection) -> dict[str, int]:
    cur = conn.cursor()
    counts: dict[str, int] = {}
    for t in ("Politicians", "Elections", "ElectionResults", "AssetDeclarations", "AssetItems"):
        cur.execute(f'SELECT COUNT(*) FROM "{t}" WHERE "DeletedAt" IS NULL')
        counts[t] = cur.fetchone()[0]
    cur.execute("SELECT pg_size_pretty(pg_database_size(current_database()))")
    counts["_db_size"] = cur.fetchone()[0]  # type: ignore[assignment]
    cur.close()
    return counts


def _run_pipeline(name: str, fn: object) -> tuple[bool, float]:
    logger.info(f">>> Iniciando: {name}")
    t0 = time.time()
    try:
        fn()  # type: ignore[operator]
        elapsed = time.time() - t0
        logger.info(f"<<< Concluído: {name} em {elapsed:.1f}s")
        return True, elapsed
    except Exception as e:
        elapsed = time.time() - t0
        logger.exception(f"!!! FALHOU: {name} em {elapsed:.1f}s")
        return False, elapsed


def main() -> None:
    logger.info(f"=== SEED NORDESTE — {NORDESTE_UFS} ===")
    logger.info(f"Timestamp início: {datetime.now(UTC).isoformat()}")
    conn_str = get_connection_string()

    with psycopg2.connect(conn_str) as conn:
        pre_counts = _get_table_counts(conn)
    logger.info("=== PRÉ-SEED ===")
    for k, v in pre_counts.items():
        logger.info(f"  {k}: {v:,}" if isinstance(v, int) else f"  {k}: {v}")

    uf_results: list[dict] = []
    global_failures = 0

    for uf in NORDESTE_UFS:
        logger.info(f"\n{'=' * 60}")
        logger.info(f"=== UF: {uf} ===")
        logger.info(f"{'=' * 60}")
        uf_timing: dict[str, float] = {}
        uf_failures: list[str] = []

        # ── 1. Candidatos (obrigatório para esta UF) ──────────────────────────
        ok, elapsed = _run_pipeline(
            f"TseCandidatesPipeline ({uf})",
            lambda u=uf: TseCandidatesPipeline(state_filter=u).run(),
        )
        uf_timing["candidates"] = elapsed
        if not ok:
            uf_failures.append("candidates")
            logger.error(
                f"Candidatos {uf} falharam — pulando resultados e bens. "
                f"Verificar CSV e conexão."
            )
            uf_results.append({"uf": uf, "failures": uf_failures, "timing": uf_timing})
            global_failures += 1
            continue

        # TseIds desta UF (para filtro de bens)
        with psycopg2.connect(conn_str) as conn:
            uf_tse_ids = _get_uf_tse_ids(conn, uf)
        logger.info(f"Politicians {uf} com TseId: {len(uf_tse_ids):,}")

        # ── 2. Resultados (não bloqueia bens) ────────────────────────────────
        ok, elapsed = _run_pipeline(
            f"TseResultsPipeline ({uf})",
            lambda u=uf: TseResultsPipeline(state_filter=u).run(),
        )
        uf_timing["results"] = elapsed
        if not ok:
            uf_failures.append("results")
            logger.warning(f"Resultados {uf} falharam — continuando para bens.")

        # ── 3. Bens (batch commits, não bloqueia próxima UF) ─────────────────
        ok, elapsed = _run_pipeline(
            f"TseAssetsPipeline ({uf}, batch={BATCH_SIZE})",
            lambda ids=uf_tse_ids: TseAssetsPipeline(
                tse_ids_filter=ids, batch_size=BATCH_SIZE
            ).run(),
        )
        uf_timing["assets"] = elapsed
        if not ok:
            uf_failures.append("assets")
            logger.warning(f"Bens {uf} falharam.")

        uf_results.append({"uf": uf, "failures": uf_failures, "timing": uf_timing})
        if uf_failures:
            global_failures += 1

    # ── Resumo final ─────────────────────────────────────────────────────────
    with psycopg2.connect(conn_str) as conn:
        post_counts = _get_table_counts(conn)

    logger.info("\n=== PÓS-SEED ===")
    for k, v in post_counts.items():
        if k == "_db_size":
            logger.info(f"  DB size: {v}")
        else:
            delta = post_counts[k] - pre_counts[k]
            sign = "+" if delta >= 0 else ""
            logger.info(f"  {k}: {pre_counts[k]:,} → {v:,} ({sign}{delta:,})")

    logger.info("\n=== RESUMO POR UF ===")
    total_elapsed = 0.0
    for r in uf_results:
        status = "✅ OK" if not r["failures"] else f"⚠️  falhas: {r['failures']}"
        uf_elapsed = sum(r["timing"].values())
        total_elapsed += uf_elapsed
        logger.info(
            f"  {r['uf']}: {status} — "
            f"candidatos={r['timing'].get('candidates', 0):.0f}s "
            f"resultados={r['timing'].get('results', 0):.0f}s "
            f"bens={r['timing'].get('assets', 0):.0f}s "
            f"total={uf_elapsed:.0f}s"
        )

    logger.info(f"\n  TOTAL: {total_elapsed:.0f}s ({total_elapsed / 60:.1f} min)")

    if global_failures:
        logger.error(f"Seed Nordeste concluído com {global_failures} UF(s) com falhas.")
        sys.exit(1)
    else:
        logger.info("Seed Nordeste concluído com SUCESSO COMPLETO.")


if __name__ == "__main__":
    main()
