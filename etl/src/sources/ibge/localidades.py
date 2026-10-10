"""IBGE — API de localidades (https://servicodados.ibge.gov.br/api/v1/localidades).

Autoridade territorial: código IBGE e nome oficial de cada município. Usado para AUDITAR o
registro territorial importado do TSE (`municipio_tse_ibge.zip`): mesmo conjunto de códigos IBGE
e mesmos nomes (comparação sem acento/caixa). Nada é alterado automaticamente.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from typing import Any

import httpx

IBGE_API_BASE = "https://servicodados.ibge.gov.br/api/v1/localidades"


@dataclass(frozen=True)
class IbgeMunicipality:
    code: int
    name: str


def fold(name: str) -> str:
    decomposed = unicodedata.normalize("NFKD", name)
    return " ".join(
        "".join(c for c in decomposed if not unicodedata.combining(c))
        .upper()
        .replace("-", " ")
        .split()
    )


def parse_municipalities(payload: list[dict[str, Any]]) -> list[IbgeMunicipality]:
    if not isinstance(payload, list):
        raise ValueError("unexpected IBGE payload: expected a list of municipalities")
    return [IbgeMunicipality(int(m["id"]), str(m["nome"])) for m in payload]


def fetch_municipalities(uf: str, client: httpx.Client | None = None) -> list[IbgeMunicipality]:
    own = client is None
    client = client or httpx.Client(timeout=30)
    try:
        r = client.get(f"{IBGE_API_BASE}/estados/{uf.upper()}/municipios")
        r.raise_for_status()
        return parse_municipalities(r.json())
    finally:
        if own:
            client.close()


def compare_registry(
    ibge: list[IbgeMunicipality], registry: list[tuple[int | None, str]]
) -> dict[str, Any]:
    """Compara a lista oficial do IBGE com o registro (ibge_code, nome) importado do TSE."""
    by_code = {m.code: m.name for m in ibge}
    stored = {code: name for code, name in registry if code is not None}
    missing = sorted(set(by_code) - set(stored))
    extra = sorted(set(stored) - set(by_code))
    renamed = [
        {"ibge_code": code, "ibge": by_code[code], "registry": stored[code]}
        for code in sorted(set(by_code) & set(stored))
        if fold(by_code[code]) != fold(stored[code])
    ]
    return {
        "ibge_municipalities": len(by_code),
        "registry_municipalities": len(stored),
        "missing_in_registry": missing,
        "not_in_ibge": extra,
        "name_differences": renamed,
        "status": "ok" if not missing and not extra else "divergent",
    }
