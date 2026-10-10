from __future__ import annotations

import hashlib
import json
from pathlib import Path

import polars as pl
import pytest

from src.electoral.lake import LakeError, LakeScope, scope_path
from src.electoral.lake_results import (
    RESULT_SCHEMA_VERSION,
    load_result_manifest,
    parquet_result_totals,
    result_manifest_path,
    result_path,
    scan_results,
)


def _fixture(root: Path) -> LakeScope:
    scope = LakeScope(2022, 1, "CE")
    base = scope_path(root, scope)
    base.mkdir(parents=True)
    path = result_path(root, scope)
    frame = pl.DataFrame(
        {
            "result_id": [100, 200],
            "year": [2022, 2022],
            "turn": [1, 1],
            "uf": ["CE", "CE"],
            "election_code": [544, 544],
            "municipality_tse_code": ["13897", "13897"],
            "municipality_name": ["FORTALEZA", "FORTALEZA"],
            "zone": [1, 2],
            "section": [10, 20],
            "office_code": [1, 1],
            "aggregated_sections": [[11, 12], []],
            "polling_place_code": [1234, 5678],
            "eligible": [200, 210],
            "turnout": [160, 170],
            "abstentions": [40, 40],
            "votes_total": [160, 170],
        }
    )
    frame.write_parquet(path, compression="zstd", statistics=True)
    manifest = {
        "schema_version": RESULT_SCHEMA_VERSION,
        "scope": {"year": 2022, "turn": 1, "uf": "CE"},
        "totals": {"rows": 2, "municipalities": 1, "votes": 330},
        "file": {
            "path": str(path.relative_to(root)),
            "rows": 2,
            "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        },
    }
    result_manifest_path(root, scope).write_text(json.dumps(manifest), encoding="utf-8")
    return scope


def test_result_metadata_manifest_and_filters(tmp_path: Path) -> None:
    scope = _fixture(tmp_path)
    assert parquet_result_totals(tmp_path, scope) == {"rows": 2, "municipalities": 1, "votes": 330}
    assert load_result_manifest(tmp_path, scope)["totals"]["votes"] == 330
    rows = (
        scan_results(
            tmp_path,
            scope,
            municipality_tse_code="13897",
            zone=1,
            office_codes=[1],
            result_ids=[100],
        )
        .select("result_id", "section", "aggregated_sections", "polling_place_code")
        .collect()
    )
    assert rows.rows() == [(100, 10, [11, 12], 1234)]


def test_result_metadata_manifest_detects_tamper(tmp_path: Path) -> None:
    scope = _fixture(tmp_path)
    path = result_path(tmp_path, scope)
    path.write_bytes(path.read_bytes() + b"tampered")
    with pytest.raises(LakeError, match="size mismatch"):
        load_result_manifest(tmp_path, scope)
