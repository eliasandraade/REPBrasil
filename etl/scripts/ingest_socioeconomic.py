#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.pipeline.socioelectoral_ingestion import ingest_censo_2022_core


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Ingest audited municipal socioeconomic indicators into REPBrasil."
    )
    result.add_argument(
        "--preset",
        choices=["censo2022-core"],
        default="censo2022-core",
    )
    result.add_argument("--uf", default="CE")
    return result


def main() -> int:
    args = parser().parse_args()
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is required", file=sys.stderr)
        return 2

    if args.preset != "censo2022-core":
        print(f"unsupported preset: {args.preset}", file=sys.stderr)
        return 2

    with psycopg.connect(database_url) as conn:
        result = ingest_censo_2022_core(conn, uf=args.uf)

    print(
        json.dumps(
            {
                "preset": args.preset,
                "uf": result.uf,
                "period": result.period,
                "municipalities": result.municipalities,
                "source_urls": list(result.source_urls),
                "stats": result.stats,
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
