"""Infra compartilhada dos testes eleitorais.

Testes de banco usam `REPBRASIL_ELECTORAL_TEST_DATABASE_URL`, um banco DESCARTÁVEL
cujo nome termina em `_test`, com as migrations EF do REPBrasil aplicadas
(`dotnet ef database update`). Cada teste recria apenas o schema `electoral` a
partir dos MESMOS scripts SQL que a migration `AddElectoralIntelligence` aplica.
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse

import pytest

TEST_DATABASE_URL = os.environ.get("REPBRASIL_ELECTORAL_TEST_DATABASE_URL")
SQL_DIR = (
    Path(__file__).resolve().parents[3]
    / "backend" / "src" / "RepBrasil.Infrastructure" / "Persistence" / "Electoral" / "Sql"
)


def reset_electoral_schema(conn) -> None:
    """Recria o schema `electoral` (somente em banco de teste) e deixa o search_path nele."""
    assert TEST_DATABASE_URL
    if not urlparse(TEST_DATABASE_URL).path.rstrip("/").endswith("_test"):
        pytest.fail("refusing to reset a database whose name does not end with _test")
    conn.execute("DROP SCHEMA IF EXISTS electoral CASCADE; CREATE SCHEMA electoral;")
    conn.execute("SET search_path TO electoral, public")
    for script in sorted(SQL_DIR.glob("*.sql")):
        conn.execute(script.read_text(encoding="utf-8"))
