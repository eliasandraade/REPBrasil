from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path

import pytest

from urnai_ingest.open_data.layout import COLUMNS, detect_layout
from urnai_ingest.open_data.results import ConsistencyError
from urnai_ingest.open_data.state_sync import ZoneScope, iter_zone_groups, preflight_state, sync_state_results

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "open-data"
SOURCE = FIXTURES / "bweb_1t_XX_fixture.csv"
CADASTRO = json.loads((FIXTURES / "cadastro-ficticio.json").read_text(encoding="utf-8"))


def _rows() -> tuple[list[str], list[list[str]]]:
    with SOURCE.open("r", encoding="latin-1", newline="") as fh:
        reader = csv.reader(fh, delimiter=";", quotechar='"')
        return next(reader), list(reader)


def _write(path: Path, rows: list[list[str]]) -> None:
    header, _ = _rows()
    with path.open("w", encoding="latin-1", newline="") as fh:
        writer = csv.writer(fh, delimiter=";", quotechar='"', quoting=csv.QUOTE_ALL, lineterminator="\r\n")
        writer.writerow(header)
        writer.writerows(rows)


def _other_scope(rows: list[list[str]]) -> list[list[str]]:
    i = {c: n for n, c in enumerate(COLUMNS)}
    out = []
    for source in rows:
        row = list(source)
        row[i["CD_MUNICIPIO"]] = "88888"
        row[i["NM_MUNICIPIO"]] = "OUTRO MUNICIPIO FICTICIO"
        row[i["NR_ZONA"]] = "10"
        out.append(row)
    return out


def _manifest(directory: Path, csv_path: Path) -> Path:
    extracted = directory / "extracted"
    extracted.mkdir(parents=True)
    target = extracted / csv_path.name
    target.write_bytes(csv_path.read_bytes())
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    manifest = {
        "kind": "tse-open-data-bu",
        "source": {
            "portal": "https://dadosabertos.tse.jus.br",
            "dataset": "resultados-2099-boletim-de-urna",
            "dataset_id": "fixture",
            "resource_id": "fixture-xx",
            "resource_name": "XX - Boletim de Urna - Primeiro turno - 01.01.2099",
            "url": "https://cdn.tse.jus.br/fixture.zip",
            "metadata_modified": "2099-01-01T00:00:00",
        },
        "scope": {"year": 2099, "turn": 1, "uf": "XX"},
        "downloaded_at": "2099-01-02T00:00:00+00:00",
        "zip": {"name": "fixture.zip", "size": 1, "sha256": "a" * 64, "sha512": "b" * 128},
        "official_checksum": {"algorithm": "sha512", "value": "b" * 128, "url": "https://cdn.tse.jus.br/fixture.sha512", "verified": True},
        "csv": {"name": target.name, "size": target.stat().st_size, "sha256": digest},
    }
    path = directory / "manifest.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    return path


def test_preflight_and_group_iterator_cover_multiple_contiguous_scopes(tmp_path):
    _, original = _rows()
    path = tmp_path / "multi.csv"
    _write(path, original + _other_scope(original))
    layout = detect_layout(path)

    plan = preflight_state(path, layout, year=2099, turn=1, uf="XX")
    assert plan.rows == len(original) * 2
    assert [(p.scope, p.rows) for p in plan.scopes] == [
        (ZoneScope(99999, 9), len(original)),
        (ZoneScope(88888, 10), len(original)),
    ]

    groups = list(iter_zone_groups(path, layout, year=2099, turn=1, uf="XX"))
    assert [(scope, len(rows)) for scope, rows in groups] == [
        (ZoneScope(99999, 9), len(original)),
        (ZoneScope(88888, 10), len(original)),
    ]
    assert groups[0][1][0].municipality_code == 99999
    assert groups[1][1][0].municipality_code == 88888


def _interleave(a: list[list[str]], b: list[list[str]]) -> list[list[str]]:
    """Como no arquivo oficial do TSE (CE 2026): linhas de escopos diferentes alternadas."""
    out: list[list[str]] = []
    for i in range(max(len(a), len(b))):
        out += ([a[i]] if i < len(a) else []) + ([b[i]] if i < len(b) else [])
    return out


def test_preflight_accepts_interleaved_scopes_like_the_official_file(tmp_path):
    """Regressão: o CSV oficial do CE não vem agrupado por município × zona (2,38 mi blocos
    em 2,75 mi linhas). A ordem das linhas não tem semântica; o preflight não pode exigir contiguidade."""
    _, original = _rows()
    path = tmp_path / "interleaved.csv"
    _write(path, _interleave(original, _other_scope(original)))
    plan = preflight_state(path, detect_layout(path), year=2099, turn=1, uf="XX")
    assert plan.rows == len(original) * 2
    assert [(p.scope, p.rows) for p in plan.scopes] == [  # ordem de primeira aparição
        (ZoneScope(99999, 9), len(original)),
        (ZoneScope(88888, 10), len(original)),
    ]


@pytest.mark.parametrize("buffer_rows", [1, 3, 10_000])
def test_interleaved_groups_equal_contiguous_groups(tmp_path, buffer_rows):
    """Mesmas linhas, mesmos números de linha de origem, mesmo resultado normalizado — com o
    buffer em disco esvaziado várias vezes (memória limitada)."""
    from urnai_ingest.open_data.pipeline import fingerprint
    from urnai_ingest.open_data.results import normalize_zone

    _, original = _rows()
    other = _other_scope(original)
    contiguous, interleaved = tmp_path / "c.csv", tmp_path / "i.csv"
    _write(contiguous, original + other)
    _write(interleaved, _interleave(original, other))

    def collect(path: Path):
        layout = detect_layout(path)
        plan = preflight_state(path, layout, year=2099, turn=1, uf="XX")
        expected = {p.scope: p.rows for p in plan.scopes}
        return {
            scope: rows
            for scope, rows in iter_zone_groups(path, layout, year=2099, turn=1, uf="XX", expected_rows=expected, buffer_rows=buffer_rows)
        }

    a, b = collect(contiguous), collect(interleaved)
    assert list(a) == list(b) == [ZoneScope(99999, 9), ZoneScope(88888, 10)]
    for scope in a:
        assert [r.source_row_hash for r in a[scope]] == [r.source_row_hash for r in b[scope]]
        scope_dict = {"year": 2099, "turn": 1, "uf": "XX", "municipality": scope.municipality_code, "zone": scope.zone}
        fa = fingerprint(scope_dict, normalize_zone(a[scope], municipality=scope.municipality, zone=scope.zone))
        fb = fingerprint(scope_dict, normalize_zone(b[scope], municipality=scope.municipality, zone=scope.zone))
        assert fa == fb
    # a linha de origem acompanha a linha (proveniência), mesmo fora de ordem
    first_other = next(r for r in b[ZoneScope(88888, 10)])
    assert first_other.line == 3  # 2ª linha de dados do arquivo intercalado


def test_group_count_must_match_preflight(tmp_path):
    _, original = _rows()
    path = tmp_path / "x.csv"
    _write(path, original)
    layout = detect_layout(path)
    with pytest.raises(ConsistencyError, match="preflight counted"):
        list(iter_zone_groups(path, layout, year=2099, turn=1, uf="XX", expected_rows={ZoneScope(99999, 9): len(original) + 1}))


def test_preflight_rejects_wrong_resource_scope_before_import(tmp_path):
    _, original = _rows()
    path = tmp_path / "wrong.csv"
    _write(path, original)
    with pytest.raises(ConsistencyError, match="year/turn"):
        preflight_state(path, detect_layout(path), year=2098, turn=1, uf="XX")
    with pytest.raises(ConsistencyError, match="SG_UF"):
        preflight_state(path, detect_layout(path), year=2099, turn=1, uf="YY")


def test_state_sync_reuses_normalization_reconciliation_and_idempotent_store(tmp_path, monkeypatch):
    manifest = _manifest(tmp_path / "artifact", SOURCE)
    scope = ZoneScope(99999, 9)

    import urnai_ingest.open_data.state_sync as module

    monkeypatch.setattr(module, "_expected_scopes", lambda *args, **kwargs: {scope})
    monkeypatch.setattr(module, "load_zone_snapshot", lambda *args, **kwargs: CADASTRO)

    seen = []

    def fake_import(_conn, prepared):
        seen.append(prepared)
        return prepared.report(batch_id="fixture-batch", status="already_imported")

    monkeypatch.setattr(module, "import_prepared", fake_import)
    report = sync_state_results(object(), manifest, verify_csv_hash=True)  # type: ignore[arg-type]

    assert len(seen) == 1
    assert seen[0].scope["municipality"] == "99999" and seen[0].scope["zone"] == 9
    assert report["status"] == "succeeded"
    assert report["preflight"] == {"rows": 13, "municipalities": 1, "zones": 1, "cadaster_coverage": "exact"}
    assert report["import"]["zone_statuses"] == {"already_imported": 1}
    assert report["import"]["vote_records"] == 13


def test_state_sync_refuses_bu_cadaster_scope_drift_before_writes(tmp_path, monkeypatch):
    manifest = _manifest(tmp_path / "artifact", SOURCE)
    import urnai_ingest.open_data.state_sync as module

    monkeypatch.setattr(module, "_expected_scopes", lambda *args, **kwargs: {ZoneScope(99999, 9), ZoneScope(99999, 10)})
    called = False

    def fake_import(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("must not write")

    monkeypatch.setattr(module, "import_prepared", fake_import)
    with pytest.raises(ConsistencyError, match="coverage differs"):
        sync_state_results(object(), manifest)  # type: ignore[arg-type]
    assert called is False
