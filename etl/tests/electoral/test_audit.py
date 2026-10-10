"""Auditoria de uma eleição importada (fonte oficial × banco) — fixtures SINTÉTICOS de BU, cadastro e candidaturas.

BU: município 99999, zona 9, seções 1, 4 e 5; Presidente (8 linhas) e Deputado Federal (5 linhas).
Cadastro 2099/1: zonas (99999, 9), (99998, 9) e (99998, 10); seções principais 1, 4, 5 na zona importada
e 4 seções agregadas na UF. Candidaturas: ALFA, BETA (Presidente), GAMA e DELTA (Deputado Federal); o
nome de urna de DELTA difere entre o BU e o arquivo de candidatos.
Testes de banco: REPBRASIL_ELECTORAL_TEST_DATABASE_URL (banco *_test).
"""
from __future__ import annotations

import pytest

from src.electoral.audit import audit_election, scan_bu_csv, to_markdown

psycopg = pytest.importorskip("psycopg")

from conftest import TEST_DATABASE_URL, reset_electoral_schema  # noqa: E402
from test_cadaster_store import load_cadaster, load_territories  # noqa: E402
from test_candidates import ALFA, BETA, DELTA, GAMA, run_import  # noqa: E402
from test_open_data_pipeline import FIXTURES, prepared  # noqa: E402

from src.electoral.candidates.store import link_votables  # noqa: E402
from src.electoral.open_data.store import import_prepared  # noqa: E402

BU_CSV = FIXTURES / "bweb_1t_XX_fixture.csv"
db = pytest.mark.skipif(not TEST_DATABASE_URL, reason="REPBRASIL_ELECTORAL_TEST_DATABASE_URL not set")


def test_source_scan_counts_rows_votes_by_kind_and_urns():
    totals = scan_bu_csv(BU_CSV)
    assert set(totals) == {("99999", 9, 1), ("99999", 9, 6)}
    assert totals[("99999", 9, 1)] == {"rows": 8, "votes_candidate": 121, "votes_blank": 3, "votes_null": 2, "urns": 3}
    assert totals[("99999", 9, 6)] == {"rows": 5, "votes_candidate": 111, "votes_party_legend": 15, "urns": 3}


@pytest.fixture
def conn(tmp_path):
    assert TEST_DATABASE_URL
    with psycopg.connect(TEST_DATABASE_URL, autocommit=True, options="-c search_path=electoral,public") as c:
        reset_electoral_schema(c)
        c.execute('TRUNCATE "Persons", "Politicians", "Sources" CASCADE')
        load_territories(c)
        load_cadaster(c)
        assert import_prepared(c, prepared(tmp_path / "bu"))["status"] == "succeeded"
        run_import(c, tmp_path / "cand", [ALFA, BETA], [GAMA, DELTA])
        yield c


@db
def test_audit_classifies_divergences_and_only_reads(conn):
    link_votables(conn, year=2099, turn=1, uf="XX")
    before = conn.execute("SELECT count(*), sum(votes) FROM section_office_vote").fetchone()

    report = audit_election(conn, year=2099, turn=1, uf="xx", bu_csv=BU_CSV, candidate_counts={1: 2, 6: 3}, other_election_rows=1)

    assert report["status"] == "ok"
    assert report["cadaster"] == {"zones_expected": 3, "zones_with_bu": 1}
    d = report["divergences"]
    assert d["integrity_error"] == [] and d["ambiguous"] == []
    assert [(x["municipality"], x["zone"]) for x in d["missing"] if x["kind"] == "zone_without_bu"] == [("99998", 9), ("99998", 10)]
    assert {"kind": "candidacies_count", "office": 6, "source": 3, "db": 2} in d["missing"]
    assert {"kind": "aggregated_sections_without_own_urn", "count": 4} in d["expected"]
    assert {"kind": "supplementary_election_rows_skipped", "count": 1} in d["expected"]
    assert d["source_divergence"] == [{"kind": "ballot_name_differs_between_bu_and_candidates", "count": 1}]
    president = report["bu_by_office"]["1"]
    assert (president["source_rows"], president["db_rows"]) == (8, 8)
    assert (president["source_votes_candidate"], president["db_votes_candidate"]) == (121, 121)
    assert report["candidacies_by_office"] == {
        "1": {"db": 2, "linked_to_bu": 2, "source": 2},
        "6": {"db": 2, "linked_to_bu": 1, "source": 3},
    }
    assert report["summary"] == {"expected": 2, "ambiguous": 0, "source_divergence": 1, "missing": 3, "integrity_error": 0}
    assert conn.execute("SELECT count(*), sum(votes) FROM section_office_vote").fetchone() == before

    assert report["links_by_method"] == {"contest_number": 3}  # DELTA: nome divergente, sem vínculo

    md = to_markdown(report)
    assert "Status: **ok**" in md
    assert "Vínculos votável → candidatura gravados: contest_number 3 (total 3)" in md
    # ausência de um tipo de voto aparece como "—" dos dois lados, nunca como zero
    assert "| 1 | 3 / 3 | 8 / 8 | 121 / 121 | — / — | 3 / 3 | 2 / 2 |" in md
    assert "| 6 | 3 / 2 | 1 |" in md  # candidaturas: fonte / banco | com vínculo ao BU


@db
def test_a_vote_changed_in_the_database_is_an_integrity_error(conn):
    link_votables(conn, year=2099, turn=1, uf="XX")
    conn.execute("UPDATE section_office_vote SET votes = votes + 1 WHERE id = (SELECT min(id) FROM section_office_vote)")
    report = audit_election(conn, year=2099, turn=1, uf="XX", bu_csv=BU_CSV)
    assert report["status"] == "integrity_error"
    (error,) = report["divergences"]["integrity_error"]
    assert error["kind"] == "source_db_mismatch"
    ((kind, (source, stored)),) = error["diff"].items()
    assert kind.startswith("votes_") and stored == source + 1


@db
def test_audit_without_link_run_or_source_file_reports_what_is_missing(conn):
    report = audit_election(conn, year=2099, turn=1, uf="XX", bu_csv=None)
    assert {"kind": "votable_link_not_run"} in report["divergences"]["missing"]
    assert "source_rows" not in report["bu_by_office"]["1"] and report["bu_by_office"]["1"]["db_rows"] == 8
    assert "| 1 | — / 3 | — / 8 |" in to_markdown(report)
