from __future__ import annotations

import hashlib
import json
import os
import shutil
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import polars as pl
import psycopg

LAKE_SCHEMA_VERSION = 1
VOTE_COLUMNS = (
    "year",
    "turn",
    "uf",
    "municipality_tse_code",
    "zone",
    "section",
    "office_code",
    "result_id",
    "votable_id",
    "votes",
    "source_row_hash",
    "source_line",
)


class LakeError(RuntimeError):
    pass


@dataclass(frozen=True)
class LakeScope:
    year: int
    turn: int
    uf: str

    def normalized(self) -> "LakeScope":
        uf = self.uf.strip().upper()
        if len(uf) != 2:
            raise LakeError(f"invalid UF: {self.uf!r}")
        if self.year < 1900 or self.turn < 1:
            raise LakeError(f"invalid election scope: {self.year}/{self.turn}")
        return LakeScope(self.year, self.turn, uf)


def scope_path(root: Path, scope: LakeScope) -> Path:
    s = scope.normalized()
    return root / "electoral" / f"year={s.year}" / f"turn={s.turn}" / f"uf={s.uf}"


def municipality_path(root: Path, scope: LakeScope, municipality_tse_code: str) -> Path:
    return scope_path(root, scope) / f"municipality={str(municipality_tse_code).zfill(5)}"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _latest_vote_sql(extra_where: str = "") -> str:
    return f"""
        SELECT r.year::int, r.turn::int, r.uf::text, r.municipality_tse_code::text,
               r.zone::int, r.section::int, r.office_code::int,
               v.result_id::bigint, v.votable_id::bigint, v.votes::int,
               v.source_row_hash::text, v.source_line::bigint
          FROM latest_bu_ingestion_run l
          JOIN section_office_result r ON r.ingestion_run_id = l.ingestion_run_id
          JOIN section_office_vote v ON v.result_id = r.id
         WHERE r.year = %s AND r.turn = %s AND r.uf = %s {extra_where}
         ORDER BY r.municipality_tse_code, r.zone, r.section, r.office_code, v.result_id, v.votable_id
    """


def database_totals(conn: psycopg.Connection, scope: LakeScope) -> dict[str, int]:
    s = scope.normalized()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT count(v.id)::bigint, COALESCE(sum(v.votes), 0)::bigint,
                   count(DISTINCT r.municipality_tse_code)::int
              FROM latest_bu_ingestion_run l
              JOIN section_office_result r ON r.ingestion_run_id = l.ingestion_run_id
              JOIN section_office_vote v ON v.result_id = r.id
             WHERE r.year = %s AND r.turn = %s AND r.uf = %s
            """,
            (s.year, s.turn, s.uf),
        )
        row = cur.fetchone()
    assert row is not None
    return {"rows": int(row[0]), "votes": int(row[1]), "municipalities": int(row[2])}


def municipalities(conn: psycopg.Connection, scope: LakeScope) -> list[str]:
    s = scope.normalized()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT r.municipality_tse_code::text
              FROM latest_bu_ingestion_run l
              JOIN section_office_result r ON r.ingestion_run_id = l.ingestion_run_id
             WHERE r.year = %s AND r.turn = %s AND r.uf = %s
             ORDER BY 1
            """,
            (s.year, s.turn, s.uf),
        )
        return [str(row[0]).zfill(5) for row in cur.fetchall()]


def _rows_to_frame(rows: Iterable[tuple[Any, ...]]) -> pl.DataFrame:
    materialized = list(rows)
    if not materialized:
        return pl.DataFrame({name: [] for name in VOTE_COLUMNS})
    return pl.DataFrame(materialized, schema=VOTE_COLUMNS, orient="row")


def _write_municipality(
    conn: psycopg.Connection,
    root: Path,
    scope: LakeScope,
    municipality_tse_code: str,
    *,
    chunk_rows: int,
) -> list[dict[str, Any]]:
    target = municipality_path(root, scope, municipality_tse_code)
    target.mkdir(parents=True, exist_ok=True)
    files: list[dict[str, Any]] = []
    s = scope.normalized()
    cursor_name = f"lake_{s.year}_{s.turn}_{s.uf}_{municipality_tse_code}_{uuid.uuid4().hex[:8]}"
    with conn.cursor(name=cursor_name) as cur:
        cur.execute(
            _latest_vote_sql("AND r.municipality_tse_code = %s"),
            (s.year, s.turn, s.uf, str(municipality_tse_code).zfill(5)),
        )
        part = 0
        while True:
            rows = cur.fetchmany(chunk_rows)
            if not rows:
                break
            frame = _rows_to_frame(rows)
            path = target / f"part-{part:05d}.parquet"
            frame.write_parquet(path, compression="zstd", statistics=True)
            files.append(
                {
                    "path": str(path.relative_to(root)),
                    "rows": frame.height,
                    "votes": int(frame.get_column("votes").sum() or 0),
                    "bytes": path.stat().st_size,
                    "sha256": _sha256(path),
                }
            )
            part += 1
    return files


def parquet_totals(root: Path, scope: LakeScope) -> dict[str, int]:
    base = scope_path(root, scope)
    paths = sorted(base.glob("municipality=*/part-*.parquet"))
    if not paths:
        return {"rows": 0, "votes": 0, "municipalities": 0}
    lazy = pl.scan_parquet([str(path) for path in paths])
    totals = lazy.select(
        pl.len().alias("rows"),
        pl.col("votes").sum().alias("votes"),
        pl.col("municipality_tse_code").n_unique().alias("municipalities"),
    ).collect().row(0)
    return {"rows": int(totals[0]), "votes": int(totals[1] or 0), "municipalities": int(totals[2])}


def validate_files(root: Path, manifest: dict[str, Any]) -> None:
    for item in manifest.get("files", []):
        path = root / item["path"]
        if not path.is_file():
            raise LakeError(f"missing parquet part: {path}")
        if path.stat().st_size != int(item["bytes"]):
            raise LakeError(f"size mismatch: {path}")
        if _sha256(path) != item["sha256"]:
            raise LakeError(f"sha256 mismatch: {path}")


def load_manifest(root: Path, scope: LakeScope) -> dict[str, Any]:
    path = scope_path(root, scope) / "manifest.json"
    if not path.is_file():
        raise LakeError(f"manifest not found: {path}")
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if int(manifest.get("schema_version", 0)) != LAKE_SCHEMA_VERSION:
        raise LakeError(f"unsupported lake schema version: {manifest.get('schema_version')}")
    validate_files(root, manifest)
    return manifest


def archive_scope(
    conn: psycopg.Connection,
    root: Path,
    scope: LakeScope,
    *,
    chunk_rows: int = 100_000,
    replace: bool = False,
) -> dict[str, Any]:
    if chunk_rows < 1:
        raise LakeError("chunk_rows must be positive")
    s = scope.normalized()
    root = root.resolve()
    final = scope_path(root, s)
    if final.exists() and not replace:
        raise LakeError(f"lake scope already exists: {final}")

    staging_root = root / f".staging-{s.year}-{s.turn}-{s.uf}-{uuid.uuid4().hex}"
    staging_scope = scope_path(staging_root, s)
    staging_scope.mkdir(parents=True, exist_ok=False)
    try:
        expected = database_totals(conn, s)
        files: list[dict[str, Any]] = []
        for municipality in municipalities(conn, s):
            files.extend(
                _write_municipality(
                    conn,
                    staging_root,
                    s,
                    municipality,
                    chunk_rows=chunk_rows,
                )
            )

        actual = parquet_totals(staging_root, s)
        if actual != expected:
            raise LakeError(f"database/parquet totals differ: database={expected} parquet={actual}")

        manifest = {
            "schema_version": LAKE_SCHEMA_VERSION,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "scope": {"year": s.year, "turn": s.turn, "uf": s.uf},
            "totals": actual,
            "files": files,
        }
        (staging_scope / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        validate_files(staging_root, manifest)

        final.parent.mkdir(parents=True, exist_ok=True)
        if final.exists():
            if not replace:
                raise LakeError(f"lake scope already exists: {final}")
            backup = final.with_name(final.name + f".replaced-{uuid.uuid4().hex}")
            final.rename(backup)
            try:
                staging_scope.rename(final)
            except Exception:
                backup.rename(final)
                raise
            shutil.rmtree(backup)
        else:
            staging_scope.rename(final)
        return manifest
    finally:
        shutil.rmtree(staging_root, ignore_errors=True)


def scan_scope(
    root: Path,
    scope: LakeScope,
    *,
    municipality_tse_code: str | None = None,
    zone: int | None = None,
    result_ids: list[int] | None = None,
    votable_ids: list[int] | None = None,
) -> pl.LazyFrame:
    base = scope_path(root, scope)
    if municipality_tse_code is None:
        paths = sorted(base.glob("municipality=*/part-*.parquet"))
    else:
        paths = sorted(municipality_path(root, scope, municipality_tse_code).glob("part-*.parquet"))
    if not paths:
        raise LakeError(f"no parquet data for {scope.normalized()}")
    frame = pl.scan_parquet([str(path) for path in paths])
    if zone is not None:
        frame = frame.filter(pl.col("zone") == int(zone))
    if result_ids:
        frame = frame.filter(pl.col("result_id").is_in(result_ids))
    if votable_ids:
        frame = frame.filter(pl.col("votable_id").is_in(votable_ids))
    return frame


def lake_root_from_env() -> Path:
    return Path(os.environ.get("REPBRASIL_LAKE_ROOT", "/data/lake"))
