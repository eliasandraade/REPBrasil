from __future__ import annotations

import hashlib
import json
from pathlib import Path

import polars as pl
import pytest

from src.electoral.lake import LAKE_SCHEMA_VERSION, LakeError, LakeScope, load_manifest, parquet_totals, scope_path


def _write_fixture(root: Path) -> tuple[LakeScope, Path]:
    scope = LakeScope(2026, 1, "ce")
    base = scope_path(root, scope)
    municipality = base / "municipality=13897"
    municipality.mkdir(parents=True)
    frame = pl.DataFrame(
        {
            "year": [2026, 2026],
            "turn": [1, 1],
            "uf": ["CE", "CE"],
            "municipality_tse_code": ["13897", "13897"],
            "zone": [1, 1],
            "section": [10, 10],
            "office_code": [1, 1],
            "result_id": [100, 100],
            "votable_id": [7, 8],
            "votes": [12, 3],
            "source_row_hash": ["a" * 64, "b" * 64],
            "source_line": [20, 21],
        }
    )
    part = municipality / "part-00000.parquet"
    frame.write_parquet(part, compression="zstd", statistics=True)
    return scope, part


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_parquet_totals(tmp_path: Path) -> None:
    scope, _ = _write_fixture(tmp_path)
    assert parquet_totals(tmp_path, scope) == {"rows": 2, "votes": 15, "municipalities": 1}


def test_manifest_verifies_file_hash_and_size(tmp_path: Path) -> None:
    scope, part = _write_fixture(tmp_path)
    manifest = {
        "schema_version": LAKE_SCHEMA_VERSION,
        "scope": {"year": 2026, "turn": 1, "uf": "CE"},
        "totals": {"rows": 2, "votes": 15, "municipalities": 1},
        "files": [
            {
                "path": str(part.relative_to(tmp_path)),
                "rows": 2,
                "votes": 15,
                "bytes": part.stat().st_size,
                "sha256": _sha256(part),
            }
        ],
    }
    (scope_path(tmp_path, scope) / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    assert load_manifest(tmp_path, scope)["totals"]["votes"] == 15


def test_manifest_detects_tampered_parquet(tmp_path: Path) -> None:
    scope, part = _write_fixture(tmp_path)
    manifest = {
        "schema_version": LAKE_SCHEMA_VERSION,
        "scope": {"year": 2026, "turn": 1, "uf": "CE"},
        "totals": {"rows": 2, "votes": 15, "municipalities": 1},
        "files": [
            {
                "path": str(part.relative_to(tmp_path)),
                "rows": 2,
                "votes": 15,
                "bytes": part.stat().st_size,
                "sha256": _sha256(part),
            }
        ],
    }
    (scope_path(tmp_path, scope) / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    part.write_bytes(part.read_bytes() + b"tampered")
    with pytest.raises(LakeError, match="size mismatch"):
        load_manifest(tmp_path, scope)


def test_scope_normalizes_uf_and_rejects_bad_scope() -> None:
    assert LakeScope(2026, 1, "ce").normalized().uf == "CE"
    with pytest.raises(LakeError):
        LakeScope(2026, 0, "CE").normalized()
    with pytest.raises(LakeError):
        LakeScope(2026, 1, "Ceara").normalized()
