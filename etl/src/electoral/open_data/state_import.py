"""Importador estadual resumível do Boletim de Urna oficial.

Executa a verificação SHA-256 do CSV uma única vez, enumera os escopos a
partir do cadastro eleitoral canônico e persiste cada município/zona em uma
transação independente. Uma reexecução do mesmo artefato pula escopos já
concluídos sem reler o CSV para esses escopos.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

import psycopg

from .. import db as electoral_db
from ..cadaster.store import load_zone_snapshot
from .acquire import load_manifest, verify_file_sha256
from .pipeline import prepare_import
from .store import import_prepared


class StateImportError(RuntimeError):
    pass


def _validate_manifest_scope(manifest: dict[str, Any], *, year: int, turn: int, uf: str) -> str:
    expected_uf = uf.upper()
    scope = manifest.get("scope") or {}
    actual = (scope.get("year"), scope.get("turn"), str(scope.get("uf", "")).upper())
    expected = (year, turn, expected_uf)
    if actual != expected:
        raise StateImportError(f"manifest scope {actual} differs from requested scope {expected}")
    checksum = manifest.get("official_checksum") or {}
    if checksum.get("verified") is not True:
        raise StateImportError("manifest does not record a verified official checksum")
    return expected_uf


def _scopes(conn: psycopg.Connection, *, year: int, turn: int, uf: str) -> list[tuple[str, int]]:
    rows = conn.execute(
        """SELECT m.tse_code, z.zone_number
             FROM zone_municipality zm
             JOIN municipality m ON m.id = zm.municipality_id
             JOIN electoral_zone z ON z.id = zm.zone_id
             JOIN election e ON e.id = zm.election_id
            WHERE m.state_code=%s AND e.year=%s AND e.round=%s
            ORDER BY m.tse_code, z.zone_number""",
        (uf, year, turn),
    ).fetchall()
    if not rows:
        raise StateImportError(
            f"no canonical cadaster scopes for {uf} {year}/{turn}; import the electoral cadaster first"
        )
    return [(str(code).zfill(5), int(zone)) for code, zone in rows]


def _completed_scopes(conn: psycopg.Connection, *, zip_sha256: str) -> set[tuple[str, int]]:
    source = conn.execute(
        "SELECT id FROM open_data_source_file WHERE zip_sha256=%s",
        (zip_sha256,),
    ).fetchone()
    if source is None:
        return set()
    rows = conn.execute(
        """SELECT scope->>'municipality', (scope->>'zone')::int
             FROM ingestion_run
            WHERE source_file_id=%s AND source='tse-open-data-bu' AND status='succeeded'
              AND scope ? 'municipality' AND scope ? 'zone'""",
        (source[0],),
    ).fetchall()
    return {(str(municipality).zfill(5), int(zone)) for municipality, zone in rows}


def _state_totals(conn: psycopg.Connection, *, year: int, turn: int, uf: str) -> dict[str, int]:
    row = conn.execute(
        """SELECT count(DISTINCT r.id), count(v.id), COALESCE(sum(v.votes), 0)
             FROM section_office_result r
             LEFT JOIN section_office_vote v ON v.result_id = r.id
            WHERE r.year=%s AND r.turn=%s AND r.uf=%s""",
        (year, turn, uf),
    ).fetchone()
    assert row is not None
    return {
        "section_office_results": int(row[0]),
        "vote_rows": int(row[1]),
        "votes": int(row[2]),
    }


def _write_json(path: Path | None, value: dict[str, Any]) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def import_state(
    conn: psycopg.Connection,
    manifest_path: Path,
    *,
    year: int,
    turn: int,
    uf: str,
    progress_path: Path | None = None,
) -> dict[str, Any]:
    manifest, csv_path = load_manifest(manifest_path)
    state = _validate_manifest_scope(manifest, year=year, turn=turn, uf=uf)
    verify_file_sha256(csv_path, manifest["csv"]["sha256"])

    scopes = _scopes(conn, year=year, turn=turn, uf=state)
    completed = _completed_scopes(conn, zip_sha256=manifest["zip"]["sha256"])
    summary: dict[str, Any] = {
        "status": "running",
        "year": year,
        "turn": turn,
        "uf": state,
        "source": {
            "zip_sha256": manifest["zip"]["sha256"],
            "csv_sha256": manifest["csv"]["sha256"],
            "official_checksum_verified": True,
        },
        "scopes_total": len(scopes),
        "imported": 0,
        "already_imported": 0,
        "processed": 0,
    }
    _write_json(progress_path, summary)

    for municipality, zone in scopes:
        scope_key = (municipality, zone)
        if scope_key in completed:
            summary["already_imported"] += 1
            summary["processed"] += 1
            _write_json(progress_path, summary)
            continue
        try:
            snapshot = load_zone_snapshot(
                conn,
                year=year,
                turn=turn,
                uf=state,
                municipality=municipality,
                zone=zone,
            )
            prepared = prepare_import(
                manifest_path,
                municipality=int(municipality),
                zone=zone,
                cadastro=snapshot,
                verify_csv_hash=False,
            )
            report = import_prepared(conn, prepared)
        except Exception as exc:
            summary["status"] = "failed"
            summary["failed_scope"] = {"municipality": municipality, "zone": zone}
            summary["error"] = str(exc)
            _write_json(progress_path, summary)
            raise

        if report["status"] == "already_imported":
            summary["already_imported"] += 1
        else:
            summary["imported"] += 1
        summary["processed"] += 1
        _write_json(progress_path, summary)

    summary["status"] = "succeeded"
    summary["totals"] = _state_totals(conn, year=year, turn=turn, uf=state)
    _write_json(progress_path, summary)
    return summary


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Import one UF from an acquired official BU manifest")
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--turn", type=int, required=True)
    parser.add_argument("--uf", required=True)
    parser.add_argument("--database-url", default=None, help="defaults to $DATABASE_URL")
    parser.add_argument("--progress", type=Path, default=None)
    parser.add_argument("--report", type=Path, default=None)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    database_url = args.database_url or os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL (or --database-url) is required")
    with electoral_db.connect(database_url, autocommit=True) as conn:
        report = import_state(
            conn,
            args.manifest,
            year=args.year,
            turn=args.turn,
            uf=args.uf,
            progress_path=args.progress,
        )
    _write_json(args.report, report)
    print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
