from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from src.electoral import db as electoral_db
from src.electoral.cadaster.store import load_zone_snapshot
from src.electoral.candidates.store import link_votables
from src.electoral.open_data.acquire import load_manifest, verify_file_sha256
from src.electoral.open_data.pipeline import prepare_import
from src.electoral.open_data.store import import_prepared


def _database_url(value: str | None) -> str:
    url = value or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL (or --database-url) is required")
    return url


def _write(path: Path | None, payload: dict[str, Any]) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def _state_stats(conn, *, year: int, turn: int, uf: str) -> dict[str, int]:
    params = {"year": year, "turn": turn, "uf": uf}
    row = conn.execute(
        """
        SELECT
          (SELECT count(*) FROM municipality WHERE state_code=%(uf)s),
          (SELECT count(*) FROM zone_municipality zm
             JOIN municipality m ON m.id=zm.municipality_id
             JOIN election e ON e.id=zm.election_id
            WHERE m.state_code=%(uf)s AND e.year=%(year)s AND e.round=%(turn)s),
          (SELECT count(*) FROM electoral_section s
             JOIN municipality m ON m.id=s.municipality_id
             JOIN election e ON e.id=s.election_id
            WHERE m.state_code=%(uf)s AND e.year=%(year)s AND e.round=%(turn)s),
          (SELECT count(*) FROM section_office_result r
            WHERE r.uf=%(uf)s AND r.year=%(year)s AND r.turn=%(turn)s),
          (SELECT count(*) FROM section_office_vote v
             JOIN section_office_result r ON r.id=v.result_id
            WHERE r.uf=%(uf)s AND r.year=%(year)s AND r.turn=%(turn)s),
          (SELECT coalesce(sum(v.votes),0) FROM section_office_vote v
             JOIN section_office_result r ON r.id=v.result_id
            WHERE r.uf=%(uf)s AND r.year=%(year)s AND r.turn=%(turn)s),
          (SELECT count(*) FROM votable v WHERE v.uf=%(uf)s),
          (SELECT count(*) FROM votable_candidacy vc WHERE vc.uf=%(uf)s)
        """,
        params,
    ).fetchone()
    return {
        "municipalities": int(row[0]),
        "municipality_zone": int(row[1]),
        "sections": int(row[2]),
        "section_office_result": int(row[3]),
        "section_office_vote": int(row[4]),
        "votes": int(row[5]),
        "votables": int(row[6]),
        "votable_links": int(row[7]),
    }


def _scopes(conn, *, year: int, turn: int, uf: str) -> list[tuple[str, int]]:
    return conn.execute(
        """
        SELECT m.tse_code, z.zone_number
          FROM zone_municipality zm
          JOIN municipality m ON m.id=zm.municipality_id
          JOIN electoral_zone z ON z.id=zm.zone_id
          JOIN election e ON e.id=zm.election_id
         WHERE m.state_code=%s AND e.year=%s AND e.round=%s
         ORDER BY m.tse_code,z.zone_number
        """,
        (uf, year, turn),
    ).fetchall()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import one UF of official TSE BU data into REPBrasil")
    parser.add_argument("--uf", required=True)
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--turn", type=int, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--database-url", default=None)
    parser.add_argument("--progress", type=Path, default=None)
    parser.add_argument("--report", type=Path, default=None)
    parser.add_argument("--link-votables", action="store_true")
    parser.add_argument("--protect-uf", default=None, help="fail if this UF changes while the target UF is imported")
    args = parser.parse_args(argv)

    uf = args.uf.upper()
    protect_uf = args.protect_uf.upper() if args.protect_uf else None
    manifest, csv_path = load_manifest(args.manifest)
    scope = manifest.get("scope", {})
    expected = (args.year, args.turn, uf)
    actual = (int(scope.get("year", -1)), int(scope.get("turn", -1)), str(scope.get("uf", "")).upper())
    if actual != expected:
        raise SystemExit(f"manifest scope {actual} does not match requested {expected}")
    verify_file_sha256(csv_path, manifest["csv"]["sha256"])

    summary: dict[str, Any] = {
        "uf": uf,
        "year": args.year,
        "turn": args.turn,
        "csv_sha256_verified": True,
        "scopes_total": 0,
        "imported": 0,
        "already_present": 0,
        "vote_records_imported": 0,
        "votes_imported": 0,
    }

    with electoral_db.connect(_database_url(args.database_url), autocommit=True) as conn:
        protected_before = _state_stats(conn, year=args.year, turn=args.turn, uf=protect_uf) if protect_uf else None
        pairs = _scopes(conn, year=args.year, turn=args.turn, uf=uf)
        if not pairs:
            raise SystemExit(f"no electoral cadaster scopes found for {uf} {args.year}/{args.turn}")
        summary["scopes_total"] = len(pairs)

        for index, (code, zone) in enumerate(pairs, 1):
            exists = conn.execute(
                """SELECT EXISTS(
                       SELECT 1 FROM section_office_result
                        WHERE year=%s AND turn=%s AND uf=%s AND municipality_tse_code=%s AND zone=%s
                     )""",
                (args.year, args.turn, uf, str(code), zone),
            ).fetchone()[0]
            if exists:
                summary["already_present"] += 1
            else:
                snapshot = load_zone_snapshot(
                    conn,
                    year=args.year,
                    turn=args.turn,
                    uf=uf,
                    municipality=int(code),
                    zone=zone,
                )
                prepared = prepare_import(
                    args.manifest,
                    municipality=int(code),
                    zone=zone,
                    cadastro=snapshot,
                    verify_csv_hash=False,
                )
                report = import_prepared(conn, prepared)
                summary["imported"] += 1
                summary["vote_records_imported"] += int(report["vote_records"])
                summary["votes_imported"] += sum(int(item["votes_total"]) for item in report["offices"].values())
            summary["progress"] = {"done": index, "total": len(pairs)}
            _write(args.progress, summary)

        if args.link_votables:
            summary["link"] = link_votables(conn, year=args.year, turn=args.turn, uf=uf)

        summary["state"] = _state_stats(conn, year=args.year, turn=args.turn, uf=uf)
        if protect_uf:
            protected_after = _state_stats(conn, year=args.year, turn=args.turn, uf=protect_uf)
            summary["protected_uf"] = {
                "uf": protect_uf,
                "before": protected_before,
                "after": protected_after,
                "unchanged": protected_before == protected_after,
            }
            if protected_before != protected_after:
                _write(args.report, summary)
                print(json.dumps(summary, ensure_ascii=False))
                return 1

    _write(args.progress, summary)
    _write(args.report, summary)
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
