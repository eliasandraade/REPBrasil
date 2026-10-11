"""Audited Censo 2022 ingestion for socioelectoral analysis.

The first production slice intentionally matches the 2022 general election with
municipal indicators from the 2022 Census. It loads only municipalities already
known by the electoral database and fails closed on missing, duplicated or
out-of-range observations.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import httpx

from src.pipeline.socioeconomic import Observation, SourceMeta, load_observations
from src.sources.ibge.sidra import SidraFetch, fetch_sidra

CENSUS_PERIOD = 2022
POPULATION_TABLE = 4709
POPULATION_VARIABLE = 93
LITERACY_TABLE = 9543
LITERACY_VARIABLE = 2513
CE_EXPECTED_MUNICIPALITIES = 184
PARSER_VERSION = "censo2022-socioelectoral-v1"


@dataclass(frozen=True)
class IngestionResult:
    uf: str
    period: int
    municipalities: int
    source_urls: tuple[str, ...]
    stats: dict[str, dict[str, int | bool]]


def _official_rows(
    fetched: SidraFetch,
    *,
    allowed_codes: set[str],
    period: int,
    minimum: Decimal | None = None,
    maximum: Decimal | None = None,
) -> list[Observation]:
    selected = [
        Observation(row.municipality_ibge_code, row.period, row.value)
        for row in fetched.observations
        if row.municipality_ibge_code in allowed_codes and row.period == period
    ]

    keys = [(row.municipality_ibge_code, row.period) for row in selected]
    if len(keys) != len(set(keys)):
        raise ValueError("SIDRA returned duplicated municipality-period observations")

    observed_codes = {row.municipality_ibge_code for row in selected}
    missing = sorted(allowed_codes - observed_codes)
    extra = sorted(observed_codes - allowed_codes)
    if missing or extra:
        raise ValueError(
            "incomplete SIDRA snapshot: "
            f"missing={missing[:8]} extra={extra[:8]} "
            f"observed={len(observed_codes)} expected={len(allowed_codes)}"
        )

    for row in selected:
        if minimum is not None and row.value < minimum:
            raise ValueError(f"SIDRA value below allowed range: {row}")
        if maximum is not None and row.value > maximum:
            raise ValueError(f"SIDRA value above allowed range: {row}")
    return sorted(selected, key=lambda row: row.municipality_ibge_code)


def derive_illiteracy_rate(literacy: list[Observation]) -> list[Observation]:
    result: list[Observation] = []
    hundred = Decimal(100)
    for row in literacy:
        if row.value < 0 or row.value > hundred:
            raise ValueError(f"literacy rate outside 0..100: {row}")
        result.append(
            Observation(
                municipality_ibge_code=row.municipality_ibge_code,
                period=row.period,
                value=hundred - row.value,
            )
        )
    return result


def _derived_content(upstream: bytes, *, formula: str) -> bytes:
    payload = {
        "formula": formula,
        "upstream_sha256": hashlib.sha256(upstream).hexdigest(),
        "parser_version": PARSER_VERSION,
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()


def _source(
    *,
    dataset: str,
    url: str,
    table: int,
    variable: int,
    period: int,
    derived: bool = False,
) -> SourceMeta:
    return SourceMeta(
        provider="REPBrasil" if derived else "IBGE/SIDRA",
        dataset=dataset,
        source_url=url,
        parser_version=PARSER_VERSION,
        metadata={
            "table": table,
            "variable": variable,
            "period": period,
            "territorial_level": "municipality",
            "derived": derived,
        },
    )


def ensure_indicator_catalog(conn: Any) -> None:
    """Upsert the indicators needed by this preset before loading values.

    This deliberately duplicates the migration's catalog rows so the one-shot
    ingestion remains safe when Railway starts ETL and API deployments in
    parallel. The migration stays the source of truth for fresh databases.
    """
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO electoral.indicator
            (code, name, unit, provider, description, derived, derivation)
        VALUES
            (
                'ibge.literacy_rate_15_plus',
                'Taxa de alfabetização (15+)',
                '%',
                'IBGE/SIDRA',
                'Taxa municipal de alfabetização das pessoas de 15 anos ou mais no Censo Demográfico 2022.',
                false,
                NULL
            ),
            (
                'derived.illiteracy_rate_15_plus',
                'Taxa de analfabetismo (15+)',
                '%',
                'REPBrasil',
                'Complemento da taxa oficial de alfabetização municipal das pessoas de 15 anos ou mais.',
                true,
                '100 - ibge.literacy_rate_15_plus'
            )
        ON CONFLICT (code) DO UPDATE SET
            name = EXCLUDED.name,
            unit = EXCLUDED.unit,
            provider = EXCLUDED.provider,
            description = EXCLUDED.description,
            derived = EXCLUDED.derived,
            derivation = EXCLUDED.derivation
        """
    )
    conn.commit()


def municipality_codes(conn: Any, uf: str) -> set[str]:
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT ibge_code
          FROM electoral.municipality
         WHERE state_code = %s
           AND ibge_code IS NOT NULL
         ORDER BY ibge_code
        """,
        (uf.upper(),),
    )
    rows = cursor.fetchall()
    codes = {str(int(row[0])).zfill(7) for row in rows}
    if not codes:
        raise ValueError(f"no municipality IBGE codes available for {uf.upper()}")
    if uf.upper() == "CE" and len(codes) != CE_EXPECTED_MUNICIPALITIES:
        raise ValueError(
            f"CE municipal identity is incomplete: {len(codes)} of "
            f"{CE_EXPECTED_MUNICIPALITIES} municipalities"
        )
    return codes


def ingest_censo_2022_core(
    conn: Any,
    *,
    uf: str = "CE",
    client: httpx.Client | None = None,
) -> IngestionResult:
    """Load population, literacy and derived illiteracy for one UF.

    All remote payloads are acquired and validated before the first observation
    write. A missing municipality therefore aborts the run instead of silently
    producing a partial socioeconomic profile.
    """
    codes = municipality_codes(conn, uf)

    population_fetch = fetch_sidra(
        table=POPULATION_TABLE,
        variable=POPULATION_VARIABLE,
        period=CENSUS_PERIOD,
        client=client,
    )
    literacy_fetch = fetch_sidra(
        table=LITERACY_TABLE,
        variable=LITERACY_VARIABLE,
        period=CENSUS_PERIOD,
        client=client,
    )

    population = _official_rows(
        population_fetch,
        allowed_codes=codes,
        period=CENSUS_PERIOD,
        minimum=Decimal(1),
    )
    literacy = _official_rows(
        literacy_fetch,
        allowed_codes=codes,
        period=CENSUS_PERIOD,
        minimum=Decimal(0),
        maximum=Decimal(100),
    )
    illiteracy = derive_illiteracy_rate(literacy)

    ensure_indicator_catalog(conn)

    population_stats = load_observations(
        conn,
        indicator_code="ibge.population",
        period=CENSUS_PERIOD,
        source=_source(
            dataset="Censo Demográfico 2022 · SIDRA 4709/93",
            url=population_fetch.url,
            table=POPULATION_TABLE,
            variable=POPULATION_VARIABLE,
            period=CENSUS_PERIOD,
        ),
        source_content=population_fetch.content,
        observations=population,
    )
    literacy_stats = load_observations(
        conn,
        indicator_code="ibge.literacy_rate_15_plus",
        period=CENSUS_PERIOD,
        source=_source(
            dataset="Censo Demográfico 2022 · SIDRA 9543/2513",
            url=literacy_fetch.url,
            table=LITERACY_TABLE,
            variable=LITERACY_VARIABLE,
            period=CENSUS_PERIOD,
        ),
        source_content=literacy_fetch.content,
        observations=literacy,
    )
    illiteracy_stats = load_observations(
        conn,
        indicator_code="derived.illiteracy_rate_15_plus",
        period=CENSUS_PERIOD,
        source=_source(
            dataset="Derivado auditável de SIDRA 9543/2513",
            url=literacy_fetch.url,
            table=LITERACY_TABLE,
            variable=LITERACY_VARIABLE,
            period=CENSUS_PERIOD,
            derived=True,
        ),
        source_content=_derived_content(
            literacy_fetch.content,
            formula="100 - ibge.literacy_rate_15_plus",
        ),
        observations=illiteracy,
    )

    def as_stats(stats: Any) -> dict[str, int | bool]:
        return {
            "source_id": stats.source_id,
            "inserted": stats.inserted,
            "changed": stats.changed,
            "unchanged": stats.unchanged,
            "idempotent": stats.idempotent,
        }

    return IngestionResult(
        uf=uf.upper(),
        period=CENSUS_PERIOD,
        municipalities=len(codes),
        source_urls=(population_fetch.url, literacy_fetch.url),
        stats={
            "population": as_stats(population_stats),
            "literacy_rate_15_plus": as_stats(literacy_stats),
            "illiteracy_rate_15_plus": as_stats(illiteracy_stats),
        },
    )
