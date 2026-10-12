from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from src.sources.camara.activity import CamaraActivity
from src.sources.transparencia.amendments import AmendmentRecord

PARSER_VERSION = "parliament-v1"


@dataclass(frozen=True)
class ParliamentSource:
    provider: str
    dataset: str
    source_url: str
    content: bytes
    published_at: datetime | None = None
    metadata: dict[str, Any] | None = None


@dataclass(frozen=True)
class ParliamentMember:
    institution: str
    external_id: str
    name: str
    parliamentary_name: str | None = None
    state_code: str | None = None
    party_acronym: str | None = None
    photo_url: str | None = None
    person_id: str | None = None
    official_document_hash: str | None = None
    identity_method: str = "unlinked"
    raw: dict[str, Any] | None = None


def _json(value: dict[str, Any] | None) -> str:
    return json.dumps(value or {}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def ensure_source(conn: Any, source: ParliamentSource) -> int:
    digest = hashlib.sha256(source.content).hexdigest()
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO electoral.parliament_source
            (provider, dataset, source_url, published_at, sha256, parser_version, metadata)
        VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
        ON CONFLICT (provider, dataset, sha256) DO UPDATE SET
            source_url = EXCLUDED.source_url,
            published_at = COALESCE(
                EXCLUDED.published_at,
                electoral.parliament_source.published_at
            ),
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
    source_id = int(cursor.fetchone()[0])
    conn.commit()
    return source_id


def upsert_member(conn: Any, member: ParliamentMember, *, source_id: int) -> int:
    if member.institution not in {"camara", "senado", "alece"}:
        raise ValueError(f"unsupported parliament institution: {member.institution}")
    if member.identity_method == "official_document":
        if member.institution != "camara":
            raise ValueError(
                "official-document identity linking is currently allowed only for Câmara"
            )
        if not member.official_document_hash or not member.person_id:
            raise ValueError(
                "official-document identity requires document hash and audited person id"
            )
    elif member.identity_method != "unlinked":
        raise ValueError("parliament identity must be official_document or unlinked")
    elif member.person_id is not None or member.official_document_hash is not None:
        raise ValueError("unlinked parliament members cannot carry inferred identity fields")

    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO electoral.parliament_member
            (institution, external_id, name, parliamentary_name, state_code,
             party_acronym, photo_url, person_id, official_document_hash,
             identity_method, source_id, raw)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s::uuid, %s, %s, %s, %s::jsonb)
        ON CONFLICT (institution, external_id) DO UPDATE SET
            name = EXCLUDED.name,
            parliamentary_name = EXCLUDED.parliamentary_name,
            state_code = EXCLUDED.state_code,
            party_acronym = EXCLUDED.party_acronym,
            photo_url = EXCLUDED.photo_url,
            person_id = CASE
                WHEN EXCLUDED.identity_method = 'official_document' THEN EXCLUDED.person_id
                ELSE electoral.parliament_member.person_id
            END,
            official_document_hash = CASE
                WHEN EXCLUDED.identity_method = 'official_document'
                    THEN EXCLUDED.official_document_hash
                ELSE electoral.parliament_member.official_document_hash
            END,
            identity_method = CASE
                WHEN EXCLUDED.identity_method = 'official_document' THEN 'official_document'
                ELSE electoral.parliament_member.identity_method
            END,
            source_id = EXCLUDED.source_id,
            raw = EXCLUDED.raw,
            updated_at = now()
        RETURNING id
        """,
        (
            member.institution,
            member.external_id,
            member.name,
            member.parliamentary_name,
            member.state_code,
            member.party_acronym,
            member.photo_url,
            member.person_id,
            member.official_document_hash,
            member.identity_method,
            source_id,
            _json(member.raw),
        ),
    )
    member_id = int(cursor.fetchone()[0])
    conn.commit()
    return member_id


def load_camara_activities(
    conn: Any,
    *,
    member_id: int,
    source_id: int,
    activities: Iterable[CamaraActivity],
) -> int:
    cursor = conn.cursor()
    changed = 0
    for row in activities:
        cursor.execute(
            """
            INSERT INTO electoral.parliament_activity
                (member_id, institution, activity_type, external_id, occurred_at,
                 title, description, source_url, source_id, raw)
            VALUES (%s, 'camara', %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (institution, activity_type, external_id, member_id) DO UPDATE SET
                occurred_at = EXCLUDED.occurred_at,
                title = EXCLUDED.title,
                description = EXCLUDED.description,
                source_url = EXCLUDED.source_url,
                source_id = EXCLUDED.source_id,
                raw = EXCLUDED.raw
            """,
            (
                member_id,
                row.activity_type,
                row.external_id,
                row.occurred_at,
                row.title,
                row.description,
                row.source_url,
                source_id,
                _json(row.raw),
            ),
        )
        changed += 1
    conn.commit()
    return changed


def load_amendments(
    conn: Any,
    *,
    source_id: int,
    records: Iterable[AmendmentRecord],
    author_member_ids: dict[str, int] | None = None,
) -> int:
    """Load official amendments without attempting author-name identity inference.

    author_member_ids must come from an independently audited identity mapping.
    A matching textual author name is never sufficient to link a parliament member.
    """
    author_member_ids = author_member_ids or {}
    cursor = conn.cursor()
    changed = 0
    for row in records:
        member_id = author_member_ids.get(row.external_id)
        cursor.execute(
            """
            INSERT INTO electoral.parliament_amendment
                (external_id, author_member_id, author_name, year, amendment_type,
                 functional_programming, beneficiary_document, beneficiary_name,
                 locality, municipality_ibge_code, committed_amount, paid_amount, source_id, raw)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (external_id, source_id) DO UPDATE SET
                author_member_id = EXCLUDED.author_member_id,
                author_name = EXCLUDED.author_name,
                year = EXCLUDED.year,
                amendment_type = EXCLUDED.amendment_type,
                functional_programming = EXCLUDED.functional_programming,
                beneficiary_document = EXCLUDED.beneficiary_document,
                beneficiary_name = EXCLUDED.beneficiary_name,
                locality = EXCLUDED.locality,
                municipality_ibge_code = EXCLUDED.municipality_ibge_code,
                committed_amount = EXCLUDED.committed_amount,
                paid_amount = EXCLUDED.paid_amount,
                raw = EXCLUDED.raw
            """,
            (
                row.external_id,
                member_id,
                row.author_name,
                row.year,
                row.amendment_type,
                row.functional_programming,
                row.beneficiary_document,
                row.beneficiary_name,
                row.locality,
                row.municipality_ibge_code,
                row.committed_amount,
                row.paid_amount,
                source_id,
                _json(row.raw),
            ),
        )
        changed += 1
    conn.commit()
    return changed
