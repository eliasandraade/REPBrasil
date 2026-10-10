from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path
from typing import Any
from uuid import UUID

import polars as pl
import psycopg

from .lake import LakeScope, scan_scope


class LakeQueryError(RuntimeError):
    pass


def _uuid_values(values: Iterable[str]) -> list[UUID]:
    return [UUID(str(value)) for value in values]


def valid_votes_by_result(
    conn: psycopg.Connection,
    root: Path,
    *,
    year: int,
    turn: int,
    uf: str,
    municipality_tse_code: str,
    office_codes: list[int],
    zone: int | None = None,
) -> list[dict[str, int]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id::bigint
              FROM votable
             WHERE uf = %s AND vote_kind IN ('candidate', 'party_legend')
            """,
            (uf.upper(),),
        )
        valid_ids = [int(row[0]) for row in cur.fetchall()]
    if not valid_ids:
        return []
    frame = scan_scope(
        root,
        LakeScope(year, turn, uf),
        municipality_tse_code=municipality_tse_code,
        zone=zone,
        votable_ids=valid_ids,
    )
    if office_codes:
        frame = frame.filter(pl.col("office_code").is_in([int(code) for code in office_codes]))
    rows = (
        frame.group_by("result_id")
        .agg(pl.col("votes").sum().alias("valid_votes"))
        .collect()
        .sort("result_id")
        .iter_rows(named=True)
    )
    return [{"resultId": int(row["result_id"]), "validVotes": int(row["valid_votes"] or 0)} for row in rows]


def candidacy_votes_by_result(
    conn: psycopg.Connection,
    root: Path,
    *,
    candidacy_ids: list[str],
    scopes: list[dict[str, Any]],
    uf: str,
    municipality_tse_code: str,
    zone: int | None = None,
) -> list[dict[str, Any]]:
    ids = _uuid_values(candidacy_ids)
    if not ids or not scopes:
        return []
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT vc.candidacy_id::text, vc.votable_id::bigint
              FROM votable_candidacy vc
             WHERE vc.candidacy_id = ANY(%s::uuid[]) AND vc.uf = %s
            """,
            (ids, uf.upper()),
        )
        mappings = [(str(row[0]), int(row[1])) for row in cur.fetchall()]
    if not mappings:
        return []

    mapping = pl.DataFrame(mappings, schema=("candidacy_id", "votable_id"), orient="row").lazy()
    parts: list[pl.DataFrame] = []
    seen: set[tuple[int, int]] = set()
    for raw_scope in scopes:
        key = (int(raw_scope["year"]), int(raw_scope["round"]))
        if key in seen:
            continue
        seen.add(key)
        frame = scan_scope(
            root,
            LakeScope(key[0], key[1], uf),
            municipality_tse_code=municipality_tse_code,
            zone=zone,
            votable_ids=[item[1] for item in mappings],
        )
        office_codes = sorted(
            {int(item["officeCode"]) for item in scopes if int(item["year"]) == key[0] and int(item["round"]) == key[1]}
        )
        if office_codes:
            frame = frame.filter(pl.col("office_code").is_in(office_codes))
        parts.append(
            frame.join(mapping, on="votable_id", how="inner")
            .group_by("result_id", "candidacy_id")
            .agg(pl.col("votes").sum().alias("votes"))
            .collect()
        )
    if not parts:
        return []
    result = pl.concat(parts, how="vertical_relaxed").sort("result_id", "candidacy_id")
    return [
        {
            "resultId": int(row["result_id"]),
            "candidacyId": str(row["candidacy_id"]),
            "votes": int(row["votes"] or 0),
        }
        for row in result.iter_rows(named=True)
    ]


def result_votes(
    conn: psycopg.Connection,
    root: Path,
    *,
    result_id: int,
    uf: str,
) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT year::int, turn::int, uf::text, municipality_tse_code::text, zone::int
              FROM section_office_result WHERE id = %s AND uf = %s
            """,
            (result_id, uf.upper()),
        )
        scope = cur.fetchone()
        if scope is None:
            return []
    frame = scan_scope(
        root,
        LakeScope(int(scope[0]), int(scope[1]), str(scope[2])),
        municipality_tse_code=str(scope[3]),
        zone=int(scope[4]),
        result_ids=[result_id],
    ).select("votable_id", "votes")
    facts = frame.collect()
    if facts.is_empty():
        return []
    vote_by_votable = {int(row[0]): int(row[1]) for row in facts.iter_rows()}
    votable_ids = list(vote_by_votable)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT t.id::bigint, t.vote_kind::text, t.type_code::int, t.type_description,
                   t.number::int, t.name, t.party_number::int, t.party_acronym, t.party_name,
                   c.id::text, c.tse_candidate_id::bigint, c.person_id::text, p."Id"::text
              FROM votable t
              LEFT JOIN votable_candidacy vc ON vc.votable_id = t.id AND vc.uf = %s
              LEFT JOIN candidacy c ON c.id = vc.candidacy_id
              LEFT JOIN public."Politicians" p ON p."Id" = c.politician_id AND p."DeletedAt" IS NULL
             WHERE t.id = ANY(%s::bigint[])
             ORDER BY t.type_code, t.number, t.id
            """,
            (uf.upper(), votable_ids),
        )
        metadata = cur.fetchall()
    return [
        {
            "voteKind": str(row[1]),
            "typeCode": int(row[2]),
            "typeDescription": str(row[3]),
            "number": int(row[4]),
            "name": row[5],
            "partyNumber": int(row[6]) if row[6] is not None else None,
            "partyAcronym": row[7],
            "partyName": row[8],
            "votes": vote_by_votable[int(row[0])],
            "candidacyId": row[9],
            "tseCandidateId": int(row[10]) if row[10] is not None else None,
            "personId": row[11],
            "politicianId": row[12],
        }
        for row in metadata
    ]
