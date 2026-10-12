from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any

PARSER_VERSION = "tse-pesqele-v1"


@dataclass(frozen=True)
class PollSource:
    provider: str
    dataset: str
    source_url: str
    content: bytes
    published_at: datetime | None = None
    metadata: dict[str, Any] | None = None


@dataclass(frozen=True)
class PollOption:
    order: int
    label: str
    kind: str
    percentage: Decimal | None = None
    party_acronym: str | None = None
    candidacy_id: str | None = None


@dataclass(frozen=True)
class PollScenario:
    order: int
    name: str
    options: tuple[PollOption, ...] = ()


@dataclass(frozen=True)
class PollRecord:
    year: int
    round_number: int
    office_code: int
    registration_number: str
    institute_name: str
    institute_slug: str
    field_start: date
    field_end: date
    state_code: str | None = None
    municipality_tse_code: str | None = None
    published_at: datetime | None = None
    sample_size: int | None = None
    margin_error_pp: Decimal | None = None
    confidence_level: Decimal | None = None
    methodology: str | None = None
    scenarios: tuple[PollScenario, ...] = ()


def _json(value: dict[str, Any] | None) -> str:
    return json.dumps(value or {}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _validate(record: PollRecord) -> tuple[str | None, str | None]:
    if record.year < 2012 or record.year > 2200:
        raise ValueError("poll year is outside the supported range")
    if record.round_number not in {1, 2}:
        raise ValueError("poll round must be 1 or 2")
    if record.office_code <= 0:
        raise ValueError("poll office must be positive")
    if not record.registration_number.strip():
        raise ValueError("poll registration number is required")
    if not record.institute_name.strip() or not record.institute_slug.strip():
        raise ValueError("poll institute name and slug are required")
    if record.field_end < record.field_start:
        raise ValueError("poll field_end precedes field_start")
    if record.sample_size is not None and record.sample_size <= 0:
        raise ValueError("poll sample size must be positive")
    if record.margin_error_pp is not None and record.margin_error_pp < 0:
        raise ValueError("poll margin of error cannot be negative")
    if record.confidence_level is not None and not Decimal("0") < record.confidence_level <= Decimal("100"):
        raise ValueError("poll confidence level must be in (0, 100]")

    state = record.state_code.upper() if record.state_code else None
    if state is not None and (len(state) != 2 or not state.isalpha()):
        raise ValueError("poll UF must contain two letters")
    municipality = record.municipality_tse_code
    if municipality is not None:
        if state is None:
            raise ValueError("municipal poll requires UF")
        if len(municipality) != 5 or not municipality.isdigit():
            raise ValueError("TSE municipality code must contain five digits")

    scenario_orders: set[int] = set()
    for scenario in record.scenarios:
        if scenario.order < 0 or scenario.order in scenario_orders:
            raise ValueError("poll scenario order must be unique and non-negative")
        scenario_orders.add(scenario.order)
        if not scenario.name.strip():
            raise ValueError("poll scenario name is required")
        option_orders: set[int] = set()
        for option in scenario.options:
            if option.order < 0 or option.order in option_orders:
                raise ValueError("poll option order must be unique and non-negative")
            option_orders.add(option.order)
            if option.kind not in {"candidate", "blank_null", "undecided", "other"}:
                raise ValueError(f"unsupported poll option kind: {option.kind}")
            if not option.label.strip():
                raise ValueError("poll option label is required")
            if option.percentage is not None and not Decimal("0") <= option.percentage <= Decimal("100"):
                raise ValueError("poll percentage must be in [0, 100]")
            if option.candidacy_id is not None and option.kind != "candidate":
                raise ValueError("only candidate options may carry candidacy_id")
    return state, municipality


def load_poll(conn: Any, *, source: PollSource, record: PollRecord) -> str:
    """Persist one audited poll snapshot.

    `candidacy_id` is accepted only when an upstream audited mapping already exists. This
    loader never resolves candidates by name, ballot label, institute text, or fuzzy match.
    Empty result scenarios are valid: PesqEle registration metadata can be loaded before a
    published result report is available.
    """
    state, municipality = _validate(record)
    digest = hashlib.sha256(source.content).hexdigest()
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO electoral.poll_source
            (provider, dataset, source_url, published_at, content_sha256,
             parser_version, metadata)
        VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
        ON CONFLICT (provider, dataset, content_sha256) DO UPDATE SET
            source_url = EXCLUDED.source_url,
            published_at = COALESCE(EXCLUDED.published_at, electoral.poll_source.published_at),
            metadata = EXCLUDED.metadata
        RETURNING id
        """,
        (
            source.provider,
            source.dataset,
            source.source_url,
            source.published_at,
            digest,
            PARSER_VERSION,
            _json(source.metadata),
        ),
    )
    source_id = str(cursor.fetchone()[0])

    cursor.execute(
        """
        SELECT id FROM electoral.election
         WHERE year = %s AND round = %s
         ORDER BY id
        """,
        (record.year, record.round_number),
    )
    election_rows = cursor.fetchall()
    if len(election_rows) != 1:
        raise ValueError("poll requires exactly one matching electoral.election")
    election_id = str(election_rows[0][0])

    municipality_id: str | None = None
    if municipality is not None:
        cursor.execute(
            """
            SELECT id FROM electoral.municipality
             WHERE state_code = %s AND tse_code = %s
            """,
            (state, municipality),
        )
        row = cursor.fetchone()
        if row is None:
            raise ValueError("poll municipality is not present in the audited cadaster")
        municipality_id = str(row[0])

    cursor.execute(
        """
        INSERT INTO electoral.poll_institute (name, slug)
        VALUES (%s, %s)
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
        """,
        (record.institute_name.strip(), record.institute_slug.strip()),
    )
    institute_id = str(cursor.fetchone()[0])

    cursor.execute(
        """
        INSERT INTO electoral.poll
            (election_id, office_code, state_code, municipality_id,
             registration_number, institute_id, field_start, field_end, published_at,
             sample_size, margin_error_pp, confidence_level, methodology, source_id)
        VALUES (%s::uuid, %s, %s, %s::uuid, %s, %s::uuid, %s, %s, %s,
                %s, %s, %s, %s, %s::uuid)
        ON CONFLICT (registration_number, source_id) DO UPDATE SET
            institute_id = EXCLUDED.institute_id,
            field_start = EXCLUDED.field_start,
            field_end = EXCLUDED.field_end,
            published_at = EXCLUDED.published_at,
            sample_size = EXCLUDED.sample_size,
            margin_error_pp = EXCLUDED.margin_error_pp,
            confidence_level = EXCLUDED.confidence_level,
            methodology = EXCLUDED.methodology
        RETURNING id
        """,
        (
            election_id,
            record.office_code,
            state,
            municipality_id,
            record.registration_number.strip(),
            institute_id,
            record.field_start,
            record.field_end,
            record.published_at,
            record.sample_size,
            record.margin_error_pp,
            record.confidence_level,
            record.methodology,
            source_id,
        ),
    )
    poll_id = str(cursor.fetchone()[0])

    cursor.execute("DELETE FROM electoral.poll_scenario WHERE poll_id = %s::uuid", (poll_id,))
    for scenario in record.scenarios:
        cursor.execute(
            """
            INSERT INTO electoral.poll_scenario (poll_id, name, scenario_order)
            VALUES (%s::uuid, %s, %s)
            RETURNING id
            """,
            (poll_id, scenario.name.strip(), scenario.order),
        )
        scenario_id = str(cursor.fetchone()[0])
        for option in scenario.options:
            if option.candidacy_id is not None:
                cursor.execute(
                    "SELECT 1 FROM electoral.candidacy WHERE id = %s::uuid",
                    (option.candidacy_id,),
                )
                if cursor.fetchone() is None:
                    raise ValueError("audited poll candidacy_id does not exist")
            cursor.execute(
                """
                INSERT INTO electoral.poll_result
                    (scenario_id, option_order, option_label, option_kind,
                     candidacy_id, party_acronym, percentage)
                VALUES (%s::uuid, %s, %s, %s, %s::uuid, %s, %s)
                """,
                (
                    scenario_id,
                    option.order,
                    option.label.strip(),
                    option.kind,
                    option.candidacy_id,
                    option.party_acronym,
                    option.percentage,
                ),
            )
    conn.commit()
    return poll_id
