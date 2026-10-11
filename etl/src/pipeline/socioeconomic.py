"""Provenance-first loader for socioeconomic indicators."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from decimal import Decimal
from typing import Iterable, Protocol


@dataclass(frozen=True)
class Observation:
    municipality_ibge_code: str
    period: int
    value: Decimal


@dataclass(frozen=True)
class SourceMeta:
    provider: str
    dataset: str
    source_url: str
    parser_version: str
    metadata: dict[str, object]


@dataclass(frozen=True)
class LoadStats:
    source_id: int
    inserted: int
    changed: int
    unchanged: int
    idempotent: bool


class CursorLike(Protocol):
    def execute(self, query: str, params: tuple[object, ...] = ()) -> object: ...
    def fetchone(self) -> tuple[object, ...] | None: ...


class ConnectionLike(Protocol):
    def cursor(self) -> CursorLike: ...
    def commit(self) -> None: ...
    def rollback(self) -> None: ...


def canonical_payload(observations: Iterable[Observation]) -> bytes:
    rows = [
        {
            "municipality_ibge_code": row.municipality_ibge_code,
            "period": row.period,
            "value": str(row.value),
        }
        for row in sorted(observations, key=lambda x: (x.municipality_ibge_code, x.period, x.value))
    ]
    return json.dumps(rows, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()


def payload_sha256(observations: Iterable[Observation]) -> str:
    return hashlib.sha256(canonical_payload(observations)).hexdigest()


def derive_gdp_per_capita(
    gdp_thousand_reais: Iterable[Observation], population: Iterable[Observation]
) -> list[Observation]:
    pop = {(row.municipality_ibge_code, row.period): row.value for row in population}
    result: list[Observation] = []
    for row in gdp_thousand_reais:
        denominator = pop.get((row.municipality_ibge_code, row.period))
        if denominator is None or denominator <= 0:
            continue
        result.append(
            Observation(
                row.municipality_ibge_code,
                row.period,
                (row.value * Decimal(1000)) / denominator,
            )
        )
    return result


def change_kind(previous: Decimal | None, current: Decimal) -> str:
    if previous is None:
        return "inserted"
    if previous == current:
        return "unchanged"
    return "changed"


def load_observations(
    conn: ConnectionLike,
    *,
    indicator_code: str,
    source: SourceMeta,
    observations: list[Observation],
) -> LoadStats:
    """Insert one official release.

    Same provider+dataset+SHA is a no-op. A later release gets a new source row,
    preserving the earlier one for audit. `changed` counts only actual value
    changes; unchanged values in a new release are stored but not called changed.
    """
    digest = payload_sha256(observations)
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT id FROM electoral.socioeconomic_source
             WHERE provider = %s AND dataset = %s AND sha256 = %s
            """,
            (source.provider, source.dataset, digest),
        )
        existing = cursor.fetchone()
        if existing is not None:
            return LoadStats(int(existing[0]), 0, 0, 0, True)

        cursor.execute(
            """
            INSERT INTO electoral.socioeconomic_source
                (provider, dataset, source_url, sha256, parser_version, metadata)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb)
            RETURNING id
            """,
            (
                source.provider,
                source.dataset,
                source.source_url,
                digest,
                source.parser_version,
                json.dumps(source.metadata, ensure_ascii=False, sort_keys=True),
            ),
        )
        created = cursor.fetchone()
        if created is None:
            raise RuntimeError("source insert did not return an id")
        source_id = int(created[0])

        inserted = changed = unchanged = 0
        for row in observations:
            if len(row.municipality_ibge_code) != 7 or not row.municipality_ibge_code.isdigit():
                raise ValueError(f"invalid municipality code: {row.municipality_ibge_code!r}")
            cursor.execute(
                """
                SELECT v.value
                  FROM electoral.indicator_value v
                  JOIN electoral.socioeconomic_source s ON s.id = v.source_id
                 WHERE v.indicator_code = %s AND v.municipality_ibge_code = %s AND v.period = %s
                 ORDER BY s.retrieved_at DESC, s.id DESC
                 LIMIT 1
                """,
                (indicator_code, row.municipality_ibge_code, row.period),
            )
            previous_row = cursor.fetchone()
            previous = Decimal(str(previous_row[0])) if previous_row is not None else None
            kind = change_kind(previous, row.value)
            inserted += kind == "inserted"
            changed += kind == "changed"
            unchanged += kind == "unchanged"

            cursor.execute(
                """
                INSERT INTO electoral.indicator_value
                    (indicator_code, municipality_ibge_code, period, value, source_id)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (indicator_code, row.municipality_ibge_code, row.period, row.value, source_id),
            )
        conn.commit()
        return LoadStats(source_id, int(inserted), int(changed), int(unchanged), False)
    except Exception:
        conn.rollback()
        raise


def source_dict(source: SourceMeta) -> dict[str, object]:
    """Stable representation used by CLI logs/tests without serializing secrets."""
    return asdict(source)
