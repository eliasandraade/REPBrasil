"""Auditoria independente (somente leitura): CSV oficial do BU × banco(s) eleitoral(is).

NÃO usa o código do importador: recalcula tudo do CSV oficial com o módulo `csv`
da biblioteca padrão e compara com cada banco informado.

Por (município, zona, cargo): urnas, linhas, soma de votos, soma de aptos e de
comparecimento (uma vez por urna). Também confere as seções de amostra votável a
votável. Considera só o lote vigente (mais recente) de cada município + zona.

    python scripts/audit_electoral_cross_db.py CSV --year 2026 --turn 1 --uf CE \\
        --db repbrasil=postgresql://...  --db-schema repbrasil=electoral \\
        --db urnai=postgresql://...      --db-schema urnai=public \\
        --sample 13897:94:381 --sample 13730:120:419 --out relatorio.json

Sai com código 1 se houver QUALQUER divergência.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

import psycopg


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("csv", type=Path)
    p.add_argument("--year", type=int, required=True)
    p.add_argument("--turn", type=int, required=True)
    p.add_argument("--uf", required=True)
    p.add_argument("--db", action="append", default=[], help="nome=url (repetível)")
    p.add_argument("--db-schema", action="append", default=[], help="nome=schema (padrão electoral)")
    p.add_argument("--sample", action="append", default=[], help="municipio:zona:secao (repetível)")
    p.add_argument("--out", type=Path, default=None)
    return p.parse_args(argv)


def read_csv(path: Path, samples: set[tuple[str, int, int]]):
    agg = defaultdict(lambda: {"urns": set(), "votes": 0, "rows": 0, "eligible": {}, "turnout": {}})
    detail: dict[tuple, dict] = defaultdict(dict)
    rows = 0
    with path.open(encoding="latin-1", newline="") as fh:
        reader = csv.reader(fh, delimiter=";", quotechar='"')
        header = next(reader)
        i = {c: n for n, c in enumerate(header)}
        for f in reader:
            rows += 1
            mun, zone = f[i["CD_MUNICIPIO"]].zfill(5), int(f[i["NR_ZONA"]])
            office, section = int(f[i["CD_CARGO_PERGUNTA"]]), int(f[i["NR_SECAO"]])
            a = agg[(mun, zone, office)]
            a["urns"].add(section)
            a["votes"] += int(f[i["QT_VOTOS"]])
            a["rows"] += 1
            a["eligible"][section] = int(f[i["QT_APTOS"]])
            a["turnout"][section] = int(f[i["QT_COMPARECIMENTO"]])
            if (mun, zone, section) in samples:
                key = (mun, zone, section, office)
                d = detail[key]
                d["eligible"], d["turnout"] = int(f[i["QT_APTOS"]]), int(f[i["QT_COMPARECIMENTO"]])
                d.setdefault("votes", {})[f"{f[i['DS_TIPO_VOTAVEL']]}:{int(f[i['NR_VOTAVEL']])}"] = int(f[i["QT_VOTOS"]])
    scopes = {
        k: {"urns": len(v["urns"]), "votes": v["votes"], "rows": v["rows"],
            "eligible": sum(v["eligible"].values()), "turnout": sum(v["turnout"].values())}
        for k, v in agg.items()
    }
    return rows, scopes, dict(detail)


LATEST = """
    SELECT DISTINCT ON (r.scope->>'municipality', r.scope->>'zone') r.id
      FROM ingestion_run r JOIN open_data_source_file f ON f.id = r.source_file_id
     WHERE r.source = 'tse-open-data-bu' AND r.status = 'succeeded' AND f.year = %(y)s AND f.turn = %(t)s AND f.uf = %(uf)s
     ORDER BY r.scope->>'municipality', r.scope->>'zone', r.finished_at DESC
"""


def read_db(url: str, schema: str, year: int, turn: int, uf: str, samples: set[tuple[str, int, int]]):
    params = {"y": year, "t": turn, "uf": uf}
    with psycopg.connect(url, options=f"-c search_path={schema},public") as conn:
        scopes = {}
        for m, z, o, urns, votes, vrows, elig, turn_ in conn.execute(
            f"""
            WITH latest AS ({LATEST}),
                 res AS (SELECT s.* FROM section_office_result s JOIN latest l ON l.id = s.ingestion_run_id)
            SELECT res.municipality_tse_code, res.zone, res.office_code, count(DISTINCT res.section),
                   COALESCE(sum(v.votes), 0), count(v.id),
                   (SELECT sum(x.eligible) FROM res x WHERE x.municipality_tse_code = res.municipality_tse_code
                       AND x.zone = res.zone AND x.office_code = res.office_code),
                   (SELECT sum(x.turnout) FROM res x WHERE x.municipality_tse_code = res.municipality_tse_code
                       AND x.zone = res.zone AND x.office_code = res.office_code)
              FROM res LEFT JOIN section_office_vote v ON v.result_id = res.id
             GROUP BY res.municipality_tse_code, res.zone, res.office_code
            """,
            params,
        ):
            scopes[(m.strip(), z, o)] = {"urns": urns, "votes": int(votes), "rows": vrows,
                                         "eligible": int(elig or 0), "turnout": int(turn_ or 0)}
        cadaster = conn.execute(
            """SELECT count(DISTINCT m.id), count(*) FILTER (WHERE NOT s.is_aggregated), count(*) FILTER (WHERE s.is_aggregated)
                 FROM electoral_section s JOIN municipality m ON m.id = s.municipality_id
                 JOIN election e ON e.id = s.election_id
                WHERE m.state_code = %(uf)s AND e.year = %(y)s AND e.round = %(t)s""",
            params,
        ).fetchone()
        pairs = conn.execute(
            """SELECT count(*) FROM zone_municipality zm JOIN municipality m ON m.id = zm.municipality_id
                 JOIN election e ON e.id = zm.election_id WHERE m.state_code = %(uf)s AND e.year = %(y)s AND e.round = %(t)s""",
            params,
        ).fetchone()[0]
        detail: dict[tuple, dict] = {}
        for mun, zone, section in samples:
            for office, elig, turn_, kind_desc, number, votes in conn.execute(
                f"""WITH latest AS ({LATEST})
                    SELECT s.office_code, s.eligible, s.turnout, t.type_description, t.number, v.votes
                      FROM section_office_result s JOIN latest l ON l.id = s.ingestion_run_id
                      JOIN section_office_vote v ON v.result_id = s.id JOIN votable t ON t.id = v.votable_id
                     WHERE s.municipality_tse_code = %(m)s AND s.zone = %(z)s AND s.section = %(s)s""",
                {**params, "m": mun, "z": zone, "s": section},
            ):
                d = detail.setdefault((mun, zone, section, office), {"eligible": elig, "turnout": turn_, "votes": {}})
                d["votes"][f"{kind_desc}:{number}"] = votes
    return scopes, {"municipalities": cadaster[0], "principal": cadaster[1], "aggregated": cadaster[2], "pairs": pairs}, detail


def compare(name: str, ref: dict, other: dict) -> dict:
    missing = sorted(set(ref) - set(other))
    extra = sorted(set(other) - set(ref))
    diff = [{"key": list(k), "csv": ref[k], name: other[k]} for k in sorted(set(ref) & set(other)) if ref[k] != other[k]]
    return {"missing": [list(k) for k in missing][:50], "missing_count": len(missing),
            "extra": [list(k) for k in extra][:50], "extra_count": len(extra),
            "diff": diff[:50], "diff_count": len(diff)}


def totals(scopes: dict) -> dict:
    by_office = defaultdict(lambda: {"votes": 0, "urns": 0, "eligible": 0, "turnout": 0})
    for (_, _, o), v in scopes.items():
        for k in ("votes", "urns", "eligible", "turnout"):
            by_office[o][k] += v[k]
    return {
        "scopes": len(scopes),
        "municipalities": len({k[0] for k in scopes}),
        "zones": len({(k[0], k[1]) for k in scopes}),
        "rows": sum(v["rows"] for v in scopes.values()),
        "votes": sum(v["votes"] for v in scopes.values()),
        "urn_office": sum(v["urns"] for v in scopes.values()),
        "by_office": {str(k): v for k, v in sorted(by_office.items())},
    }


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    schemas = dict(s.split("=", 1) for s in args.db_schema)
    samples = set()
    for s in args.sample:
        mun, zone, section = s.split(":")
        samples.add((mun.zfill(5), int(zone), int(section)))
    rows, csv_scopes, csv_detail = read_csv(args.csv, samples)
    report: dict = {"csv": {"rows": rows, **totals(csv_scopes)}, "databases": {}, "ok": True}
    for spec in args.db:
        name, url = spec.split("=", 1)
        scopes, cadaster, detail = read_db(url, schemas.get(name, "electoral"), args.year, args.turn, args.uf.upper(), samples)
        cmp_scopes = compare(name, csv_scopes, scopes)
        cmp_samples = compare(name, csv_detail, detail)
        ok = not any(c[k] for c in (cmp_scopes, cmp_samples) for k in ("missing_count", "extra_count", "diff_count"))
        report["databases"][name] = {"totals": totals(scopes), "cadaster": cadaster, "scopes_vs_csv": cmp_scopes,
                                     "samples_vs_csv": {"checked": len(detail), **cmp_samples}, "ok": ok}
        report["ok"] &= ok
    names = list(report["databases"])
    for a, b in zip(names, names[1:], strict=False):
        report[f"{a}_vs_{b}_cadaster_equal"] = report["databases"][a]["cadaster"] == report["databases"][b]["cadaster"]
        report["ok"] &= report[f"{a}_vs_{b}_cadaster_equal"]
    text = json.dumps(report, ensure_ascii=False, indent=2, default=list)
    if args.out:
        args.out.write_text(text + "\n", encoding="utf-8")
    summary = {k: v for k, v in report.items() if k != "databases"}
    summary["databases"] = {n: {"ok": d["ok"], "totals": {k: d["totals"][k] for k in ("scopes", "municipalities", "zones", "rows", "votes", "urn_office")},
                                "cadaster": d["cadaster"], "samples_checked": d["samples_vs_csv"]["checked"]}
                            for n, d in report["databases"].items()}
    summary["csv"] = {k: report["csv"][k] for k in ("rows", "scopes", "municipalities", "zones", "votes", "urn_office")}
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
