import os
from collections.abc import Generator
from contextlib import contextmanager

import psycopg2
from psycopg2.extensions import connection as PgConnection


def get_connection_string() -> str:
    return os.environ.get(
        "DATABASE_URL",
        "host=localhost port=5432 dbname=repbrasil user=repbrasil password=repbrasil",
    )


@contextmanager
def get_db() -> Generator[PgConnection, None, None]:
    conn = psycopg2.connect(get_connection_string())
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
