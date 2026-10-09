"""Cadastro eleitoral em PostgreSQL — opcional, pulado sem banco de teste.

    URNAI_TEST_DATABASE_URL=postgresql://user:pass@localhost:5434/urnai_test pytest

O nome do banco precisa terminar em `_test`: o teste recria o schema `public` e
aplica infra/db/001 + 002 + 003.
"""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse

import pytest

psycopg = pytest.importorskip("psycopg")

from urnai_ingest.cadaster.errors import CadasterConflict, CadasterMissing, TerritoryMissing  # noqa: E402
from urnai_ingest.cadaster.polling_places import detect_layout, parse_cadaster  # noqa: E402
from urnai_ingest.cadaster.store import import_cadaster, import_territories, load_zone_snapshot, municipality_zones  # noqa: E402
from urnai_ingest.cadaster.territories import COLUMNS, PROFILE_ID, parse_territories  # noqa: E402
from urnai_ingest.open_data.layout import detect_csv_layout  # noqa: E402
from urnai_ingest.open_data.pipeline import prepare_import  # noqa: E402
from urnai_ingest.open_data.store import import_prepared  # noqa: E402

from test_cadaster import POLLING, POLLING_TEXT, TERRITORIES, write  # noqa: E402
from test_open_data_pipeline import acquired  # noqa: E402

URL = os.environ.get("URNAI_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="URNAI_TEST_DATABASE_URL not set")
SQL_DIR = Path(__file__).resolve().parents[3] / "infra" / "db"


@pytest.fixture
def conn():
    assert URL
    if not urlparse(URL).path.rstrip("/").endswith("_test"):
        pytest.fail("refusing to reset a database whose name does not end with _test")
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
        for name in ("001_init.sql", "002_open_data_results.sql", "003_electoral_cadaster.sql"):
            c.execute((SQL_DIR / name).read_text(encoding="utf-8"))
        c.autocommit = False
        yield c


def manifest(kind: str, sha: str) -> dict:
    return {
        "kind": kind,
        "source": {"portal": "https://dadosabertos.tse.jus.br", "dataset": "fixture-2099", "dataset_id": "pkg", "resource_id": f"r-{sha[:4]}",
                   "resource_name": "Fixture", "url": f"https://cdn.tse.jus.br/fixture/{sha}.zip", "metadata_modified": None},
        "downloaded_at": "2099-01-03T00:00:00+00:00",
        "zip": {"name": f"{sha}.zip", "size": 1, "sha256": sha * 64 if len(sha) == 1 else sha, "sha512": "0" * 128},
        "official_checksum": {"status": "not_published"},
    }


def member(path: Path) -> dict:
    return {"name": path.name, "sha256": "f" * 64, "size": path.stat().st_size, "path": path}


def load_territories(conn) -> dict:
    return import_territories(conn, parse_territories(TERRITORIES), manifest("tse-open-data-municipality-codes", "a"),
                              member(TERRITORIES), detect_csv_layout(TERRITORIES, columns=COLUMNS, profile_id=PROFILE_ID))


def load_cadaster(conn, path: Path = POLLING, sha: str = "b", **kw) -> dict:
    return import_cadaster(conn, parse_cadaster(path, year=2099, turn=1, uf="XX"), manifest("tse-open-data-polling-places", sha),
                           member(path), detect_layout(path), **kw)


def test_territories_then_cadaster_are_idempotent_and_auditable(conn):
    assert load_territories(conn)["municipalities_inserted"] == 3
    assert load_territories(conn)["status"] == "already_imported"

    first = load_cadaster(conn)
    assert first["status"] == "succeeded" and first["municipalities"] == {"inserted": 2, "unchanged": 0, "superseded": 0}
    assert load_cadaster(conn)["status"] == "already_imported"
    # mesmo conteúdo em outro arquivo oficial: nada muda
    again = load_cadaster(conn, sha="c")
    assert again["municipalities"] == {"inserted": 0, "unchanged": 2, "superseded": 0}

    rows = conn.execute(
        """SELECT s.section_number, s.is_aggregated, s.principal_section_number, s.eligible_federal, s.eligible_state,
                  f.kind, f.checksum_status
             FROM electoral_section s JOIN open_data_source_file f ON f.id = s.source_file_id
             JOIN municipality m ON m.id = s.municipality_id WHERE m.tse_code = '99999' ORDER BY 1"""
    ).fetchall()
    assert rows[0] == (1, False, 1, 70, 70, "tse-open-data-polling-places", "not_published")
    assert rows[1][:5] == (2, True, 1, None, None)  # agregada: NULL, nunca 0
    geo = conn.execute("SELECT tse_location_code, ST_Y(geom), coordinates_source FROM polling_place ORDER BY 1").fetchall()
    assert geo[0] == ("9001", -4.0000001, "tse-open-data:eleitorado-local-votacao")
    assert geo[1][1:] == (None, None)  # sem coordenada oficial ⇒ NULL


def test_zones_and_snapshot_come_from_the_canonical_cadaster(conn, tmp_path):
    load_territories(conn)
    load_cadaster(conn)
    assert municipality_zones(conn, year=2099, turn=1, uf="XX", municipality=99999) == [9]
    assert municipality_zones(conn, year=2099, turn=1, uf="XX", municipality=99998) == [9, 10]
    snap = load_zone_snapshot(conn, year=2099, turn=1, uf="XX", municipality=99999, zone=9)
    assert {s["number"]: s["aggregated_sections"] for s in snap["sections"] if not s["is_aggregated"]} == {1: [2, 3], 4: [], 5: [6]}
    with pytest.raises(CadasterMissing):
        municipality_zones(conn, year=2099, turn=1, uf="XX", municipality=99997)  # território sem cadastro
    with pytest.raises(TerritoryMissing):
        municipality_zones(conn, year=2099, turn=1, uf="XX", municipality=12345)

    # resultado do BU reconciliado contra o cadastro do banco, não contra um JSON especial
    bu = prepare_import(acquired(tmp_path).manifest_path, municipality=99999, zone=9, cadastro=snap)
    assert import_prepared(conn, bu)["status"] == "succeeded"


def test_new_file_that_diverges_needs_supersede_and_never_deletes(conn, tmp_path):
    load_territories(conn)
    load_cadaster(conn)
    changed = write(tmp_path, POLLING_TEXT.replace('"40";"40";"39"', '"40";"41";"39"'))
    with pytest.raises(CadasterConflict) as err:
        load_cadaster(conn, changed, sha="d")
    assert err.value.diff["99999"]["sections"]["changed"][0]["changes"] == {"eligible_federal": [40, 41]}
    assert conn.execute("SELECT eligible_federal FROM electoral_section WHERE section_number=4").fetchone()[0] == 40
    assert conn.execute("SELECT status FROM ingestion_run ORDER BY started_at DESC LIMIT 1").fetchone()[0] == "failed"

    applied = load_cadaster(conn, changed, sha="d", supersede=True)
    assert applied["municipalities"]["superseded"] == 1 and "99999" in applied["diff"]
    assert conn.execute("SELECT eligible_federal FROM electoral_section WHERE section_number=4").fetchone()[0] == 41

    lines = POLLING_TEXT.split("\r\n")
    removed = write(tmp_path, "\r\n".join(l for l in lines if ';"31";' not in l), "r.csv")
    with pytest.raises(CadasterConflict, match="disappeared"):
        load_cadaster(conn, removed, sha="e", supersede=True)


def test_cadaster_requires_the_territory_registry(conn):
    with pytest.raises(TerritoryMissing):
        load_cadaster(conn)


def test_cli_import_is_persisted_for_every_zone(conn, tmp_path, capsys):
    """Regressão: a importação pela CLI precisa ser confirmada, não só reportada."""
    import json

    from urnai_ingest.cli import main

    load_territories(conn)
    load_cadaster(conn)
    conn.commit()
    bu = acquired(tmp_path)
    assert main(["import-open-data-bu", str(bu.directory), "--municipality", "99999", "--database-url", URL]) == 0
    reports = json.loads(capsys.readouterr().out)
    assert [r["status"] for r in reports] == ["succeeded"]
    with psycopg.connect(URL) as other:  # outra conexão: só vê o que foi confirmado
        assert other.execute("SELECT count(*) FROM ingestion_run WHERE source='tse-open-data-bu' AND status='succeeded'").fetchone()[0] == 1
        assert other.execute("SELECT count(*) FROM section_office_result").fetchone()[0] > 0
    assert main(["import-open-data-bu", str(bu.directory), "--municipality", "99999", "--database-url", URL]) == 0
    assert [r["status"] for r in json.loads(capsys.readouterr().out)] == ["already_imported"]
