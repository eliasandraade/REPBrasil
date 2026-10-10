from __future__ import annotations

import pytest

psycopg = pytest.importorskip("psycopg")

from conftest import TEST_DATABASE_URL, reset_electoral_schema  # noqa: E402

pytestmark = pytest.mark.skipif(
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
    ) as c:
        reset_electoral_schema(c)
        yield c


def test_hybrid_schema_preserves_current_materialized_views(conn):
    relations = dict(
        conn.execute(
            """
            SELECT n.nspname || '.' || c.relname, c.relkind
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE (n.nspname, c.relname) IN (
               ('electoral', 'votable_zone_votes_current'),
               ('electoral', 'zone_office_totals_current'),
               ('electoral_archive', 'votable_zone_votes'),
               ('electoral_archive', 'zone_office_totals'),
               ('electoral_archive', 'derived_archive_scope')
             )
            """
        )
    )
    assert relations == {
        "electoral.votable_zone_votes_current": "m",
        "electoral.zone_office_totals_current": "m",
        "electoral_archive.votable_zone_votes": "r",
        "electoral_archive.zone_office_totals": "r",
        "electoral_archive.derived_archive_scope": "r",
    }


def test_refresh_serves_marked_scope_from_persistent_snapshots(conn):
    conn.execute(
        """
        INSERT INTO electoral_archive.votable_zone_votes
            (year, turn, uf, municipality_tse_code, zone, office_code,
             votable_id, votes, urns_with_votes)
        VALUES (2099, 1, 'XX', '99999', 9, 6, 42, 160, 2)
        """
    )
    conn.execute(
        """
        INSERT INTO electoral_archive.zone_office_totals
            (year, turn, uf, municipality_tse_code, municipality_name, zone,
             office_code, urns, eligible, turnout, abstentions, nominal_votes,
             legend_votes, blank_votes, null_votes, votes_total)
        VALUES
            (2099, 1, 'XX', '99999', 'MUNICÍPIO TESTE', 9, 6,
             2, 200, 160, 40, 123, 7, 10, 20, 160)
        """
    )

    assert conn.execute(
        "SELECT count(*) FROM votable_zone_votes_current WHERE year=2099 AND turn=1 AND uf='XX'"
    ).fetchone()[0] == 0

    conn.execute(
        """
        INSERT INTO electoral_archive.derived_archive_scope
            (year, turn, uf, votable_rows, votable_votes, zone_rows, zone_votes)
        VALUES (2099, 1, 'XX', 1, 160, 1, 160)
        """
    )
    conn.execute("REFRESH MATERIALIZED VIEW votable_zone_votes_current")
    conn.execute("REFRESH MATERIALIZED VIEW zone_office_totals_current")

    assert conn.execute(
        """
        SELECT municipality_tse_code, zone, office_code, votable_id, votes, urns_with_votes
          FROM votable_zone_votes_current
         WHERE year=2099 AND turn=1 AND uf='XX'
        """
    ).fetchone() == ("99999", 9, 6, 42, 160, 2)

    assert conn.execute(
        """
        SELECT municipality_name, urns, nominal_votes, votes_total
          FROM zone_office_totals_current
         WHERE year=2099 AND turn=1 AND uf='XX'
        """
    ).fetchone() == ("MUNICÍPIO TESTE", 2, 123, 160)
