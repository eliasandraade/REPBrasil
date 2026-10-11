from __future__ import annotations

from pathlib import Path
from typing import Any

import polars as pl
import psycopg

from .lake import LakeScope, scan_scope
from .lake_query import valid_votes_by_result
from .lake_results import scan_results


def section_results(
    conn: psycopg.Connection,
    root: Path,
    *,
    scopes: list[dict[str, Any]],
    uf: str,
    municipality_tse_code: str,
    zone: int | None = None,
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    seen: set[tuple[int, int]] = set()
    for raw in scopes:
        key = (int(raw["year"]), int(raw["round"]))
        if key in seen:
            continue
        seen.add(key)
        office_codes = sorted(
            {
                int(item["officeCode"])
                for item in scopes
                if int(item["year"]) == key[0] and int(item["round"]) == key[1]
            }
        )
        frame = scan_results(
            root,
            LakeScope(key[0], key[1], uf),
            municipality_tse_code=municipality_tse_code,
            zone=zone,
            office_codes=office_codes,
        ).collect()
        valid = {
            int(item["resultId"]): int(item["validVotes"])
            for item in valid_votes_by_result(
                conn,
                root,
                year=key[0],
                turn=key[1],
                uf=uf,
                municipality_tse_code=municipality_tse_code,
                office_codes=office_codes,
                zone=zone,
            )
        }
        for row in frame.iter_rows(named=True):
            section = int(row["section"])
            aggregated = [int(value) for value in (row["aggregated_sections"] or [])]
            output.append(
                {
                    "resultId": int(row["result_id"]),
                    "year": int(row["year"]),
                    "round": int(row["turn"]),
                    "officeCode": int(row["office_code"]),
                    "uf": str(row["uf"]),
                    "municipalityTseCode": str(row["municipality_tse_code"]),
                    "municipalityName": row["municipality_name"],
                    "zone": int(row["zone"]),
                    "section": section,
                    "sectionMembers": sorted({section, *aggregated}),
                    "pollingPlaceCode": str(row["polling_place_code"]) if row["polling_place_code"] is not None else None,
                    "eligible": int(row["eligible"]) if row["eligible"] is not None else None,
                    "turnout": int(row["turnout"]) if row["turnout"] is not None else None,
                    "validVotes": valid.get(int(row["result_id"]), 0),
                }
            )
    output.sort(key=lambda item: (item["year"], item["round"], item["officeCode"], item["zone"], item["section"], item["resultId"]))
    return output


def _find_result(root: Path, result_id: int, uf: str) -> dict[str, Any] | None:
    base = root / "electoral"
    for path in sorted(base.glob(f"year=*/turn=*/uf={uf.upper()}/results.parquet")):
        rows = pl.scan_parquet(path).filter(pl.col("result_id") == int(result_id)).limit(1).collect()
        if not rows.is_empty():
            return dict(rows.iter_rows(named=True).__next__())
    return None


def result_votes_from_archive(
    conn: psycopg.Connection,
    root: Path,
    *,
    result_id: int,
    uf: str,
) -> list[dict[str, Any]]:
    result = _find_result(root, result_id, uf)
    if result is None:
        return []
    frame = scan_scope(
        root,
        LakeScope(int(result["year"]), int(result["turn"]), str(result["uf"])),
        municipality_tse_code=str(result["municipality_tse_code"]),
        zone=int(result["zone"]),
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
