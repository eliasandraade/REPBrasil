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
from src.electoral.lake_results import database_result_totals, load_result_manifest, parquet_result_totals


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=(
            "Delete only archived BU vote facts after vote Parquet, result metadata and derived snapshots are verified. "
            "Ingestion runs and section-office result metadata are preserved for exact provenance and urn drill-down."
        )
    )
    p.add_argument("--year", type=int, required=True)
    p.add_argument("--turn", type=int, required=True)
    p.add_argument("--uf", required=True)
    p.add_argument("--root", type=Path, default=None)
    p.add_argument("--confirm", required=True, help="must equal YEAR/TURN/UF, e.g. 2022/1/CE")
    p.add_argument("--dry-run", action="store_true", help="verify every prune gate and report the exact delete count without deleting")
    return p


def _derived_snapshot(cur, scope: LakeScope) -> dict[str, dict[str, int]]:
    cur.execute(
        """
        SELECT votable_rows, votable_votes, zone_rows, zone_votes
          FROM electoral_archive.derived_archive_scope
         WHERE year=%s AND turn=%s AND uf=%s
        """,
        (scope.year, scope.turn, scope.uf),
    )
    marker = cur.fetchone()
    if marker is None:
        raise SystemExit("refusing prune: no persistent derived snapshot for scope")

    cur.execute(
        """SELECT count(*)::bigint, COALESCE(sum(votes),0)::bigint
             FROM electoral_archive.votable_zone_votes
            WHERE year=%s AND turn=%s AND uf=%s""",
        (scope.year, scope.turn, scope.uf),
    )
    votable_rows, votable_votes = cur.fetchone()
    cur.execute(
        """SELECT count(*)::bigint, COALESCE(sum(votes_total),0)::bigint
             FROM electoral_archive.zone_office_totals
            WHERE year=%s AND turn=%s AND uf=%s""",
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


def _current_result_ids(cur, scope: LakeScope) -> list[int]:
    cur.execute(
        """
        SELECT r.id::bigint
          FROM latest_bu_ingestion_run l
          JOIN section_office_result r ON r.ingestion_run_id = l.ingestion_run_id
         WHERE r.year = %s AND r.turn = %s AND r.uf = %s
         ORDER BY r.id
         FOR UPDATE OF r
        """,
        (scope.year, scope.turn, scope.uf),
    )
    return [int(row[0]) for row in cur.fetchall()]


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

    vote_manifest = load_manifest(root, scope)
    vote_parquet = parquet_totals(root, scope)
    if vote_parquet != vote_manifest["totals"]:
        raise SystemExit(
            f"vote manifest/parquet totals differ: manifest={vote_manifest['totals']} parquet={vote_parquet}"
        )

    result_manifest = load_result_manifest(root, scope)
    result_parquet = parquet_result_totals(root, scope)
    if result_parquet != result_manifest["totals"]:
        raise SystemExit(
            f"result manifest/parquet totals differ: manifest={result_manifest['totals']} parquet={result_parquet}"
        )
    if result_parquet["municipalities"] != vote_parquet["municipalities"] or result_parquet["votes"] != vote_parquet["votes"]:
        raise SystemExit(
            f"vote/result archives disagree: votes={vote_parquet} results={result_parquet}"
        )

    with electoral_db.connect(database_url, autocommit=True) as conn:
        database_votes = database_totals(conn, scope)
        if database_votes != vote_parquet:
            raise SystemExit(f"database/vote parquet totals differ: database={database_votes} parquet={vote_parquet}")
        database_results = database_result_totals(conn, scope)
        if database_results != result_parquet:
            raise SystemExit(
                f"database/result parquet totals differ: database={database_results} parquet={result_parquet}"
            )

        with conn.transaction(), conn.cursor() as cur:
            cur.execute("SELECT to_regclass('electoral_archive.derived_archive_scope')")
            if cur.fetchone()[0] is None:
                raise SystemExit("refusing prune: hybrid serving schema missing")
            derived_snapshot = _derived_snapshot(cur, scope)

            result_ids = _current_result_ids(cur, scope)
            if not result_ids:
                raise SystemExit("refusing prune: no current BU section-office results found for scope")
            if len(result_ids) != result_parquet["rows"]:
                raise SystemExit(
                    f"refusing prune: current result rows differ from archived metadata: "
                    f"database={len(result_ids)} archive={result_parquet['rows']}"
                )

            cur.execute(
                "SELECT count(*)::bigint FROM section_office_vote WHERE result_id = ANY(%s::bigint[])",
                (result_ids,),
            )
            current_vote_rows = int(cur.fetchone()[0])
            if current_vote_rows != vote_parquet["rows"]:
                raise SystemExit(
                    f"refusing prune: current vote rows differ from archived vote rows: "
                    f"database={current_vote_rows} archive={vote_parquet['rows']}"
                )

            if args.dry_run:
                print(
                    json.dumps(
                        {
                            "status": "dry_run",
                            "scope": {"year": scope.year, "turn": scope.turn, "uf": scope.uf},
                            "votesArchive": vote_parquet,
                            "resultsArchive": result_parquet,
                            "derivedSnapshot": derived_snapshot,
                            "wouldDeleteVotes": current_vote_rows,
                            "preservedResults": len(result_ids),
                            "deletedRuns": 0,
                        },
                        ensure_ascii=False,
                    )
                )
                return 0

            cur.execute(
                "DELETE FROM section_office_vote WHERE result_id = ANY(%s::bigint[])",
                (result_ids,),
            )
            deleted_votes = cur.rowcount
            if deleted_votes != vote_parquet["rows"]:
                raise SystemExit(
                    f"refusing prune: deleted vote rows differ from archived vote rows: "
                    f"deleted={deleted_votes} archive={vote_parquet['rows']}"
                )

            cur.execute(
                "SELECT count(*)::bigint FROM section_office_result WHERE id = ANY(%s::bigint[])",
                (result_ids,),
            )
            preserved_results = int(cur.fetchone()[0])
            if preserved_results != len(result_ids):
                raise SystemExit(
                    f"refusing prune: section-office metadata was not preserved: "
                    f"expected={len(result_ids)} actual={preserved_results}"
                )

        derived: dict[str, object] = refresh_derived(conn)

    print(
        json.dumps(
            {
                "status": "pruned",
                "scope": {"year": scope.year, "turn": scope.turn, "uf": scope.uf},
                "votesArchive": vote_parquet,
                "resultsArchive": result_parquet,
                "derivedSnapshot": derived_snapshot,
                "deletedVotes": deleted_votes,
                "preservedResults": preserved_results,
                "deletedRuns": 0,
                "derived": derived,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
