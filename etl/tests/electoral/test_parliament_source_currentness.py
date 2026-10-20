from __future__ import annotations

from datetime import UTC, datetime

import pytest

from src.pipeline.parliament import ParliamentSource, ensure_source

psycopg = pytest.importorskip("psycopg")

from conftest import TEST_DATABASE_URL, reset_electoral_schema  # noqa: E402, I001


db = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="REPBRASIL_ELECTORAL_TEST_DATABASE_URL not set",
)


@pytest.fixture
def conn():
    assert TEST_DATABASE_URL
    with psycopg.connect(
        TEST_DATABASE_URL,
        autocommit=True,
        options="-c search_path=electoral,public",
    ) as connection:
        reset_electoral_schema(connection)
        yield connection


@db
def test_identical_bytes_seen_again_become_the_current_edition(conn) -> None:
    first_id = ensure_source(
        conn,
        ParliamentSource(
            provider="transparencia",
            dataset="emendas-parlamentares:CE",
            source_url="https://example.test/first.zip",
            content=b"first-edition",
            metadata={"edition": "first"},
        ),
    )
    conn.execute(
        "UPDATE parliament_source SET retrieved_at = %s WHERE id = %s",
        (datetime(2026, 1, 1, tzinfo=UTC), first_id),
    )

    second_id = ensure_source(
        conn,
        ParliamentSource(
            provider="transparencia",
            dataset="emendas-parlamentares:CE",
            source_url="https://example.test/second.zip",
            content=b"second-edition",
            metadata={"edition": "second"},
        ),
    )
    conn.execute(
        "UPDATE parliament_source SET retrieved_at = %s WHERE id = %s",
        (datetime(2026, 2, 1, tzinfo=UTC), second_id),
    )

    same_first_id = ensure_source(
        conn,
        ParliamentSource(
            provider="transparencia",
            dataset="emendas-parlamentares:CE",
            source_url="https://example.test/first-returned.zip",
            content=b"first-edition",
            metadata={"edition": "first-returned"},
        ),
    )

    assert same_first_id == first_id
    assert conn.execute(
        "SELECT count(*) FROM parliament_source WHERE dataset = 'emendas-parlamentares:CE'"
    ).fetchone()[0] == 2

    current = conn.execute(
        """
        SELECT id, source_url, metadata
        FROM parliament_source
        WHERE provider = 'transparencia' AND dataset = 'emendas-parlamentares:CE'
        ORDER BY retrieved_at DESC, id DESC
        LIMIT 1
        """
    ).fetchone()
    assert current[0] == first_id
    assert current[1] == "https://example.test/first-returned.zip"
    assert current[2]["edition"] == "first-returned"
