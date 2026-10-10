from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.electoral import db as electoral_db
from src.electoral.lake import LakeScope, archive_scope, lake_root_from_env, load_manifest, parquet_totals


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Archive current detailed BU vote facts into verified Parquet files.")
    p.add_argument("--year", type=int, required=True)
    p.add_argument("--turn", type=int, required=True)
    p.add_argument("--uf", required=True)
    p.add_argument("--root", type=Path, default=None)
    p.add_argument("--chunk-rows", type=int, default=100_000)
    p.add_argument("--replace", action="store_true")
    p.add_argument("--verify-only", action="store_true")
    return p


def main() -> int:
    args = parser().parse_args()
    root = (args.root or lake_root_from_env()).resolve()
    scope = LakeScope(args.year, args.turn, args.uf)

    if args.verify_only:
        manifest = load_manifest(root, scope)
        totals = parquet_totals(root, scope)
        expected = manifest["totals"]
        if totals != expected:
            raise SystemExit(f"manifest/parquet totals differ: manifest={expected} parquet={totals}")
        print(json.dumps({"status": "verified", "scope": manifest["scope"], "totals": totals}, ensure_ascii=False))
        return 0

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")

    root.mkdir(parents=True, exist_ok=True)
    with electoral_db.connect(database_url) as conn:
        manifest = archive_scope(
            conn,
            root,
            scope,
            chunk_rows=args.chunk_rows,
            replace=args.replace,
        )
    print(json.dumps({"status": "archived", **manifest}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
