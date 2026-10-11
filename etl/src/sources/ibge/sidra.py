"""SIDRA/IBGE helpers for municipal socioeconomic indicators.

The module is deliberately small and strict: dataset identifiers are numeric,
periods are re-emitted from integers, and IBGE's textual missing markers are
never coerced to zero.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

SIDRA_BASE = "https://apisidra.ibge.gov.br/values"
MISSING_MARKERS = {"..", "...", "X", "x", ""}


@dataclass(frozen=True)
class SidraObservation:
    municipality_ibge_code: str
    period: int
    value: Decimal


@dataclass(frozen=True)
class SidraFetch:
    url: str
    content: bytes
    observations: list[SidraObservation]


def parse_sidra_value(raw: object) -> Decimal | None:
    """Parse the official SIDRA notation without inventing values.

    `-` is a true published zero. `..`, `...`, `X` and blank mean unavailable.
    """
    if raw is None:
        return None
    text = str(raw).strip()
    if text in MISSING_MARKERS:
        return None
    if text == "-":
        return Decimal(0)
    text = text.replace(" ", "").replace(",", ".")
    try:
        return Decimal(text)
    except InvalidOperation as exc:
        raise ValueError(f"unexpected SIDRA value: {raw!r}") from exc


def _header_field(header: dict[str, Any], labels: tuple[str, ...]) -> str | None:
    for key, raw_label in header.items():
        if not key.endswith("C"):
            continue
        label = str(raw_label).strip().casefold()
        if any(label == candidate or candidate in label for candidate in labels):
            return key
    return None


def _detect_sidra_fields(payload: list[dict[str, Any]]) -> tuple[str, str]:
    if not payload or not isinstance(payload[0], dict):
        return "D1C", "D2C"

    header = payload[0]
    municipality_field = _header_field(
        header,
        (
            "município",
            "municipio",
            "município (código)",
            "municipio (código)",
            "municipio (codigo)",
        ),
    )
    period_field = _header_field(
        header,
        (
            "ano",
            "ano (código)",
            "ano (codigo)",
            "período",
            "periodo",
            "período (código)",
            "periodo (código)",
            "periodo (codigo)",
        ),
    )

    if municipality_field is None:
        raise ValueError("SIDRA payload does not identify the municipality code dimension")
    if period_field is None:
        raise ValueError("SIDRA payload does not identify the period dimension")
    return municipality_field, period_field


def parse_sidra_payload(
    payload: list[dict[str, Any]],
    *,
    municipality_field: str | None = None,
    period_field: str | None = None,
    value_field: str = "V",
) -> list[SidraObservation]:
    if not isinstance(payload, list):
        raise ValueError("unexpected SIDRA payload: expected a list")

    if municipality_field is None or period_field is None:
        detected_municipality, detected_period = _detect_sidra_fields(payload)
        municipality_field = municipality_field or detected_municipality
        period_field = period_field or detected_period

    rows: list[SidraObservation] = []
    for item in payload:
        if not isinstance(item, dict):
            raise ValueError("unexpected SIDRA payload row")
        code = str(item.get(municipality_field, "")).strip()
        period_raw = str(item.get(period_field, "")).strip()
        if not (len(code) == 7 and code.isdigit()):
            continue
        if not period_raw.isdigit():
            raise ValueError(f"invalid SIDRA period: {period_raw!r}")
        value = parse_sidra_value(item.get(value_field))
        if value is None:
            continue
        rows.append(SidraObservation(code, int(period_raw), value))
    return rows


def build_sidra_url(*, table: int, variable: int, period: int) -> str:
    """Build a municipality-level URL using validated integer identifiers."""
    table_i = int(table)
    variable_i = int(variable)
    period_i = int(period)
    if table_i <= 0 or variable_i <= 0 or not 1900 <= period_i <= 2200:
        raise ValueError("invalid SIDRA table, variable or period")
    return f"{SIDRA_BASE}/t/{table_i}/n6/all/v/{variable_i}/p/{period_i}"


def fetch_sidra(
    *,
    table: int,
    variable: int,
    period: int,
    client: httpx.Client | None = None,
) -> SidraFetch:
    url = build_sidra_url(table=table, variable=variable, period=period)
    own = client is None
    client = client or httpx.Client(timeout=60)
    try:
        response = client.get(url)
        response.raise_for_status()
        payload = response.json()
        return SidraFetch(url, response.content, parse_sidra_payload(payload))
    finally:
        if own:
            client.close()
