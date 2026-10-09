from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import psycopg

from .state_sync import ZoneScope, sync_state_results


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="urnai-sync-results",
        description="Import every municipality/zone from one official TSE BU UF resource through the canonical cadaster.",
    )
    parser.add_argument("manifest", type=Path, help="open-data BU manifest.json or content-addressed directory")
    parser.add_argument(
        "--municipality",
        action="append",
        default=[],
        help="optional TSE municipality code; repeatable. Omit to sync the entire UF in the manifest.",
    )
    parser.add_argument("--database-url", default=None, help="defaults to $DATABASE_URL")
    parser.add_argument("--dry-run", action="store_true", help="validate/normalize/reconcile every scope without writing results")
    parser.add_argument("--skip-csv-hash", action="store_true", help="skip the pre-import CSV SHA-256 verification (not recommended)")
    parser.add_argument("--report", type=Path, default=None, help="also write the final JSON report to this path")
    parser.add_argument("--quiet", action="store_true", help="suppress per-zone progress on stderr")
    return parser


def _progress(index: int, total: int, scope: ZoneScope, report: dict) -> None:
    status = report.get("status", "unknown")
    votes = report.get("vote_records", 0)
    print(
        f"[{index}/{total}] {scope.municipality_code} · zona {scope.zone:03d} · {status} · {votes} registros de voto",
        file=sys.stderr,
        flush=True,
    )


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    database_url = args.database_url or os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL (or --database-url) is required; the canonical cadaster lives in PostgreSQL")
    municipalities = [int(m) for m in args.municipality] or None
    with psycopg.connect(database_url, autocommit=True) as conn:
        report = sync_state_results(
            conn,
            args.manifest,
            municipalities=municipalities,
            dry_run=args.dry_run,
            verify_csv_hash=not args.skip_csv_hash,
            progress=None if args.quiet else _progress,
        )
    payload = json.dumps(report, ensure_ascii=False, indent=2, default=str)
    if args.report is not None:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        tmp = args.report.with_suffix(args.report.suffix + ".tmp")
        tmp.write_text(payload + "\n", encoding="utf-8")
        tmp.replace(args.report)
    print(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
