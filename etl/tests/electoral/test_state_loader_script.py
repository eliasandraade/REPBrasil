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
        ("prune_archived_electoral_votes.py", "--confirm"),
    ],
)
def test_hybrid_lake_scripts_run_directly_from_scripts_directory(
    script_name: str, expected_option: str
) -> None:
    result = _run_help(script_name)
    assert result.returncode == 0, result.stderr
    assert expected_option in result.stdout
