"""Persistência real em PostgreSQL — opcional, pulado sem banco de teste.

    URNAI_TEST_DATABASE_URL=postgresql://user:pass@localhost:5434/urnai_test pytest

Por segurança, o nome do banco precisa terminar em `_test`: o teste recria o
schema `public` e aplica infra/db/001 + 002.
"""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse

import pytest

psycopg = pytest.importorskip("psycopg")

from urnai_ingest.open_data.results import ConsistencyError  # noqa: E402
from urnai_ingest.open_data.store import import_prepared  # noqa: E402

from test_open_data_pipeline import mutate, prepared  # noqa: E402

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


def counts(c) -> tuple[int, ...]:
    return tuple(
        c.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
        for t in ("open_data_source_file", "section_office_result", "section_office_vote", "votable")
    )


def test_import_is_idempotent_and_versioned(conn, tmp_path):
    first = import_prepared(conn, prepared(tmp_path / "a"))
    assert first["status"] == "succeeded"
    after_first = counts(conn)
    assert after_first == (1, 6, 13, 8)

    again = import_prepared(conn, prepared(tmp_path / "b"))  # mesmo arquivo
    assert again["status"] == "already_imported" and again["import_batch_id"] == first["import_batch_id"]
    assert counts(conn) == after_first  # nenhuma duplicação

    # nova versão do TSE (um voto diferente ⇒ outro ZIP): novo lote, o anterior permanece
    newer = import_prepared(conn, prepared(tmp_path / "c", mutate(';"CANDIDATO FICT\xcdCIO BETA";20;', ';"CANDIDATO FICT\xcdCIO BETA";19;')))
    assert newer["status"] == "succeeded" and newer["import_batch_id"] != first["import_batch_id"]
    assert counts(conn)[:3] == (2, 12, 26)

    # zero confirmado continua zero; ausência continua NULL
    zero = conn.execute(
        "SELECT v.votes FROM section_office_vote v JOIN votable t ON t.id = v.votable_id "
        "JOIN section_office_result r ON r.id = v.result_id WHERE r.section = 4 AND t.vote_kind = 'party_legend' LIMIT 1"
    ).fetchone()[0]
    assert zero == 0
    blank_party = conn.execute("SELECT party_number FROM votable WHERE vote_kind = 'blank'").fetchone()[0]
    assert blank_party is None


def test_failed_import_is_recorded_and_writes_nothing(conn, tmp_path):
    p = prepared(tmp_path / "a")
    # votável já registrado com outro nome ⇒ conflito de identidade
    conn.execute(
        "INSERT INTO votable (election_code, office_code, vote_kind, type_code, type_description, number, name) "
        "VALUES (999001, 1, 'candidate', 1, 'Nominal', 11, 'OUTRO NOME FICTÍCIO')"
    )
    conn.commit()
    with pytest.raises(ConsistencyError, match="different attributes"):
        import_prepared(conn, p)
    assert counts(conn)[1:3] == (0, 0)
    status = conn.execute("SELECT status FROM ingestion_run ORDER BY started_at DESC LIMIT 1").fetchone()[0]
    assert status == "failed"
