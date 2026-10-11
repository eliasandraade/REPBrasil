"""Parser for Atlas do Desenvolvimento Humano municipal observations.

The Atlas endpoint was not relied on while this module was authored. The parser
therefore consumes already acquired official rows/fixtures and fails closed if
the declared columns do not match the expected contract.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation


@dataclass(frozen=True)
class AtlasObservation:
    municipality_ibge_code: str
    period: int
    value: Decimal


def parse_atlas_rows(
    rows: list[Mapping[str, object]],
    *,
    municipality_column: str = "municipality_ibge_code",
    period_column: str = "period",
    value_column: str = "value",
) -> list[AtlasObservation]:
    parsed: list[AtlasObservation] = []
    for row in rows:
        required = (municipality_column, period_column, value_column)
        missing = [name for name in required if name not in row]
        if missing:
            raise ValueError(f"Atlas columns missing: {', '.join(missing)}")
        code = str(row[municipality_column]).strip()
        if len(code) != 7 or not code.isdigit():
            raise ValueError(f"invalid Atlas municipality code: {code!r}")
        try:
            period = int(str(row[period_column]).strip())
            value = Decimal(str(row[value_column]).strip().replace(",", "."))
        except (ValueError, InvalidOperation) as exc:
            raise ValueError("invalid Atlas period/value") from exc
        if not 1900 <= period <= 2200:
            raise ValueError(f"invalid Atlas period: {period}")
        parsed.append(AtlasObservation(code, period, value))
    return parsed
