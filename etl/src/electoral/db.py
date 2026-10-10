"""Conexão com o schema `electoral` do PostgreSQL/PostGIS do REPBrasil.

As tabelas eleitorais detalhadas (território, cadastro, Boletim de Urna,
candidaturas) vivem no schema `electoral`, criado pela migration EF
`AddElectoralIntelligence` a partir dos arquivos em
`backend/src/RepBrasil.Infrastructure/Persistence/Electoral/Sql/`.

O SQL do pipeline usa nomes não qualificados. A conexão fixa
`search_path = electoral, public`: as tabelas eleitorais resolvem primeiro e as
extensões (PostGIS, pgcrypto, pg_trgm) e as tabelas canônicas do REPBrasil em
`public` (`Persons`, `Politicians`) continuam visíveis.
"""

from __future__ import annotations

from typing import Any

import psycopg

ELECTORAL_SCHEMA = "electoral"
SEARCH_PATH = f"{ELECTORAL_SCHEMA},public"


def connect(url: str, **kwargs: Any) -> psycopg.Connection:
    """Abre uma conexão psycopg 3 com `search_path` apontando para o schema eleitoral."""
    return psycopg.connect(url, options=f"-c search_path={SEARCH_PATH}", **kwargs)
