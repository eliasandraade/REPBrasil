"""Auditoria de uma eleição importada: fonte oficial × banco, divergências classificadas.

Para (ano, turno, UF), compara:
- Boletim de Urna: o CSV oficial inteiro (linhas e votos por município × zona × cargo × tipo de voto)
  contra os lotes VIGENTES do banco;
- cadastro: zonas esperadas × zonas com BU importado; seções principais × urnas no BU;
- candidaturas: linhas selecionáveis do arquivo de candidatos × candidaturas gravadas;
- vínculo votável → candidatura: o último lote de vínculo da UF (sem vínculo, ambíguo, nome divergente).

Classificação (nunca "corrige" nada):
- expected: diferença prevista pela regra da fonte (seções agregadas sem urna própria, vices e
  suplentes sem voto próprio, eleições suplementares fora do pleito, 2º turno só onde houve);
- ambiguous: mais de uma candidatura possível para um votável (nenhum vínculo é feito);
- source_divergence: as fontes oficiais discordam (nome de urna diferente; número sem candidatura);
- missing: o banco não tem algo que a fonte tem (zona sem lote, candidatura não importada);
- integrity_error: banco e fonte discordam sobre o MESMO recorte importado (votos/linhas).
"""

from __future__ import annotations

import csv
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import psycopg

from .open_data.layout import DetectedLayout, detect_layout
from .open_data.parser import _IDX

# CD_TIPO_VOTAVEL do BU → tipo de voto do banco
VOTE_KIND = {1: "candidate", 2: "blank", 3: "null", 4: "party_legend"}


def scan_bu_csv(csv_path: Path, layout: DetectedLayout | None = None) -> dict[tuple[str, int, int], dict[str, int]]:
    """Totais da fonte por (município, zona, cargo): linhas, votos por tipo e seções (urnas)."""
    layout = layout or detect_layout(csv_path)
    i_mun, i_zone, i_section = _IDX["CD_MUNICIPIO"], _IDX["NR_ZONA"], _IDX["NR_SECAO"]
    i_office, i_kind, i_votes = _IDX["CD_CARGO_PERGUNTA"], _IDX["CD_TIPO_VOTAVEL"], _IDX["QT_VOTOS"]
    totals: dict[tuple[str, int, int], dict[str, int]] = defaultdict(lambda: defaultdict(int))
    sections: dict[tuple[str, int, int], set[int]] = defaultdict(set)
    with csv_path.open("r", encoding=layout.encoding, newline="") as fh:
        reader = csv.reader(fh, delimiter=layout.delimiter, quotechar=layout.quotechar, strict=True)
        next(reader)
        for f in reader:
            key = (f[i_mun].strip().zfill(5), int(f[i_zone]), int(f[i_office]))
            t = totals[key]
            t["rows"] += 1
            kind = VOTE_KIND.get(int(f[i_kind]), "other")
            t[f"votes_{kind}"] += int(f[i_votes])
            sections[key].add(int(f[i_section]))
    for key, secs in sections.items():
        totals[key]["urns"] = len(secs)
    return {k: dict(v) for k, v in totals.items()}


def db_bu_totals(conn: psycopg.Connection, *, year: int, turn: int, uf: str) -> dict[tuple[str, int, int], dict[str, int]]:
    """Totais dos lotes VIGENTES por (município, zona, cargo): urnas, linhas e votos por tipo."""
    latest = """WITH latest AS (SELECT ingestion_run_id FROM latest_bu_ingestion_run WHERE year = %s AND turn = %s AND uf = %s)"""
    totals: dict[tuple[str, int, int], dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for mun, zone, office, urns in conn.execute(
        f"""{latest}
        SELECT r.municipality_tse_code::text, r.zone, r.office_code, count(*)
          FROM section_office_result r JOIN latest l ON l.ingestion_run_id = r.ingestion_run_id
         GROUP BY 1, 2, 3""",
        (year, turn, uf),
    ).fetchall():
        totals[(mun, int(zone), int(office))]["urns"] = int(urns)
    for mun, zone, office, kind, rows, votes in conn.execute(
        f"""{latest}
        SELECT r.municipality_tse_code::text, r.zone, r.office_code, t.vote_kind::text, count(*), sum(v.votes)
          FROM section_office_result r JOIN latest l ON l.ingestion_run_id = r.ingestion_run_id
          JOIN section_office_vote v ON v.result_id = r.id
          JOIN votable t ON t.id = v.votable_id
         GROUP BY 1, 2, 3, 4""",
        (year, turn, uf),
    ).fetchall():
        t = totals[(mun, int(zone), int(office))]
        t["rows"] += int(rows)
        t[f"votes_{kind}"] += int(votes)
    return {k: dict(v) for k, v in totals.items()}


def expected_zones(conn: psycopg.Connection, *, year: int, turn: int, uf: str) -> set[tuple[str, int]]:
    rows = conn.execute(
        """SELECT m.tse_code::text, z.zone_number FROM zone_municipality zm
             JOIN election e ON e.id = zm.election_id JOIN municipality m ON m.id = zm.municipality_id
             JOIN electoral_zone z ON z.id = zm.zone_id
            WHERE e.year = %s AND e.round = %s AND m.state_code = %s""",
        (year, turn, uf),
    ).fetchall()
    return {(r[0], int(r[1])) for r in rows}


def principal_sections(conn: psycopg.Connection, *, year: int, turn: int, uf: str) -> dict[tuple[str, int], int]:
    rows = conn.execute(
        """SELECT m.tse_code::text, z.zone_number, count(*) FILTER (WHERE NOT s.is_aggregated), count(*) FILTER (WHERE s.is_aggregated)
             FROM electoral_section s JOIN election e ON e.id = s.election_id
             JOIN municipality m ON m.id = s.municipality_id JOIN electoral_zone z ON z.id = s.zone_id
            WHERE e.year = %s AND e.round = %s AND m.state_code = %s GROUP BY 1, 2""",
        (year, turn, uf),
    ).fetchall()
    return {(r[0], int(r[1])): int(r[2]) for r in rows}


def audit_election(
    conn: psycopg.Connection,
    *,
    year: int,
    turn: int,
    uf: str,
    bu_csv: Path | None,
    candidate_counts: dict[int, int] | None = None,
    other_election_rows: int = 0,
) -> dict[str, Any]:
    """Relatório completo. `candidate_counts` = linhas selecionáveis do arquivo de candidatos por cargo."""
    uf = uf.upper()
    divergences: dict[str, list[dict[str, Any]]] = {k: [] for k in ("expected", "ambiguous", "source_divergence", "missing", "integrity_error")}
    report: dict[str, Any] = {"year": year, "turn": turn, "uf": uf}

    # ── cadastro × lotes do BU
    zones = expected_zones(conn, year=year, turn=turn, uf=uf)
    db = db_bu_totals(conn, year=year, turn=turn, uf=uf)
    imported = {(k[0], k[1]) for k in db}
    report["cadaster"] = {"zones_expected": len(zones), "zones_with_bu": len(imported & zones)}
    for mun, zone in sorted(zones - imported):
        divergences["missing"].append({"kind": "zone_without_bu", "municipality": mun, "zone": zone})
    for mun, zone in sorted(imported - zones):
        divergences["integrity_error"].append({"kind": "bu_zone_outside_cadaster", "municipality": mun, "zone": zone})

    principals = principal_sections(conn, year=year, turn=turn, uf=uf)
    urns_by_zone: dict[tuple[str, int], int] = Counter()
    for (mun, zone, _), t in db.items():
        urns_by_zone[(mun, zone)] = max(urns_by_zone[(mun, zone)], t.get("urns", 0))
    for key in sorted(imported & zones):
        if urns_by_zone[key] != principals.get(key, 0):
            divergences["integrity_error"].append(
                {"kind": "urns_differ_from_principal_sections", "municipality": key[0], "zone": key[1],
                 "bu_urns": urns_by_zone[key], "cadaster_principal_sections": principals.get(key, 0)})

    # ── fonte × banco (CSV oficial inteiro)
    totals_by_office: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    if bu_csv is not None:
        source = scan_bu_csv(bu_csv)
        for key, t in sorted(source.items()):
            for k, v in t.items():
                totals_by_office[key[2]][f"source_{k}"] += v
            stored = db.get(key)
            if stored is None:
                if (key[0], key[1]) not in imported:
                    continue  # zona inteira já listada como "missing"
                divergences["integrity_error"].append({"kind": "office_missing_in_imported_zone", "scope": list(key)})
                continue
            diff = {k: [v, stored.get(k, 0)] for k, v in t.items() if stored.get(k, 0) != v}
            if diff:
                divergences["integrity_error"].append({"kind": "source_db_mismatch", "scope": list(key), "diff": diff})
        for key in sorted(set(db) - set(source)):
            divergences["integrity_error"].append({"kind": "db_scope_not_in_source", "scope": list(key)})
    for key, t in db.items():
        for k, v in t.items():
            totals_by_office[key[2]][f"db_{k}"] += v
    report["bu_by_office"] = {str(k): dict(v) for k, v in sorted(totals_by_office.items())}

    # ── seções agregadas (esperado: sem urna própria)
    aggregated = conn.execute(
        """SELECT count(*) FROM electoral_section s JOIN election e ON e.id = s.election_id
             JOIN municipality m ON m.id = s.municipality_id
            WHERE e.year = %s AND e.round = %s AND m.state_code = %s AND s.is_aggregated""",
        (year, turn, uf),
    ).fetchone()[0]
    if aggregated:
        divergences["expected"].append({"kind": "aggregated_sections_without_own_urn", "count": int(aggregated)})

    # ── candidaturas
    stored = conn.execute(
        """SELECT k.office_code, count(*), count(*) FILTER (WHERE EXISTS (SELECT 1 FROM votable_candidacy vc WHERE vc.candidacy_id = c.id))
             FROM candidacy c JOIN contest k ON k.id = c.contest_id JOIN election e ON e.id = k.election_id
            WHERE e.year = %s AND e.round = %s AND (k.scope = 'federal' OR k.uf = %s)
            GROUP BY 1 ORDER BY 1""",
        (year, turn, uf),
    ).fetchall()
    report["candidacies_by_office"] = {str(o): {"db": int(n), "linked_to_bu": int(linked)} for o, n, linked in stored}
    for office, row in report["candidacies_by_office"].items():
        if int(office) in (2, 4, 9, 10, 12):
            divergences["expected"].append({"kind": "ticket_members_without_own_votes", "office": int(office), "count": row["db"]})
    if candidate_counts is not None:
        for office, n in sorted(candidate_counts.items()):
            db_n = report["candidacies_by_office"].get(str(office), {}).get("db", 0)
            report["candidacies_by_office"].setdefault(str(office), {})["source"] = n
            if db_n != n:
                divergences["missing" if db_n < n else "integrity_error"].append(
                    {"kind": "candidacies_count", "office": office, "source": n, "db": db_n})
    if other_election_rows:
        divergences["expected"].append({"kind": "supplementary_election_rows_skipped", "count": other_election_rows})

    # ── vínculo votável → candidatura (último lote da UF)
    link = conn.execute(
        """SELECT r.stats FROM ingestion_run r JOIN election e ON e.id = r.election_id
            WHERE r.source = 'electoral-identity-link' AND r.status = 'succeeded'
              AND e.year = %s AND e.round = %s AND r.scope->>'uf' = %s
            ORDER BY r.finished_at DESC LIMIT 1""",
        (year, turn, uf),
    ).fetchone()
    if link:
        stats = link[0]
        report["link"] = {k: stats.get(k) for k in ("votables", "linked", "already_linked", "unmatched", "ambiguous", "name_mismatch")}
        if stats.get("ambiguous"):
            divergences["ambiguous"].append({"kind": "votable_link_ambiguous", "count": stats["ambiguous"]})
        if stats.get("name_mismatch"):
            divergences["source_divergence"].append({"kind": "ballot_name_differs_between_bu_and_candidates", "count": stats["name_mismatch"]})
        if stats.get("unmatched"):
            divergences["source_divergence"].append({"kind": "bu_number_without_candidacy", "count": stats["unmatched"]})
    else:
        divergences["missing"].append({"kind": "votable_link_not_run"})

    report["divergences"] = divergences
    report["summary"] = {k: len(v) for k, v in divergences.items()}
    report["status"] = "integrity_error" if divergences["integrity_error"] else "ok"
    return report


def to_markdown(report: dict[str, Any]) -> str:
    lines = [
        f"# Auditoria — {report['uf']} {report['year']} · {report['turn']}º turno",
        "",
        f"Status: **{report['status']}** · divergências: "
        + ", ".join(f"{k} {v}" for k, v in report["summary"].items()),
        "",
        f"Cadastro: {report['cadaster']['zones_with_bu']} de {report['cadaster']['zones_expected']} zonas com Boletim de Urna importado.",
        "",
        "| Cargo | Urnas (fonte/banco) | Linhas (fonte/banco) | Votos nominais (fonte/banco) | Legenda | Brancos | Nulos |",
        "|---|---|---|---|---|---|---|",
    ]
    def pair(t: dict[str, int], k: str) -> str:
        return f"{t.get('source_' + k, '—')} / {t.get('db_' + k, 0)}"

    for office, t in report["bu_by_office"].items():
        cells = " | ".join(pair(t, k) for k in ("urns", "rows", "votes_candidate", "votes_party_legend", "votes_blank", "votes_null"))
        lines.append(f"| {office} | {cells} |")
    lines += ["", "| Cargo | Candidaturas (fonte/banco) | Com vínculo ao BU |", "|---|---|---|"]
    for office, row in report["candidacies_by_office"].items():
        lines.append(f"| {office} | {row.get('source', '—')} / {row.get('db', 0)} | {row.get('linked_to_bu', 0)} |")
    if report.get("link"):
        lines += ["", "Vínculo votável → candidatura: " + ", ".join(f"{k} {v}" for k, v in report["link"].items())]
    lines += ["", "## Divergências classificadas", ""]
    for kind, items in report["divergences"].items():
        lines.append(f"### {kind} ({len(items)})")
        for item in items[:30]:
            lines.append(f"- {item}")
        if len(items) > 30:
            lines.append(f"- … e mais {len(items) - 30}")
        lines.append("")
    return "\n".join(lines) + "\n"
