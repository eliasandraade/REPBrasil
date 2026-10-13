#!/usr/bin/env python3
"""Ingestão auditável do Parlamento de uma UF (deputados, proposições e emendas oficiais).

Operação explícita, separada do deploy. Exemplo (Ceará, 57ª legislatura):

    DATABASE_URL=... python scripts/ingest_parliament.py --uf CE --legislature 57

Escreve só no schema `electoral` (parliament_source/member/activity/amendment) e imprime um
resumo JSON. Rodar de novo com os mesmos bytes oficiais é idempotente.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.electoral import db as electoral_db  # noqa: E402
from src.electoral.paths import unit_code  # noqa: E402
from src.pipeline.parliament_ingest import LEGISLATURE_START, ingest_parliament  # noqa: E402
from src.sources.camara.api import CamaraApi  # noqa: E402


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Ingest official parliament data (Câmara + Portal da Transparência) for one UF."
    )
    result.add_argument(
        "--uf", required=True, help="state whose federal deputies and amendments are loaded"
    )
    result.add_argument("--legislature", type=int, default=57)
    result.add_argument(
        "--since", default=None, help="first presentation date (default: legislature start)"
    )
    result.add_argument("--database-url", default=None, help="defaults to $DATABASE_URL")
    result.add_argument("--skip-activities", action="store_true")
    result.add_argument("--skip-amendments", action="store_true")
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    uf = unit_code(args.uf)
    if uf in ("BR", "ZZ"):
        raise SystemExit("--uf must be a state")
    legislature = int(args.legislature)
    if args.since:
        presented_from = date.fromisoformat(args.since)
    elif legislature in LEGISLATURE_START:
        presented_from = LEGISLATURE_START[legislature]
    else:
        raise SystemExit(f"--since is required for legislature {legislature}")
    database_url = args.database_url or os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL (or --database-url) is required")

    with (
        CamaraApi() as camara,
        httpx.Client(timeout=180) as http,
        electoral_db.connect(database_url) as conn,
    ):
        summary = ingest_parliament(
            conn,
            uf=uf,
            legislature=legislature,
            presented_from=presented_from,
            presented_to=date.today(),
            camara=camara,
            http=http,
            include_activities=not args.skip_activities,
            include_amendments=not args.skip_amendments,
        )
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
