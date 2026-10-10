"""Grafia oficial (IBGE) dos nomes de UF e município: só a grafia muda, nunca o nome nem o código.

Testes de banco: REPBRASIL_ELECTORAL_TEST_DATABASE_URL (banco *_test). Sem rede: a lista oficial é fixture.
"""

from __future__ import annotations

import pytest

from src.electoral.official_names import OfficialName, plan, sync_official_names

psycopg = pytest.importorskip("psycopg")

from conftest import TEST_DATABASE_URL, reset_electoral_schema  # noqa: E402
from test_cadaster_store import load_territories  # noqa: E402

db = pytest.mark.skipif(not TEST_DATABASE_URL, reason="REPBRASIL_ELECTORAL_TEST_DATABASE_URL not set")


def test_plan_fixes_spelling_only_when_it_is_the_same_name():
    official = [OfficialName(1, "Juazeiro do Norte"), OfficialName(2, "Herval d'Oeste"), OfficialName(3, "Embu das Artes")]
    stored = [(("CE", "14478"), 1, "Juazeiro Do Norte"), (("SC", "1"), 2, "Herval D'Oeste"), (("SP", "2"), 3, "Embu"),
              (("XX", "9"), None, "Sem Código")]
    p = plan(official, stored)
    assert [(u["from"], u["to"]) for u in p["updates"]] == [("Juazeiro Do Norte", "Juazeiro do Norte"), ("Herval D'Oeste", "Herval d'Oeste")]
    assert p["differences"] == [{"key": ("SP", "2"), "ibge_code": 3, "registry": "Embu", "ibge": "Embu das Artes"}]  # nome diferente: só reporta
    assert [m["name"] for m in p["not_in_ibge"]] == ["Sem Código"]


@pytest.fixture
def conn():
    assert TEST_DATABASE_URL
    with psycopg.connect(TEST_DATABASE_URL, autocommit=True, options="-c search_path=electoral,public") as c:
        reset_electoral_schema(c)
        load_territories(c)
        yield c


@db
def test_sync_updates_spelling_keeps_codes_and_slugs_and_is_idempotent(conn):
    before = dict(conn.execute("SELECT tse_code, slug FROM municipality").fetchall())
    municipalities = [OfficialName(9900001, "MUNICÍPIO fictício"), OfficialName(9900002, "Vila Nova")]
    states = [OfficialName(99, "Estado fictício")]

    preview = sync_official_names(conn, municipalities, states, dry_run=True)
    assert (preview["status"], preview["municipalities_updated"]) == ("dry_run", 1)
    assert conn.execute("SELECT name FROM municipality WHERE tse_code = '99999'").fetchone() == ("Município Fictício",)

    report = sync_official_names(conn, municipalities, states)
    assert (report["municipalities_updated"], report["states_updated"]) == (1, 1)
    assert [d["ibge"] for d in report["name_differences"]] == ["Vila Nova"]  # outro nome: não muda
    names = dict(conn.execute("SELECT tse_code, name FROM municipality").fetchall())
    assert (names["99999"], names["99998"]) == ("MUNICÍPIO fictício", "Vila Fictícia")
    assert conn.execute("SELECT name FROM state WHERE code = 'XX'").fetchone() == ("Estado fictício",)
    assert dict(conn.execute("SELECT tse_code, slug FROM municipality").fetchall()) == before  # URLs estáveis
    assert conn.execute("SELECT count(*) FROM ingestion_run WHERE source = 'ibge-official-names'").fetchone() == (1,)

    again = sync_official_names(conn, municipalities, states)
    assert (again["municipalities_updated"], again["states_updated"]) == (0, 0)
