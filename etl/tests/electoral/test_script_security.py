from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

ETL_ROOT = Path(__file__).resolve().parents[2]


def _load_script(name: str):
    path = ETL_ROOT / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"repbrasil_test_{name}", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_import_output_is_fixed_inside_configured_root(tmp_path: Path) -> None:
    module = _load_script("import_electoral_state")
    root = tmp_path / "state"
    root.mkdir()

    enabled = module._output_requested(root / "progress.json", output_root=root, filename="progress.json")
    assert enabled is True
    module._write_progress(enabled, {"status": "ok"}, output_root=root)
    assert (root / "progress.json").is_file()

    with pytest.raises(SystemExit, match="must resolve exactly"):
        module._output_requested(Path("nested/progress.json"), output_root=root, filename="progress.json")

    with pytest.raises(SystemExit, match="must resolve exactly"):
        module._output_requested(tmp_path / "outside.json", output_root=root, filename="progress.json")


def test_lake_worker_requires_token_and_private_transport(monkeypatch: pytest.MonkeyPatch) -> None:
    module = _load_script("electoral_lake_worker")

    monkeypatch.delenv("REPBRASIL_LAKE_TOKEN", raising=False)
    with pytest.raises(SystemExit, match="REPBRASIL_LAKE_TOKEN is required"):
        module._required_token()

    monkeypatch.setenv("REPBRASIL_LAKE_TOKEN", "test-token")
    assert module._required_token() == "test-token"

    monkeypatch.delenv("RAILWAY_PRIVATE_DOMAIN", raising=False)
    monkeypatch.delenv("RAILWAY_PUBLIC_DOMAIN", raising=False)
    monkeypatch.delenv("REPBRASIL_LAKE_LOCAL_ONLY", raising=False)
    with pytest.raises(SystemExit, match="requires Railway private networking"):
        module._private_bind_host()

    monkeypatch.setenv("RAILWAY_PRIVATE_DOMAIN", "electoral-lake.railway.internal")
    assert module._private_bind_host() == "0.0.0.0"

    monkeypatch.setenv("RAILWAY_PUBLIC_DOMAIN", "example.up.railway.app")
    with pytest.raises(SystemExit, match="requires Railway private networking"):
        module._private_bind_host()


def test_prune_rejects_empty_derived_snapshot() -> None:
    module = _load_script("prune_archived_electoral_votes")

    class Cursor:
        def __init__(self) -> None:
            self._rows = iter(
                [
                    (1, 10, 0, 0),
                    (1, 10),
                    (0, 0),
                ]
            )

        def execute(self, *_args, **_kwargs) -> None:
            return None

        def fetchone(self):
            return next(self._rows)

    scope = module.LakeScope(2022, 1, "CE")
    cursor = Cursor()
    with pytest.raises(SystemExit, match="derived snapshot is empty"):
        module._derived_snapshot(cursor, scope)
