from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from src.electoral import db as electoral_db
from src.electoral.derived import refresh_derived
from src.electoral.lake import LakeScope, database_totals, lake_root_from_env, load_manifest, parquet_totals


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Delete one archived BU scope only after Postgres and Parquet totals match."
    )
    p.add_argument("--year", type=int, required=True)
    p.add_argument("--turn", type=int, required=True)
    p.add_argument("--uf", required=True)
    p.add_argument("--root", type=Path, default=None)
    p.add_argument("--confirm", required=True, help="must equal YEAR/TURN/UF, e.g. 2026/1/PI")
    return p


def main() -> int:
    args = parser().parse_args()
    scope = LakeScope(args.year, args.turn, args.uf).normalized()
    confirmation = f"{scope.year}/{scope.turn}/{scope.uf}"
    if args.confirm != confirmation:
        raise SystemExit(f"refusing prune: --confirm must be exactly {confirmation}")

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    root = (args.root or lake_root_from_env()).resolve()
    manifest = load_manifest(root, scope)
    parquet = parquet_totals(root, scope)
    if parquet != manifest["totals"]:
        raise SystemExit(f"manifest/parquet totals differ: manifest={manifest['totals']} parquet={parquet}")

    with electoral_db.connect(database_url) as conn:
        database = database_totals(conn, scope)
        if database != parquet:
            raise SystemExit(f"database/parquet totals differ: database={database} parquet={parquet}")
        with conn.transaction(), conn.cursor() as cur:
            cur.execute(
                """
                SELECT r.id
                  FROM ingestion_run r
                  JOIN open_data_source_file f ON f.id = r.source_file_id
                 WHERE r.source = 'tse-open-data-bu' AND r.status = 'succeeded'
                   AND f.year = %s AND f.turn = %s AND f.uf = %s
                 FOR UPDATE OF r
                """,
                (scope.year, scope.turn, scope.uf),
            )
            run_ids = [row[0] for row in cur.fetchall()]
            if not run_ids:
                raise SystemExit("no succeeded BU ingestion runs found for scope")
            cur.execute("DELETE FROM ingestion_run WHERE id = ANY(%s::uuid[])", (run_ids,))
            deleted_runs = cur.rowcount
        has_derived = bool(conn.execute("SELECT to_regclass('derived_refresh') IS NOT NULL").fetchone()[0])
        if has_derived:
            conn.commit()
            conn.autocommit = True
            derived: dict[str, object] = refresh_derived(conn)
        else:
            derived = {"status": "not_available_before_migration_008"}

    print(
        json.dumps(
            {
                "status": "pruned",
                "scope": {"year": scope.year, "turn": scope.turn, "uf": scope.uf},
                "archived": parquet,
                "deletedRuns": deleted_runs,
                "derived": derived,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
