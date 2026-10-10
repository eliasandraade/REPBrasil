from __future__ import annotations

import json

import pytest

from src.electoral.open_data.state_import import (
    StateImportError,
    _artifact_manifest,
    _normalize_uf,
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


def test_normalize_uf_rejects_path_like_values():
    with pytest.raises(StateImportError, match="invalid UF"):
        _normalize_uf("../PI")


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


def test_artifact_manifest_accepts_only_content_addressed_directory(tmp_path):
    digest = "a" * 64
    target = tmp_path / digest / "manifest.json"
    target.parent.mkdir()
    target.write_text("{}", encoding="utf-8")

    assert _artifact_manifest(tmp_path, digest) == target.resolve()


@pytest.mark.parametrize("value", ["../manifest.json", "a" * 63, "g" * 64, "/tmp/manifest.json"])
def test_artifact_manifest_rejects_untrusted_paths(tmp_path, value):
    with pytest.raises(StateImportError, match="SHA-256"):
        _artifact_manifest(tmp_path, value)


def test_write_json_replaces_progress_atomically(tmp_path):
    target = tmp_path / "progress" / "state.json"
    _write_json(target, {"processed": 1})
    _write_json(target, {"processed": 2, "status": "running"})

    assert json.loads(target.read_text(encoding="utf-8")) == {"processed": 2, "status": "running"}
    assert not list(target.parent.glob(".*.tmp"))
