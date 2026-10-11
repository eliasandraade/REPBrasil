from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest


def _run_help(script_name: str) -> subprocess.CompletedProcess[str]:
    etl_root = Path(__file__).resolve().parents[2]
    script = etl_root / "scripts" / script_name
    return subprocess.run(
        [sys.executable, str(script), "--help"],
        cwd=etl_root,
        capture_output=True,
        text=True,
        check=False,
    )


def test_statewide_loader_runs_directly_from_scripts_directory() -> None:
    result = _run_help("import_electoral_state.py")
    assert result.returncode == 0, result.stderr
    assert "--protect-uf" in result.stdout
    assert "--link-votables" in result.stdout


@pytest.mark.parametrize(
    ("script_name", "expected_option"),
    [
        ("archive_electoral_votes.py", "--verify-only"),
        ("archive_electoral_results.py", "--verify-only"),
        ("snapshot_derived_scope.py", "--year"),
        ("prune_archived_electoral_votes.py", "--dry-run"),
    ],
)
def test_hybrid_lake_scripts_run_directly_from_scripts_directory(
    script_name: str, expected_option: str
) -> None:
    result = _run_help(script_name)
    assert result.returncode == 0, result.stderr
    assert expected_option in result.stdout


def _loader():
    import importlib.util

    script = Path(__file__).resolve().parents[2] / "scripts" / "import_electoral_state.py"
    spec = importlib.util.spec_from_file_location("import_electoral_state", script)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("value", ["ce", " CE ", "Ce"])
def test_uf_is_normalized(value: str) -> None:
    assert _loader()._normalize_uf(value) == "CE"


@pytest.mark.parametrize("value", ["", "C", "CEA", "C1", "../", "ÇE"])
def test_invalid_uf_is_refused(value: str) -> None:
    with pytest.raises(SystemExit, match="invalid UF"):
        _loader()._normalize_uf(value)


def test_manifest_must_match_scope_and_record_the_verified_official_checksum() -> None:
    loader = _loader()
    good = {"scope": {"year": 2024, "turn": 1, "uf": "CE"}, "official_checksum": {"verified": True}}
    loader._validate_manifest(good, year=2024, turn=1, uf="CE")
    with pytest.raises(SystemExit, match="does not match"):
        loader._validate_manifest(good, year=2022, turn=1, uf="CE")
    with pytest.raises(SystemExit, match="verified official TSE checksum"):
        loader._validate_manifest({**good, "official_checksum": {"verified": False}}, year=2024, turn=1, uf="CE")
    with pytest.raises(SystemExit, match="verified official TSE checksum"):
        loader._validate_manifest({"scope": good["scope"]}, year=2024, turn=1, uf="CE")


def test_failure_message_never_carries_connection_credentials() -> None:
    error = RuntimeError("connection to postgresql://repbrasil:s3cret@db.internal:5432/x failed")
    message = _loader()._safe_error(error)
    assert "s3cret" not in message and "postgresql://***@db.internal" in message
