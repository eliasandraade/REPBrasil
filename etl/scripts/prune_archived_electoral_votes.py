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
from src.electoral.derived import refresh_derived
from src.electoral.lake import LakeScope, database_totals, lake_root_from_env, load_manifest, parquet_totals


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Delete one archived BU scope only after Parquet and persistent derived snapshots are verified."
    )
    p.add_argument("--year", type=int, required=True)
    p.add_argument("--turn", type=int, required=True)
    p.add_argument("--uf", required=True)
    p.add_argument("--root", type=Path, default=None)
    p.add_argument("--confirm", required=True, help="must equal YEAR/TURN/UF, e.g. 2022/1/CE")
    return p


def _derived_snapshot(cur, scope: LakeScope) -> dict[str, dict[str, int]]:
    cur.execute(
        """
        SELECT votable_rows, votable_votes, zone_rows, zone_votes
          FROM derived_archive_scope
         WHERE year=%s AND turn=%s AND uf=%s
        """,
        (scope.year, scope.turn, scope.uf),
    )
    marker = cur.fetchone()
    if marker is None:
        raise SystemExit("refusing prune: no persistent derived snapshot for scope")

    cur.execute(
        """SELECT count(*)::bigint, COALESCE(sum(votes),0)::bigint
             FROM votable_zone_votes_archive WHERE year=%s AND turn=%s AND uf=%s""",
        (scope.year, scope.turn, scope.uf),
    )
    votable_rows, votable_votes = cur.fetchone()
    cur.execute(
        """SELECT count(*)::bigint, COALESCE(sum(votes_total),0)::bigint
             FROM zone_office_totals_archive WHERE year=%s AND turn=%s AND uf=%s""",
        (scope.year, scope.turn, scope.uf),
    )
    zone_rows, zone_votes = cur.fetchone()

    expected = {
        "votable": {"rows": int(marker[0]), "votes": int(marker[1])},
        "zone": {"rows": int(marker[2]), "votes": int(marker[3])},
    }
    actual = {
        "votable": {"rows": int(votable_rows), "votes": int(votable_votes)},
        "zone": {"rows": int(zone_rows), "votes": int(zone_votes)},
    }
    if actual != expected:
        raise SystemExit(f"refusing prune: derived snapshot marker/data differ: marker={expected} actual={actual}")
    if actual["votable"]["rows"] == 0 or actual["zone"]["rows"] == 0:
        raise SystemExit("refusing prune: derived snapshot is empty")
    if actual["votable"]["votes"] != actual["zone"]["votes"]:
        raise SystemExit(f"refusing prune: derived snapshot vote totals differ: {actual}")
    return actual


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
            cur.execute("SELECT to_regclass('derived_archive_scope')")
            if cur.fetchone()[0] is None:
                raise SystemExit("refusing prune: hybrid serving schema missing")
            derived_snapshot = _derived_snapshot(cur, scope)
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

        conn.commit()
        conn.autocommit = True
        derived: dict[str, object] = refresh_derived(conn)

    print(
        json.dumps(
            {
                "status": "pruned",
                "scope": {"year": scope.year, "turn": scope.turn, "uf": scope.uf},
                "archived": parquet,
                "derivedSnapshot": derived_snapshot,
                "deletedRuns": deleted_runs,
                "derived": derived,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
