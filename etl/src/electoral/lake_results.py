from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import polars as pl
import psycopg

from .lake import LakeError, LakeScope, scope_path

RESULT_SCHEMA_VERSION = 1
RESULT_COLUMNS = (
    "result_id",
    "year",
    "turn",
    "uf",
    "election_code",
    "municipality_tse_code",
    "municipality_name",
    "zone",
    "section",
    "office_code",
    "aggregated_sections",
    "polling_place_code",
    "eligible",
    "turnout",
    "abstentions",
    "votes_total",
)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def result_path(root: Path, scope: LakeScope) -> Path:
    return scope_path(root, scope) / "results.parquet"


def result_manifest_path(root: Path, scope: LakeScope) -> Path:
    return scope_path(root, scope) / "results-manifest.json"


def database_result_totals(conn: psycopg.Connection, scope: LakeScope) -> dict[str, int]:
    s = scope.normalized()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT count(*)::bigint,
                   count(DISTINCT r.municipality_tse_code)::int,
                   COALESCE(sum(r.votes_total), 0)::bigint
              FROM latest_bu_ingestion_run l
              JOIN section_office_result r ON r.ingestion_run_id = l.ingestion_run_id
             WHERE r.year = %s AND r.turn = %s AND r.uf = %s
            """,
            (s.year, s.turn, s.uf),
        )
        row = cur.fetchone()
    assert row is not None
    return {"rows": int(row[0]), "municipalities": int(row[1]), "votes": int(row[2])}


def _read_results(conn: psycopg.Connection, scope: LakeScope) -> pl.DataFrame:
    s = scope.normalized()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT r.id::bigint, r.year::int, r.turn::int, r.uf::text,
                   r.election_code::int, r.municipality_tse_code::text,
                   r.municipality_name::text, r.zone::int, r.section::int,
                   r.office_code::int, r.aggregated_sections::int[],
                   r.polling_place_code::int, r.eligible::int, r.turnout::int,
                   r.abstentions::int, r.votes_total::bigint
              FROM latest_bu_ingestion_run l
              JOIN section_office_result r ON r.ingestion_run_id = l.ingestion_run_id
             WHERE r.year = %s AND r.turn = %s AND r.uf = %s
             ORDER BY r.municipality_tse_code, r.zone, r.section, r.office_code, r.id
            """,
            (s.year, s.turn, s.uf),
        )
        rows = cur.fetchall()
    if not rows:
        raise LakeError(f"no current section results for {s}")
    return pl.DataFrame(rows, schema=RESULT_COLUMNS, orient="row")


def parquet_result_totals(root: Path, scope: LakeScope) -> dict[str, int]:
    path = result_path(root, scope)
    if not path.is_file():
        return {"rows": 0, "municipalities": 0, "votes": 0}
    row = (
        pl.scan_parquet(path)
        .select(
            pl.len().alias("rows"),
            pl.col("municipality_tse_code").n_unique().alias("municipalities"),
            pl.col("votes_total").sum().alias("votes"),
        )
        .collect()
        .row(0)
    )
    return {"rows": int(row[0]), "municipalities": int(row[1]), "votes": int(row[2] or 0)}


def load_result_manifest(root: Path, scope: LakeScope) -> dict[str, Any]:
    manifest_path = result_manifest_path(root, scope)
    if not manifest_path.is_file():
        raise LakeError(f"result manifest not found: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if int(manifest.get("schema_version", 0)) != RESULT_SCHEMA_VERSION:
        raise LakeError(f"unsupported result metadata schema: {manifest.get('schema_version')}")
    path = result_path(root, scope)
    if not path.is_file():
        raise LakeError(f"result parquet not found: {path}")
    file_info = manifest.get("file", {})
    if path.stat().st_size != int(file_info.get("bytes", -1)):
        raise LakeError(f"result parquet size mismatch: {path}")
    if _sha256(path) != file_info.get("sha256"):
        raise LakeError(f"result parquet sha256 mismatch: {path}")
    actual = parquet_result_totals(root, scope)
    if actual != manifest.get("totals"):
        raise LakeError(f"result manifest/parquet totals differ: manifest={manifest.get('totals')} parquet={actual}")
    return manifest


def archive_result_metadata(
    conn: psycopg.Connection,
    root: Path,
    scope: LakeScope,
    *,
    replace: bool = False,
) -> dict[str, Any]:
    s = scope.normalized()
    root = root.resolve()
    base = scope_path(root, s)
    if not (base / "manifest.json").is_file():
        raise LakeError(f"vote archive must exist before result metadata: {base}")
    final = result_path(root, s)
    final_manifest = result_manifest_path(root, s)
    if (final.exists() or final_manifest.exists()) and not replace:
        raise LakeError(f"result metadata already exists for {s}; use --replace")

    expected = database_result_totals(conn, s)
    frame = _read_results(conn, s)
    if frame.height != expected["rows"]:
        raise LakeError(f"result row count changed during snapshot: database={expected['rows']} frame={frame.height}")

    base.mkdir(parents=True, exist_ok=True)
    token = uuid.uuid4().hex
    tmp = base / f".results-{token}.parquet"
    tmp_manifest = base / f".results-manifest-{token}.json"
    try:
        frame.write_parquet(tmp, compression="zstd", statistics=True)
        actual = {
            "rows": frame.height,
            "municipalities": int(frame.get_column("municipality_tse_code").n_unique()),
            "votes": int(frame.get_column("votes_total").sum() or 0),
        }
        if actual != expected:
            raise LakeError(f"database/result parquet totals differ: database={expected} parquet={actual}")
        manifest = {
            "schema_version": RESULT_SCHEMA_VERSION,
            "created_at": datetime.now(UTC).isoformat(),
            "scope": {"year": s.year, "turn": s.turn, "uf": s.uf},
            "totals": actual,
            "file": {
                "path": str(final.relative_to(root)),
                "rows": frame.height,
                "bytes": tmp.stat().st_size,
                "sha256": _sha256(tmp),
            },
        }
        tmp_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp.replace(final)
        tmp_manifest.replace(final_manifest)
        load_result_manifest(root, s)
        return manifest
    finally:
        tmp.unlink(missing_ok=True)
        tmp_manifest.unlink(missing_ok=True)


def scan_results(
    root: Path,
    scope: LakeScope,
    *,
    municipality_tse_code: str | None = None,
    zone: int | None = None,
    office_codes: list[int] | None = None,
    result_ids: list[int] | None = None,
) -> pl.LazyFrame:
    load_result_manifest(root, scope)
    frame = pl.scan_parquet(result_path(root, scope))
    if municipality_tse_code is not None:
        frame = frame.filter(pl.col("municipality_tse_code") == str(municipality_tse_code).zfill(5))
    if zone is not None:
        frame = frame.filter(pl.col("zone") == int(zone))
    if office_codes:
        frame = frame.filter(pl.col("office_code").is_in([int(value) for value in office_codes]))
    if result_ids:
        frame = frame.filter(pl.col("result_id").is_in([int(value) for value in result_ids]))
    return frame
