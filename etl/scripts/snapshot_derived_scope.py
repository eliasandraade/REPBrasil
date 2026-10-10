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
from src.electoral.lake import LakeScope

DERIVED_VIEWS = ("votable_zone_votes_current", "zone_office_totals_current")


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Persist one fresh zone-aggregate scope before detailed BU facts are pruned."
    )
    p.add_argument("--year", type=int, required=True)
    p.add_argument("--turn", type=int, required=True)
    p.add_argument("--uf", required=True)
    return p


def _freshness(cur) -> tuple[int, object]:
    cur.execute(
        "SELECT count(*)::int, max(finished_at) FROM ingestion_run "
        "WHERE source = 'tse-open-data-bu' AND status = 'succeeded'"
    )
    current_runs, current_last = cur.fetchone()
    cur.execute(
        """
        SELECT count(*)::int,
               min(bu_runs)::int,
               max(bu_runs)::int,
               min(bu_last_finished_at),
               max(bu_last_finished_at)
          FROM derived_refresh
         WHERE view_name = ANY(%s::text[])
        """,
        (list(DERIVED_VIEWS),),
    )
    rows, min_runs, max_runs, min_last, max_last = cur.fetchone()
    if rows != len(DERIVED_VIEWS):
        raise RuntimeError("derived aggregates have no complete freshness record; run refresh-derived")
    if min_runs != current_runs or max_runs != current_runs or min_last != current_last or max_last != current_last:
        raise RuntimeError(
            "derived aggregates are stale; run refresh-derived before snapshot "
            f"(derived runs={min_runs}..{max_runs}, current={current_runs})"
        )
    return int(current_runs), current_last


def _votable_stats(cur, table: str, scope: LakeScope) -> dict[str, int]:
    cur.execute(
        f"""SELECT count(*)::bigint, COALESCE(sum(votes), 0)::bigint
              FROM {table} WHERE year=%s AND turn=%s AND uf=%s""",
        (scope.year, scope.turn, scope.uf),
    )
    rows, votes = cur.fetchone()
    return {"rows": int(rows), "votes": int(votes)}


def _zone_stats(cur, table: str, scope: LakeScope) -> dict[str, int]:
    cur.execute(
        f"""SELECT count(*)::bigint, COALESCE(sum(votes_total), 0)::bigint
              FROM {table} WHERE year=%s AND turn=%s AND uf=%s""",
        (scope.year, scope.turn, scope.uf),
    )
    rows, votes = cur.fetchone()
    return {"rows": int(rows), "votes": int(votes)}


def main() -> int:
    args = parser().parse_args()
    scope = LakeScope(args.year, args.turn, args.uf).normalized()
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")

    with electoral_db.connect(database_url, autocommit=True) as conn:
        with conn.transaction(), conn.cursor() as cur:
            cur.execute(
                "SELECT to_regclass('votable_zone_votes_current'), "
                "to_regclass('electoral_archive.derived_archive_scope')"
            )
            serving_rel, marker_rel = cur.fetchone()
            if serving_rel is None or marker_rel is None:
                raise SystemExit("hybrid serving schema missing; apply AddHybridElectoralServing migration")

            current_runs, current_last = _freshness(cur)
            current_votable = _votable_stats(cur, "votable_zone_votes_current", scope)
            current_zone = _zone_stats(cur, "zone_office_totals_current", scope)
            if current_votable["rows"] == 0 or current_zone["rows"] == 0:
                raise SystemExit("refusing snapshot: current aggregate scope is empty")
            if current_votable["votes"] != current_zone["votes"]:
                raise SystemExit(
                    "refusing snapshot: current aggregate vote totals differ: "
                    f"votable={current_votable} zone={current_zone}"
                )

            cur.execute(
                "SELECT pg_advisory_xact_lock(hashtext(%s))",
                (f"derived-archive:{scope.year}:{scope.turn}:{scope.uf}",),
            )
            cur.execute(
                "DELETE FROM electoral_archive.votable_zone_votes "
                "WHERE year=%s AND turn=%s AND uf=%s",
                (scope.year, scope.turn, scope.uf),
            )
            cur.execute(
                """INSERT INTO electoral_archive.votable_zone_votes
                   SELECT * FROM votable_zone_votes_current
                    WHERE year=%s AND turn=%s AND uf=%s""",
                (scope.year, scope.turn, scope.uf),
            )
            cur.execute(
                "DELETE FROM electoral_archive.zone_office_totals "
                "WHERE year=%s AND turn=%s AND uf=%s",
                (scope.year, scope.turn, scope.uf),
            )
            cur.execute(
                """INSERT INTO electoral_archive.zone_office_totals
                   SELECT * FROM zone_office_totals_current
                    WHERE year=%s AND turn=%s AND uf=%s""",
                (scope.year, scope.turn, scope.uf),
            )

            archived_votable = _votable_stats(
                cur, "electoral_archive.votable_zone_votes", scope
            )
            archived_zone = _zone_stats(cur, "electoral_archive.zone_office_totals", scope)
            if archived_votable != current_votable or archived_zone != current_zone:
                raise RuntimeError(
                    "archive aggregate copy mismatch: "
                    f"current_votable={current_votable} archive_votable={archived_votable} "
                    f"current_zone={current_zone} archive_zone={archived_zone}"
                )

            cur.execute(
                """
                INSERT INTO electoral_archive.derived_archive_scope
                    (year, turn, uf, snapshotted_at, votable_rows, votable_votes, zone_rows, zone_votes)
                VALUES (%s, %s, %s, now(), %s, %s, %s, %s)
                ON CONFLICT (year, turn, uf) DO UPDATE SET
                    snapshotted_at=EXCLUDED.snapshotted_at,
                    votable_rows=EXCLUDED.votable_rows,
                    votable_votes=EXCLUDED.votable_votes,
                    zone_rows=EXCLUDED.zone_rows,
                    zone_votes=EXCLUDED.zone_votes
                """,
                (
                    scope.year,
                    scope.turn,
                    scope.uf,
                    archived_votable["rows"],
                    archived_votable["votes"],
                    archived_zone["rows"],
                    archived_zone["votes"],
                ),
            )

    print(
        json.dumps(
            {
                "status": "snapshotted",
                "scope": {"year": scope.year, "turn": scope.turn, "uf": scope.uf},
                "votable": archived_votable,
                "zone": archived_zone,
                "freshness": {
                    "buRuns": current_runs,
                    "buLastFinishedAt": current_last.isoformat() if current_last else None,
                },
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
