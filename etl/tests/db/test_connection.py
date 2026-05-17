from unittest.mock import MagicMock, patch

import pytest

from src.db.connection import get_connection_string, get_db, get_db_batch


def test_get_connection_string_missing_env(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        get_connection_string()


def test_get_connection_string_returns_url(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pw@host/db")
    assert get_connection_string() == "postgresql://user:pw@host/db"


def test_get_db_passes_keepalives(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://test:test@localhost/test")
    mock_conn = MagicMock()
    with patch("psycopg2.connect", return_value=mock_conn) as mock_connect:
        try:
            with get_db():
                pass
        except Exception:
            pass

    kwargs = mock_connect.call_args.kwargs
    assert kwargs.get("keepalives") == 1
    assert kwargs.get("keepalives_idle") == 30
    assert kwargs.get("keepalives_interval") == 5
    assert kwargs.get("keepalives_count") == 5


def test_get_db_commits_on_success(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://test:test@localhost/test")
    mock_conn = MagicMock()
    with patch("psycopg2.connect", return_value=mock_conn):
        with get_db():
            pass
    mock_conn.commit.assert_called_once()
    mock_conn.rollback.assert_not_called()


def test_get_db_rollback_on_exception(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://test:test@localhost/test")
    mock_conn = MagicMock()
    with patch("psycopg2.connect", return_value=mock_conn):
        with pytest.raises(ValueError):
            with get_db():
                raise ValueError("fail")
    mock_conn.rollback.assert_called_once()
    mock_conn.commit.assert_not_called()


def test_get_db_batch_passes_keepalives(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://test:test@localhost/test")
    mock_conn = MagicMock()
    with patch("psycopg2.connect", return_value=mock_conn) as mock_connect:
        try:
            with get_db_batch():
                pass
        except Exception:
            pass

    kwargs = mock_connect.call_args.kwargs
    assert kwargs.get("keepalives") == 1


def test_get_db_batch_does_not_auto_commit(monkeypatch):
    """get_db_batch não commita automaticamente — caller gerencia."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://test:test@localhost/test")
    mock_conn = MagicMock()
    with patch("psycopg2.connect", return_value=mock_conn):
        with get_db_batch():
            pass
    mock_conn.commit.assert_not_called()


def test_get_db_batch_rollback_on_exception(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://test:test@localhost/test")
    mock_conn = MagicMock()
    with patch("psycopg2.connect", return_value=mock_conn):
        with pytest.raises(RuntimeError):
            with get_db_batch():
                raise RuntimeError("batch fail")
    mock_conn.rollback.assert_called_once()
