"""Invariantes eleitorais (somente leitura) para auditoria em qualquer ambiente.

    python scripts/electoral_invariants.py --year 2026 --turn 1 --uf CE [--baseline] [--report FILE]

Imprime um resumo JSON curto (contagens). Com --baseline, sai com código 1 se os números do
cadastro/BU divergirem do baseline auditado do CE 2026 1º turno. Nunca lê nem imprime CPF ou
hash de documento: só IDs públicos do TSE e contagens.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import psycopg

# Baseline imutável auditado (CSV oficial × banco × banco de referência).
BASELINE_CE_2026_1 = {
    "municipalities": 184,
    "municipality_zone": 205,
    "sections_total": 25650,
    "principal_sections": 23765,
    "aggregated_sections": 1885,
    "section_office_result": 118825,
    "section_office_vote": 2751489,
    "votes": 35438081,
}


def collect(conn: psycopg.Connection, year: int, turn: int, uf: str) -> dict:
    p = {"y": year, "t": turn, "uf": uf}
    one = lambda sql: conn.execute(sql, p).fetchone()  # noqa: E731
    votes = one("""SELECT count(DISTINCT r.id), count(v.id), COALESCE(sum(v.votes), 0)
                     FROM section_office_result r LEFT JOIN section_office_vote v ON v.result_id = r.id
                    WHERE r.year = %(y)s AND r.turn = %(t)s AND r.uf = %(uf)s""")
    cad = one("""SELECT count(DISTINCT s.municipality_id), count(*), count(*) FILTER (WHERE NOT s.is_aggregated),
                        count(*) FILTER (WHERE s.is_aggregated)
                   FROM electoral_section s JOIN municipality m ON m.id = s.municipality_id
                   JOIN election e ON e.id = s.election_id
                  WHERE m.state_code = %(uf)s AND e.year = %(y)s AND e.round = %(t)s""")
    pairs = one("""SELECT count(*) FROM zone_municipality zm JOIN municipality m ON m.id = zm.municipality_id
                     JOIN election e ON e.id = zm.election_id
                    WHERE m.state_code = %(uf)s AND e.year = %(y)s AND e.round = %(t)s""")[0]
    out = {
        "municipalities": cad[0], "municipality_zone": pairs, "sections_total": cad[1],
        "principal_sections": cad[2], "aggregated_sections": cad[3],
        "section_office_result": votes[0], "section_office_vote": votes[1], "votes": int(votes[2]),
    }
    cand = one("""SELECT count(*), count(DISTINCT c.contest_id), count(DISTINCT c.person_id), count(DISTINCT c.politician_id),
                         count(*) FILTER (WHERE c.identity_status <> 'resolved'),
                         count(*) FILTER (WHERE c.person_id IS NOT NULL AND NOT EXISTS
                                          (SELECT 1 FROM "Persons" p WHERE p."Id" = c.person_id)),
                         count(*) FILTER (WHERE c.politician_id IS NOT NULL AND NOT EXISTS
                                          (SELECT 1 FROM "Politicians" p WHERE p."Id" = c.politician_id AND p."DeletedAt" IS NULL))
                    FROM candidacy c JOIN contest k ON k.id = c.contest_id JOIN election e ON e.id = k.election_id
                   WHERE e.year = %(y)s AND e.round = %(t)s AND k.electoral_unit IN ('BR', %(uf)s)""")
    dup = one("""SELECT count(*) FROM (
                       SELECT c.contest_id, c.tse_candidate_id
                         FROM candidacy c JOIN contest k ON k.id = c.contest_id JOIN election e ON e.id = k.election_id
                        WHERE e.year = %(y)s AND e.round = %(t)s AND k.electoral_unit IN ('BR', %(uf)s)
                        GROUP BY 1, 2 HAVING count(*) > 1
                     ) x""")[0]
    out["candidacies"] = {
        "total": cand[0], "contests": cand[1], "persons_linked": cand[2], "politicians_linked": cand[3],
        "identity_unresolved": cand[4], "dangling_person": cand[5], "dangling_politician": cand[6],
        "duplicated_sq_per_contest": dup,
    }
    nominal = conn.execute(
        """SELECT v.id, v.office_code, v.number, v.name,
                  EXISTS (SELECT 1 FROM votable_candidacy vc WHERE vc.votable_id = v.id AND vc.uf = %(uf)s) AS linked
             FROM votable v
            WHERE v.uf = %(uf)s AND v.vote_kind = 'candidate'
              AND EXISTS (SELECT 1 FROM section_office_vote sv JOIN section_office_result r ON r.id = sv.result_id
                           WHERE sv.votable_id = v.id AND r.year = %(y)s AND r.turn = %(t)s AND r.uf = %(uf)s)""",
        p,
    ).fetchall()
    out["votables"] = {
        "nominal": len(nominal), "linked": sum(1 for x in nominal if x[4]),
        "unlinked": sorted(f"{x[1]}:{x[2]} {x[3]}" for x in nominal if not x[4]),
    }
    president = conn.execute(
        """SELECT t.number, t.name, t.party_acronym, sum(v.votes)::bigint,
                  c.tse_candidate_id, c.person_id IS NOT NULL, c.politician_id
             FROM section_office_result r JOIN section_office_vote v ON v.result_id = r.id
             JOIN votable t ON t.id = v.votable_id
             LEFT JOIN votable_candidacy vc ON vc.votable_id = t.id AND vc.uf = r.uf
             LEFT JOIN candidacy c ON c.id = vc.candidacy_id
            WHERE r.year = %(y)s AND r.turn = %(t)s AND r.uf = %(uf)s AND r.office_code = 1 AND t.vote_kind = 'candidate'
            GROUP BY 1, 2, 3, 5, 6, 7 ORDER BY 4 DESC""",
        p,
    ).fetchall()
    out["president"] = [
        {"number": n, "ballot_name": name, "party": party, "bu_votes": int(votes_), "tse_candidate_id": sq,
         "person_resolved": bool(person), "politician_id": str(pol) if pol else None}
        for n, name, party, votes_, sq, person, pol in president
    ]
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--year", type=int, required=True)
    ap.add_argument("--turn", type=int, required=True)
    ap.add_argument("--uf", required=True)
    ap.add_argument("--baseline", action="store_true", help="exit 1 if the CE 2026 1st-round baseline differs")
    ap.add_argument("--report", type=Path, default=None)
    ap.add_argument("--database-url", default=None, help="defaults to $DATABASE_URL")
    args = ap.parse_args(argv)
    url = args.database_url or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL (or --database-url) is required")
    with psycopg.connect(url, options="-c search_path=electoral,public") as conn:
        conn.read_only = True
        out = collect(conn, args.year, args.turn, args.uf.upper())
    mismatch = {k: [v, out[k]] for k, v in BASELINE_CE_2026_1.items() if out[k] != v} if args.baseline else {}
    out["baseline"] = "not_checked" if not args.baseline else ("ok" if not mismatch else {"mismatch": mismatch})
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False))
    return 1 if mismatch else 0


if __name__ == "__main__":
    sys.exit(main())
