#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.electoral.live_count import load_live_result, parse_live_result
from src.sources.tse.live_results import (
    TseLiveResultsClient,
    official_2026_election_code,
    result_url,
)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Acquire and persist audited official TSE totalization snapshots."
    )
    result.add_argument("--year", type=int, default=2026)
    result.add_argument("--round", type=int, choices=[1, 2], default=1)
    result.add_argument("--office", type=int, required=True)
    result.add_argument("--uf")
    result.add_argument("--municipality-tse-code")
    result.add_argument("--election-code", type=int)
    result.add_argument(
        "--watch-seconds",
        type=int,
        default=0,
        help="0 executes once; otherwise poll the official artifact at this interval (minimum 15s).",
    )
    result.add_argument(
        "--until-final",
        action="store_true",
        help="With --watch-seconds, stop after an official final snapshot is persisted.",
    )
    return result


def resolve_election_code(*, year: int, round_number: int, office: int, explicit: int | None) -> int:
    if explicit is not None:
        if explicit <= 0:
            raise ValueError("--election-code must be positive")
        return explicit
    if year == 2026:
        return official_2026_election_code(round_number, office)
    raise ValueError("--election-code is required outside the audited 2026 mapping")


def validate_args(args: argparse.Namespace) -> None:
    if args.office <= 0:
        raise ValueError("--office must be positive")
    if args.watch_seconds != 0 and args.watch_seconds < 15:
        raise ValueError("--watch-seconds must be 0 or at least 15")
    if args.until_final and args.watch_seconds == 0:
        raise ValueError("--until-final requires --watch-seconds")
    if args.municipality_tse_code and not args.uf:
        raise ValueError("--municipality-tse-code requires --uf")


def main() -> int:
    args = parser().parse_args()
    try:
        validate_args(args)
        election_code = resolve_election_code(
            year=args.year,
            round_number=args.round,
            office=args.office,
            explicit=args.election_code,
        )
        url = result_url(
            year=args.year,
            election_code=election_code,
            office_code=args.office,
            uf=args.uf,
            municipality_tse_code=args.municipality_tse_code,
        )
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is required", file=sys.stderr)
        return 2

    etag: str | None = None
    last_modified: str | None = None
    with TseLiveResultsClient() as client:
        while True:
            artifact = client.fetch(url, etag=etag, last_modified=last_modified)
            etag = artifact.etag
            last_modified = artifact.last_modified

            if artifact.status_code == 304 or artifact.content is None:
                print(
                    json.dumps(
                        {
                            "status": "unchanged",
                            "url": artifact.url,
                            "etag": etag,
                            "last_modified": last_modified,
                        },
                        ensure_ascii=False,
                        sort_keys=True,
                    ),
                    flush=True,
                )
            else:
                parsed = parse_live_result(artifact.content, office_code=args.office)
                with psycopg.connect(database_url) as conn:
                    snapshot_id = load_live_result(
                        conn,
                        year=args.year,
                        uf=args.uf,
                        municipality_tse_code=args.municipality_tse_code,
                        source_url=artifact.url,
                        raw_content=artifact.content,
                        parsed=parsed,
                    )
                print(
                    json.dumps(
                        {
                            "status": parsed.status,
                            "snapshot_id": snapshot_id,
                            "year": args.year,
                            "round": parsed.round_number,
                            "office": parsed.office_code,
                            "election_code": parsed.election_code,
                            "scope_type": parsed.scope_type,
                            "scope_code": parsed.scope_code,
                            "counted_sections": parsed.counted_sections,
                            "total_sections": parsed.total_sections,
                            "counted_percent": (
                                str(parsed.counted_percent)
                                if parsed.counted_percent is not None
                                else None
                            ),
                            "generated_at": (
                                parsed.generated_at.isoformat()
                                if parsed.generated_at is not None
                                else None
                            ),
                            "sha256": artifact.sha256,
                            "url": artifact.url,
                        },
                        ensure_ascii=False,
                        sort_keys=True,
                    ),
                    flush=True,
                )
                if args.until_final and parsed.status == "final":
                    return 0

            if args.watch_seconds == 0:
                return 0
            time.sleep(args.watch_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
