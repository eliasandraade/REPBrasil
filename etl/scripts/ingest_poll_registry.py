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

from src.electoral.poll_registry import parse_poll_registry_archive
from src.electoral.polls import PollSource, load_poll
from src.sources.tse.polls import TsePollArchiveClient


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Acquire and ingest official TSE PesqEle registration metadata."
    )
    result.add_argument("--year", type=int, default=2026)
    result.add_argument(
        "--uf",
        default="CE",
        help="Exact registry scope to load: CE by default, BR for national registrations.",
    )
    return result


def normalized_scope(value: str) -> str:
    scope = value.strip().upper()
    if scope != "BR" and (len(scope) != 2 or not scope.isalpha()):
        raise ValueError("--uf must be BR or a two-letter UF")
    return scope


def main() -> int:
    args = parser().parse_args()
    try:
        uf_filter = normalized_scope(args.uf)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is required", file=sys.stderr)
        return 2

    try:
        with TsePollArchiveClient() as client:
            artifact = client.fetch(args.year)
        if artifact.content is None:
            raise RuntimeError("unexpected empty PesqEle archive response")
        parsed = parse_poll_registry_archive(
            artifact.content,
            year=args.year,
            uf_filter=uf_filter,
        )
    except (ValueError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        return 2

    source = PollSource(
        provider="TSE/PesqEle",
        dataset=f"pesquisa_eleitoral_{args.year}_{uf_filter}",
        source_url=artifact.url,
        content=artifact.content,
        metadata={
            "year": args.year,
            "member": parsed.member_name,
            "uf_filter": uf_filter,
            "etag": artifact.etag,
            "last_modified": artifact.last_modified,
            "complete_snapshot": True,
        },
    )

    poll_ids: list[str] = []
    with psycopg.connect(database_url) as conn:
        try:
            for record in parsed.rows:
                poll_ids.append(
                    load_poll(
                        conn,
                        source=source,
                        record=record,
                        commit=False,
                    )
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    print(
        json.dumps(
            {
                "year": args.year,
                "uf_filter": uf_filter,
                "member": parsed.member_name,
                "source_url": artifact.url,
                "sha256": artifact.sha256,
                "records": len(parsed.rows),
                "polls": len(set(poll_ids)),
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
