from __future__ import annotations

import json

import pytest

from src.electoral.open_data.state_import import (
    StateImportError,
    _validate_manifest_scope,
    _write_json,
)


def manifest(*, year: int = 2026, turn: int = 1, uf: str = "PI", verified: bool = True):
    return {
        "scope": {"year": year, "turn": turn, "uf": uf},
        "official_checksum": {"verified": verified},
    }


def test_validate_manifest_scope_normalizes_uf():
    assert _validate_manifest_scope(manifest(uf="pi"), year=2026, turn=1, uf="PI") == "PI"


@pytest.mark.parametrize(
    ("source", "requested"),
    [
        (manifest(year=2024), (2026, 1, "PI")),
        (manifest(turn=2), (2026, 1, "PI")),
        (manifest(uf="CE"), (2026, 1, "PI")),
    ],
)
def test_validate_manifest_scope_rejects_cross_scope_artifacts(source, requested):
    with pytest.raises(StateImportError, match="differs from requested scope"):
        _validate_manifest_scope(source, year=requested[0], turn=requested[1], uf=requested[2])


def test_validate_manifest_scope_requires_official_checksum():
    with pytest.raises(StateImportError, match="verified official checksum"):
        _validate_manifest_scope(manifest(verified=False), year=2026, turn=1, uf="PI")


def test_write_json_replaces_progress_atomically(tmp_path):
    target = tmp_path / "progress" / "state.json"
    _write_json(target, {"processed": 1})
    _write_json(target, {"processed": 2, "status": "running"})

    assert json.loads(target.read_text(encoding="utf-8")) == {"processed": 2, "status": "running"}
    assert not list(target.parent.glob(".*.tmp"))
