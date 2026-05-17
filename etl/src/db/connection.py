import os
from collections.abc import Generator
from contextlib import contextmanager

import psycopg2
from psycopg2.extensions import connection as PgConnection

# Parâmetros TCP keepalive para prevenir SSL timeout do Railway (dropa conexões idle ~5-6 min).
# keepalives=1 ativa; idle=30s antes do primeiro probe; interval=5s entre probes; count=5 falhas.
_KEEPALIVE_KWARGS: dict = {
    "keepalives": 1,
    "keepalives_idle": 30,
    "keepalives_interval": 5,
    "keepalives_count": 5,
}


def get_connection_string() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL environment variable is not set. "
            "Example: host=localhost port=5432 dbname=repbrasil user=repbrasil password=repbrasil"
        )
    return url


@contextmanager
def get_db() -> Generator[PgConnection, None, None]:
    """Conexão padrão para operações curtas. Commit automático no exit, rollback em exceção."""
    conn = psycopg2.connect(get_connection_string(), **_KEEPALIVE_KWARGS)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@contextmanager
def get_db_batch() -> Generator[PgConnection, None, None]:
    """Conexão para operações longas com batch commits. O chamador gerencia commits explicitamente.
    Keepalives ativados para sobreviver ao SSL timeout do Railway em loads de >5 minutos.
    Em exceção: rollback automático dos dados não-commitados da transação atual.
    """
    conn = psycopg2.connect(get_connection_string(), **_KEEPALIVE_KWARGS)
    try:
        yield conn
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
