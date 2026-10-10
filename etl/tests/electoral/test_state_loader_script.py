from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def test_statewide_loader_runs_directly_from_scripts_directory() -> None:
    etl_root = Path(__file__).resolve().parents[2]
    script = etl_root / "scripts" / "import_electoral_state.py"
    result = subprocess.run(
        [sys.executable, str(script), "--help"],
        cwd=etl_root,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "--protect-uf" in result.stdout
    assert "--link-votables" in result.stdout
