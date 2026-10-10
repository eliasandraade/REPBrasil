"""Validação cruzada dos totais por zona/cargo contra o EA20 oficial.

O CSV do BU é somado por zona e cargo e comparado com os totais publicados no
EA20 (`ea20.py`, já validado contra as identidades da especificação). Só são
comparados atributos presentes no EA20: ausência não vira zero.

Sem EA20 fornecido, o status é `not_available` — não impede a importação.
"""
from __future__ import annotations

from typing import Any

from ..ea20 import EA20Result, EA20ZoneExpectation, validate_zone_result
from .results import NormalizedZone

NOT_AVAILABLE = "not_available"


def zone_totals(zone: NormalizedZone, office: int) -> dict[str, int | None]:
    """Somas por zona. Se alguma urna não informa uma métrica, o total é None."""
    totals: dict[str, int | None] = {"c": 0, "a": 0, "vb": 0, "vn": 0, "vnom": 0, "vl": 0}
    for (_, office_code, _), result in zone.results.items():
        if office_code != office:
            continue
        for key, field_name in (("c", "turnout"), ("a", "abstentions")):
            value = result.structural[field_name]
            current = totals[key]
            totals[key] = None if value is None or current is None else current + int(value)  # type: ignore[call-overload]
        for vote in result.votes:
            kind = {1: "vnom", 2: "vb", 3: "vn", 4: "vl"}[vote.votable.type_code]
            totals[kind] = (totals[kind] or 0) + vote.votes
    return totals


def validate_against_ea20(zone: NormalizedZone, documents: list[EA20Result]) -> dict[str, Any]:
    if not documents:
        return {"status": NOT_AVAILABLE, "offices": {}}
    offices: dict[str, Any] = {}
    status = "pass"
    for doc in documents:
        office = int(doc.carg[0].code4) if len(doc.carg) == 1 else None
        if office is None:
            raise ValueError("EA20 zone document must reference exactly one office")
        election = {r.election_code for (_, o, _), r in zone.results.items() if o == office}
        if len(election) != 1:
            raise ValueError(f"office {office} not found (or ambiguous) in BU for this zone")
        validate_zone_result(doc, EA20ZoneExpectation(election=next(iter(election)), zone=zone.zone, office_code=str(office)))
        bu = zone_totals(zone, office)
        published = {"c": doc.e.c, "a": doc.e.a, "vb": doc.v.vb, "vn": doc.v.vn, "vnom": doc.v.vnom, "vl": doc.v.vl}
        diffs = {k: {"bu": bu[k], "ea20": v} for k, v in published.items() if v is not None and bu[k] is not None and bu[k] != v}
        undetermined = sorted(k for k, v in published.items() if v is not None and bu[k] is None)
        offices[str(office)] = {"status": "fail" if diffs else "pass", "differences": diffs, "not_compared": undetermined}
        if diffs:
            status = "fail"
    return {"status": status, "offices": offices}
