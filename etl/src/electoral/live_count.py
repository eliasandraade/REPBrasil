from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

PARSER_VERSION = "tse-ea20-v1"
_BRT = ZoneInfo("America/Sao_Paulo")
_OFFICIAL_RESULTS_HOST = "resultados.tse.jus.br"


@dataclass(frozen=True)
class LiveCandidate:
    tse_candidate_id: int
    candidate_number: int
    label: str
    party_acronym: str | None
    votes: int | None
    percentage: Decimal | None
    position: int
    result_status: str | None


@dataclass(frozen=True)
class LiveResult:
    election_code: int
    round_number: int
    office_code: int
    phase: str
    scope_type: str
    scope_code: str
    generated_at: datetime | None
    status: str
    total_sections: int | None
    counted_sections: int | None
    counted_percent: Decimal | None
    candidates: tuple[LiveCandidate, ...]


def _optional_int(value: Any) -> int | None:
    if value is None or str(value).strip() == "":
        return None
    text = str(value).strip()
    if not text.lstrip("-").isdigit():
        raise ValueError(f"invalid integer in TSE live result: {value!r}")
    return int(text)


def _required_int(value: Any, field: str) -> int:
    parsed = _optional_int(value)
    if parsed is None:
        raise ValueError(f"missing required TSE live-result field: {field}")
    return parsed


def _optional_decimal(value: Any) -> Decimal | None:
    if value is None or str(value).strip() == "":
        return None
    raw = str(value).strip()
    text = raw.replace(".", "").replace(",", ".") if "," in raw else raw
    try:
        parsed = Decimal(text)
    except InvalidOperation as exc:
        raise ValueError(f"invalid decimal in TSE live result: {value!r}") from exc
    return parsed


def _generated_at(payload: dict[str, Any]) -> datetime | None:
    date_text = str(payload.get("dg") or "").strip()
    time_text = str(payload.get("hg") or "").strip()
    if not date_text and not time_text:
        return None
    if not date_text or not time_text:
        raise ValueError("TSE live result has incomplete generation timestamp")
    try:
        return datetime.strptime(
            f"{date_text} {time_text}", "%d/%m/%Y %H:%M:%S"
        ).replace(tzinfo=_BRT)
    except ValueError as exc:
        raise ValueError("invalid TSE live-result generation timestamp") from exc


def parse_live_result(content: bytes, *, office_code: int) -> LiveResult:
    """Parse the official TSE EA20 unified-result JSON, failing closed on layout drift."""
    if not content:
        raise ValueError("empty TSE live-result artifact")
    try:
        payload = json.loads(content)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("invalid TSE live-result JSON") from exc
    if not isinstance(payload, dict):
        raise ValueError("unexpected TSE live-result root")

    election_code = _required_int(payload.get("ele"), "ele")
    round_number = _required_int(payload.get("t"), "t")
    if round_number not in {1, 2}:
        raise ValueError("unexpected TSE election round")

    phase = str(payload.get("f") or "").strip().lower()
    if phase not in {"o", "s"}:
        raise ValueError("unexpected TSE live-result phase")
    scope_type = str(payload.get("tpabr") or "").strip().lower()
    if scope_type not in {"br", "uf", "mu", "zona"}:
        raise ValueError("unexpected TSE live-result scope type")
    scope_code = str(payload.get("cdabr") or "").strip().lower()
    if not scope_code:
        raise ValueError("TSE live result is missing scope code")

    andamento = str(payload.get("and") or "").strip().lower()
    status_by_andamento = {"n": "not_started", "p": "partial", "f": "final"}
    if andamento not in status_by_andamento:
        raise ValueError("unexpected TSE live-result progress status")

    sections = payload.get("s")
    if not isinstance(sections, dict):
        raise ValueError("TSE live result is missing section totals")
    total_sections = _optional_int(sections.get("ts"))
    counted_sections = _optional_int(sections.get("st"))
    counted_percent = _optional_decimal(sections.get("pstn"))
    if total_sections is not None and total_sections < 0:
        raise ValueError("negative total section count")
    if counted_sections is not None and counted_sections < 0:
        raise ValueError("negative counted section count")
    if (
        total_sections is not None
        and counted_sections is not None
        and counted_sections > total_sections
    ):
        raise ValueError("counted sections exceed total sections")
    if counted_percent is not None and not Decimal("0") <= counted_percent <= Decimal("100"):
        raise ValueError("counted section percentage is outside 0..100")

    cargos = payload.get("carg")
    if not isinstance(cargos, list):
        raise ValueError("TSE live result is missing cargos")
    cargo = next(
        (
            item
            for item in cargos
            if isinstance(item, dict) and _optional_int(item.get("cd")) == office_code
        ),
        None,
    )
    if cargo is None:
        raise ValueError(f"office {office_code} not present in TSE live result")

    candidates: list[LiveCandidate] = []
    seen_positions: set[int] = set()
    groups = cargo.get("agr")
    if not isinstance(groups, list):
        raise ValueError("TSE live-result office is missing agremiações")
    for group in groups:
        if not isinstance(group, dict):
            raise ValueError("unexpected TSE agremiação payload")
        parties = group.get("par")
        if not isinstance(parties, list):
            raise ValueError("unexpected TSE party payload")
        for party in parties:
            if not isinstance(party, dict):
                raise ValueError("unexpected TSE party row")
            party_acronym = str(party.get("sg") or "").strip() or None
            rows = party.get("cand")
            if not isinstance(rows, list):
                raise ValueError("unexpected TSE candidate payload")
            for row in rows:
                if not isinstance(row, dict):
                    raise ValueError("unexpected TSE candidate row")
                label = str(row.get("nmu") or "").strip()
                if not label:
                    raise ValueError("TSE candidate row without published ballot name")
                position = _required_int(row.get("seq"), "cand.seq")
                if position <= 0 or position in seen_positions:
                    raise ValueError("TSE candidate sequence must be unique and positive")
                seen_positions.add(position)
                candidate_number = _required_int(row.get("n"), "cand.n")
                tse_candidate_id = _required_int(row.get("sqcand"), "cand.sqcand")
                votes = _optional_int(row.get("vap"))
                percentage = _optional_decimal(row.get("pvapn"))
                if votes is not None and votes < 0:
                    raise ValueError("negative candidate vote count")
                if percentage is not None and not Decimal("0") <= percentage <= Decimal("100"):
                    raise ValueError("candidate percentage is outside 0..100")
                candidates.append(
                    LiveCandidate(
                        tse_candidate_id=tse_candidate_id,
                        candidate_number=candidate_number,
                        label=label,
                        party_acronym=party_acronym,
                        votes=votes,
                        percentage=percentage,
                        position=position,
                        result_status=str(row.get("st") or "").strip() or None,
                    )
                )

    candidates.sort(key=lambda item: item.position)
    return LiveResult(
        election_code=election_code,
        round_number=round_number,
        office_code=office_code,
        phase=phase,
        scope_type=scope_type,
        scope_code=scope_code,
        generated_at=_generated_at(payload),
        status=status_by_andamento[andamento],
        total_sections=total_sections,
        counted_sections=counted_sections,
        counted_percent=counted_percent,
        candidates=tuple(candidates),
    )


def load_live_result(
    conn: Any,
    *,
    year: int,
    uf: str | None,
    municipality_tse_code: str | None,
    source_url: str,
    raw_content: bytes,
    parsed: LiveResult,
    ingestion_run_id: str | None = None,
) -> str:
    """Persist one immutable official snapshot; candidate linking uses SQ_CANDIDATO only."""
    if parsed.phase != "o":
        raise ValueError("only official TSE result artifacts may be persisted")
    source = urlparse(source_url)
    if source.scheme != "https" or source.hostname != _OFFICIAL_RESULTS_HOST:
        raise ValueError("live snapshot source must be the official TSE results host")
    if parsed.round_number not in {1, 2}:
        raise ValueError("round must be 1 or 2")
    normalized_uf = uf.upper() if uf else None
    if normalized_uf is not None and (len(normalized_uf) != 2 or not normalized_uf.isalpha()):
        raise ValueError("UF must contain two letters")
    if municipality_tse_code is not None:
        if normalized_uf is None:
            raise ValueError("municipality snapshot requires UF")
        if len(municipality_tse_code) != 5 or not municipality_tse_code.isdigit():
            raise ValueError("TSE municipality code must contain five digits")

    expected_scope_type = "mu" if municipality_tse_code is not None else "uf" if normalized_uf is not None else "br"
    expected_scope_code = (
        municipality_tse_code.lower()
        if municipality_tse_code is not None
        else normalized_uf.lower()
        if normalized_uf is not None
        else "br"
    )
    if parsed.scope_type != expected_scope_type or parsed.scope_code != expected_scope_code:
        raise ValueError("TSE artifact scope does not match the requested snapshot scope")

    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id FROM electoral.election
         WHERE year = %s AND round = %s
         ORDER BY id
        """,
        (year, parsed.round_number),
    )
    election_rows = cursor.fetchall()
    if len(election_rows) != 1:
        raise ValueError("live snapshot requires exactly one matching electoral.election")
    election_id = str(election_rows[0][0])

    cursor.execute(
        """
        SELECT 1
          FROM electoral.contest
         WHERE election_id = %s::uuid AND office_code = %s AND tse_election_code = %s
         LIMIT 1
        """,
        (election_id, parsed.office_code, parsed.election_code),
    )
    if cursor.fetchone() is None:
        raise ValueError("TSE artifact election code does not match the audited contest")

    municipality_id: str | None = None
    if municipality_tse_code is not None:
        cursor.execute(
            """
            SELECT id FROM electoral.municipality
             WHERE state_code = %s AND tse_code = %s
            """,
            (normalized_uf, municipality_tse_code),
        )
        row = cursor.fetchone()
        if row is None:
            raise ValueError("municipality is not present in the audited electoral cadaster")
        municipality_id = str(row[0])

    scope = (
        "municipal"
        if municipality_id is not None
        else "state"
        if normalized_uf is not None
        else "national"
    )
    digest = hashlib.sha256(raw_content).hexdigest()
    cursor.execute(
        """
        INSERT INTO electoral.totalization_snapshot
            (election_id, office_code, scope, state_code, municipality_id,
             tse_generated_at, status, counted_sections, total_sections, counted_percent,
             source_url, content_sha256, parser_version, ingestion_run_id)
        VALUES (%s::uuid, %s, %s, %s, %s::uuid, %s, %s, %s, %s, %s,
                %s, %s, %s, %s::uuid)
        ON CONFLICT DO NOTHING
        RETURNING id
        """,
        (
            election_id,
            parsed.office_code,
            scope,
            normalized_uf,
            municipality_id,
            parsed.generated_at,
            parsed.status,
            parsed.counted_sections,
            parsed.total_sections,
            parsed.counted_percent,
            source_url,
            digest,
            PARSER_VERSION,
            ingestion_run_id,
        ),
    )
    inserted = cursor.fetchone()
    if inserted is None:
        cursor.execute(
            """
            SELECT id FROM electoral.totalization_snapshot
             WHERE election_id = %s::uuid AND office_code = %s AND scope = %s
               AND state_code IS NOT DISTINCT FROM %s
               AND municipality_id IS NOT DISTINCT FROM %s::uuid
               AND content_sha256 = %s
            """,
            (
                election_id,
                parsed.office_code,
                scope,
                normalized_uf,
                municipality_id,
                digest,
            ),
        )
        existing = cursor.fetchone()
        if existing is None:
            raise RuntimeError("failed to resolve idempotent totalization snapshot")
        snapshot_id = str(existing[0])
        conn.commit()
        return snapshot_id

    snapshot_id = str(inserted[0])
    for item in parsed.candidates:
        candidacy_id: str | None = None
        cursor.execute(
            """
            SELECT c.id
              FROM electoral.candidacy c
              JOIN electoral.contest k ON k.id = c.contest_id
             WHERE k.election_id = %s::uuid AND k.office_code = %s
               AND k.tse_election_code = %s AND c.tse_candidate_id = %s
             ORDER BY c.id
            """,
            (election_id, parsed.office_code, parsed.election_code, item.tse_candidate_id),
        )
        matches = cursor.fetchall()
        if len(matches) == 1:
            candidacy_id = str(matches[0][0])

        cursor.execute(
            """
            INSERT INTO electoral.totalization_result
                (snapshot_id, position, candidacy_id, candidate_number, option_label,
                 party_acronym, votes, percentage, result_status)
            VALUES (%s::uuid, %s, %s::uuid, %s, %s, %s, %s, %s, %s)
            """,
            (
                snapshot_id,
                item.position,
                candidacy_id,
                item.candidate_number,
                item.label,
                item.party_acronym,
                item.votes,
                item.percentage,
                item.result_status,
            ),
        )
    conn.commit()
    return snapshot_id
