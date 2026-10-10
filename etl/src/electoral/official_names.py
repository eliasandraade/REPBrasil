"""Nomes oficiais de UF e município pela API de localidades do IBGE (autoridade de nomes).

O arquivo de códigos do TSE capitaliza toda palavra ("Juazeiro Do Norte"); a grafia oficial é a do
IBGE ("Juazeiro do Norte", "Herval d'Oeste", "Não-Me-Toque"). A identidade é sempre o código IBGE,
nunca o nome. Só a GRAFIA muda — caixa, acentos, hífens, apóstrofos —, e só quando IBGE e registro
dizem o MESMO nome (comparação sem acento, caixa e hífen); nome realmente diferente fica como está e
é reportado para revisão humana. Código e slug (URL) nunca mudam. Idempotente.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from ..sources.ibge.localidades import IBGE_API_BASE, fold

SOURCE = "ibge-official-names"


@dataclass(frozen=True)
class OfficialName:
    code: int  # código IBGE
    name: str


def plan(official: list[OfficialName], stored: list[tuple[Any, int | None, str]]) -> dict[str, list[dict[str, Any]]]:
    """(chave, código IBGE, nome gravado) → grafias a corrigir, nomes diferentes e códigos que o IBGE não tem."""
    by_code = {o.code: o.name for o in official}
    updates, differences, not_in_ibge = [], [], []
    for key, code, name in stored:
        if code is None or code not in by_code:
            not_in_ibge.append({"key": key, "ibge_code": code, "name": name})
            continue
        want = by_code[code]
        if want == name:
            continue
        if fold(want) == fold(name):
            updates.append({"key": key, "ibge_code": code, "from": name, "to": want})
        else:
            differences.append({"key": key, "ibge_code": code, "registry": name, "ibge": want})
    return {"updates": updates, "differences": differences, "not_in_ibge": not_in_ibge}


def sync_official_names(
    conn: psycopg.Connection,
    municipalities: list[OfficialName],
    states: list[OfficialName],
    *,
    ufs: set[str] | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Aplica a grafia oficial do IBGE aos nomes de UF e município do registro (`ufs` limita o escopo)."""
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("SET LOCAL search_path TO electoral, public")
        cur.execute("SELECT code, ibge_code, name FROM state ORDER BY code")
        state_rows = [(r[0], r[1], r[2]) for r in cur.fetchall() if ufs is None or r[0] in ufs]
        cur.execute("SELECT state_code, tse_code, ibge_code, name FROM municipality ORDER BY state_code, tse_code")
        mun_rows = [((r[0], r[1]), r[2], r[3]) for r in cur.fetchall() if ufs is None or r[0] in ufs]
        st = plan(states, state_rows)
        mu = plan(municipalities, mun_rows)
        report: dict[str, Any] = {
            "status": "dry_run" if dry_run else "succeeded",
            "source": f"{IBGE_API_BASE}/estados e /municipios",
            "ufs": sorted(ufs) if ufs else "all",
            "states_checked": len(state_rows),
            "states_updated": len(st["updates"]),
            "municipalities_checked": len(mun_rows),
            "municipalities_updated": len(mu["updates"]),
            "name_differences": [*st["differences"], *mu["differences"]],
            "not_in_ibge": [*st["not_in_ibge"], *mu["not_in_ibge"]],
            "examples": [f"{u['from']} -> {u['to']}" for u in (st["updates"] + mu["updates"])[:12]],
        }
        if dry_run:
            return report
        for u in st["updates"]:
            cur.execute("UPDATE state SET name = %s WHERE code = %s AND name = %s", (u["to"], u["key"], u["from"]))
        for u in mu["updates"]:
            cur.execute(
                "UPDATE municipality SET name = %s WHERE state_code = %s AND tse_code = %s AND name = %s",
                (u["to"], u["key"][0], u["key"][1], u["from"]),
            )
        stats = {k: (len(v) if isinstance(v, list) else v) for k, v in report.items() if k != "examples"}
        cur.execute(
            "INSERT INTO ingestion_run (source, scope, status, finished_at, stats) VALUES (%s, %s, 'succeeded', now(), %s) RETURNING id",
            (SOURCE, Jsonb({"ufs": report["ufs"], "api": IBGE_API_BASE}), Jsonb(stats)),
        )
        report["import_batch_id"] = str(cur.fetchone()[0])  # type: ignore[index]
    return report
