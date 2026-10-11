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
from src.electoral.lake import LakeScope, lake_root_from_env
from src.electoral.lake_results import (
    archive_result_metadata,
    database_result_totals,
    load_result_manifest,
    parquet_result_totals,
)


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Archive section-office result metadata beside an existing electoral vote lake scope.")
    p.add_argument("--year", type=int, required=True)
    p.add_argument("--turn", type=int, required=True)
    p.add_argument("--uf", required=True)
    p.add_argument("--root", type=Path, default=None)
    p.add_argument("--replace", action="store_true")
    p.add_argument("--verify-only", action="store_true")
    return p


def main() -> int:
    args = parser().parse_args()
    scope = LakeScope(args.year, args.turn, args.uf).normalized()
    root = (args.root or lake_root_from_env()).resolve()
    if args.verify_only:
        manifest = load_result_manifest(root, scope)
        payload = {"status": "verified", "scope": manifest["scope"], "totals": parquet_result_totals(root, scope)}
        print(json.dumps(payload, ensure_ascii=False))
        return 0

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    with electoral_db.connect(database_url) as conn:
        before = database_result_totals(conn, scope)
        manifest = archive_result_metadata(conn, root, scope, replace=args.replace)
        after = database_result_totals(conn, scope)
    if before != after or after != manifest["totals"]:
        raise SystemExit(f"result metadata source changed during archive: before={before} after={after} manifest={manifest['totals']}")
    print(json.dumps({"status": "archived", **manifest}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
