"""CLI: candidaturas oficiais do TSE → schema electoral + identidade.

    python -m src.electoral.candidates.cli acquire --year 2026
    python -m src.electoral.candidates.cli import --year 2026 --turn 1 --units CE,BR
    python -m src.electoral.candidates.cli import --year 2024 --turn 1 --municipal-uf CE
    python -m src.electoral.candidates.cli backfill-history --year 2026
    python -m src.electoral.candidates.cli link-votables --year 2026 --turn 1 --uf CE
    python -m src.electoral.candidates.cli import-records --year 2024 --uf CE --kind asset --dir ../data/raw/tse/candidatos/2024

`import` exige `REPBRASIL_PERSON_DOCUMENT_KEY` (HMAC do CPF; ver docs/TSE_IDENTITY.md).
O "Histórico de candidaturas" só é publicado a partir de 2026: obrigatório nesses anos,
inexistente antes (a identidade de 2022/2024 usa CPF e os vínculos oficiais já gravados).
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

from .. import db as electoral_db
from ..cadaster.sources import (
    CadasterResourceSpec,
    acquire_resource,
    discover_resource,
    extract_member,
    find_acquired,
    load_manifest,
)
from ..open_data.layout import LayoutError, detect_csv_layout
from . import identity
from .layout import CANDIDATES_COLUMNS, CANDIDATES_PROFILE_ID, HISTORY_COLUMNS, HISTORY_PROFILE_ID
from .parser import iter_csv, parse_candidate, parse_history
from .records import (
    ASSETS_COLUMNS,
    ASSETS_PROFILE_ID,
    COMPLEMENT_COLUMNS,
    COMPLEMENT_PROFILE_ID,
    SOCIAL_COLUMNS,
    SOCIAL_COLUMNS_2022,
    SOCIAL_PROFILE_ID,
    SOCIAL_PROFILE_ID_2022,
    RecordsConflict,
    import_records,
    iter_rows,
    parse_asset,
    parse_complement,
    parse_social,
)
from .store import backfill_history, dumps, import_candidates, link_votables, select_candidacies

KIND_CANDIDATES = "tse-open-data-candidates"
KIND_HISTORY = "tse-open-data-candidacy-history"
DEFAULT_DIR = Path("../data/raw/tse/candidates")
# Primeiro ano em que o dataset `candidatos-<ano>` publica o "Histórico de candidaturas".
FIRST_HISTORY_YEAR = 2026


def candidates_spec(year: int) -> CadasterResourceSpec:
    return CadasterResourceSpec(KIND_CANDIDATES, f"candidatos-{year}", "Candidatos")


def history_spec(year: int) -> CadasterResourceSpec:
    return CadasterResourceSpec(KIND_HISTORY, f"candidatos-{year}", "Histórico de candidaturas")


KIND_ASSETS = "tse-open-data-candidate-assets"
KIND_COMPLEMENT = "tse-open-data-candidate-complement"
KIND_SOCIAL = "tse-open-data-candidate-social-network"

# Recursos do dataset `candidatos-<ano>` (nomes exatamente como publicados no CKAN).
# Redes sociais: um arquivo por UF até 2022; arquivo único a partir de 2024.
RESOURCES = ("candidates", "history", "assets", "complement", "social")


def resource_spec(kind: str, year: int, uf: str | None = None) -> CadasterResourceSpec:
    dataset = f"candidatos-{year}"
    if kind == "candidates":
        return candidates_spec(year)
    if kind == "history":
        return history_spec(year)
    if kind == "assets":
        return CadasterResourceSpec(KIND_ASSETS, dataset, "Bens de candidatos")
    if kind == "complement":
        return CadasterResourceSpec(KIND_COMPLEMENT, dataset, "Candidatos - Informações complementares")
    if kind == "social":
        if year >= 2024:
            return CadasterResourceSpec(KIND_SOCIAL, dataset, "Redes sociais de candidatos")
        if not uf:
            raise SystemExit("--uf is required for social networks up to 2022 (one official file per UF)")
        return CadasterResourceSpec(KIND_SOCIAL, dataset, f"{uf.upper()} - Redes sociais de candidatos")
    raise SystemExit(f"unknown resource {kind!r}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="repbrasil-electoral-candidates")
    sub = parser.add_subparsers(dest="command", required=True)

    acquire = sub.add_parser("acquire", help="download official files of the candidatos-<year> dataset (content-addressed)")
    acquire.add_argument("--year", type=int, required=True)
    acquire.add_argument("--out", type=Path, default=DEFAULT_DIR)
    acquire.add_argument(
        "--resource", action="append", choices=RESOURCES, default=None,
        help="repeatable; default: candidates + history (the history resource is published from 2026 on)",
    )
    acquire.add_argument("--uf", default=None, help="UF of per-state resources (social networks up to 2022)")

    imp = sub.add_parser("import", help="import contests and candidacies of the given electoral units and resolve identity")
    imp.add_argument("--year", type=int, required=True)
    imp.add_argument("--turn", type=int, required=True)
    imp.add_argument("--units", default="", help="comma-separated SG_UE values, e.g. CE,BR (state/federal contests)")
    imp.add_argument(
        "--municipal-uf", action="append", default=[],
        help="repeatable: every municipal contest (all municipalities) of this UF, read from consulta_cand_<year>_<UF>.csv",
    )
    imp.add_argument("--dir", type=Path, default=DEFAULT_DIR, help="acquired files root")
    imp.add_argument("--candidates", type=Path, default=None, help="acquired candidates directory (default: the only one under --dir)")
    imp.add_argument(
        "--history", type=Path, default=None,
        help=f"acquired candidacy-history directory (default: the only one under --dir; required from {FIRST_HISTORY_YEAR}, not published before)",
    )
    imp.add_argument("--supersede", action="store_true", help="apply a newer official file that changes stored candidacies (diff recorded)")
    imp.add_argument("--dry-run", action="store_true", help="parse and validate only; never touch the database")
    imp.add_argument("--database-url", default=None, help="defaults to $DATABASE_URL")
    imp.add_argument("--report", type=Path, default=None, help="write the full JSON report here (stdout gets a summary)")

    backfill = sub.add_parser(
        "backfill-history", help="persist the official candidacy history of an already-imported year (identity facts only)"
    )
    backfill.add_argument("--year", type=int, required=True)
    backfill.add_argument("--dir", type=Path, default=DEFAULT_DIR, help="acquired files root")
    backfill.add_argument("--history", type=Path, default=None, help="acquired candidacy-history directory (default: the only one under --dir)")
    backfill.add_argument("--database-url", default=None, help="defaults to $DATABASE_URL")
    backfill.add_argument("--report", type=Path, default=None, help="write the full JSON report here (stdout gets a summary)")

    records = sub.add_parser(
        "import-records", help="import declared assets, complementary data or social networks of one UF/year (sanitized)"
    )
    records.add_argument("--year", type=int, required=True)
    records.add_argument("--uf", required=True, help="UF of the official CSV (BR = federal candidacies)")
    records.add_argument("--kind", required=True, choices=("asset", "complement", "social_network"))
    records.add_argument("--dir", type=Path, default=DEFAULT_DIR, help="acquired files root")
    records.add_argument("--source", type=Path, default=None, help="acquired directory (default: the only one of the kind under --dir)")
    records.add_argument("--supersede", action="store_true", help="apply a newer official file that changes stored records")
    records.add_argument("--dry-run", action="store_true", help="parse and validate only; never touch the database")
    records.add_argument("--database-url", default=None, help="defaults to $DATABASE_URL")
    records.add_argument("--report", type=Path, default=None, help="write the full JSON report here (stdout gets a summary)")

    link = sub.add_parser("link-votables", help="link BU votables of one UF to official candidacies (no vote table is changed)")
    link.add_argument("--year", type=int, required=True)
    link.add_argument("--turn", type=int, required=True)
    link.add_argument("--uf", required=True)
    link.add_argument("--database-url", default=None, help="defaults to $DATABASE_URL")
    link.add_argument("--report", type=Path, default=None, help="write the full JSON report here (stdout gets a summary)")
    return parser


def _database_url(args: argparse.Namespace) -> str:
    url = args.database_url or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL (or --database-url) is required")
    return url


def _members(manifest: dict, pattern: str) -> list[dict]:
    regex = re.compile(pattern)
    names = sorted(m["name"] for m in manifest["zip_members"] if regex.fullmatch(m["name"]))
    return [extract_member(manifest, re.escape(n)) for n in names]


def summarize(value):
    """Resumo para stdout: listas viram contagens (`<campo>_count`); o relatório completo vai para --report.
    Evita despejar centenas de objetos nos logs da plataforma."""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if isinstance(v, list):
                out[f"{k}_count"] = len(v)
            else:
                out[k] = summarize(v)
        return out
    return value


def _emit(report_path: Path | None, report: dict) -> None:
    if report_path is not None:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(dumps(report) + "\n", encoding="utf-8")
    print(dumps(summarize(report)))


def _load_history(args: argparse.Namespace):
    """(linhas, manifesto, layout) do histórico oficial do ano, ou (None, None, None) antes de 2026."""
    if args.history is None and args.year < FIRST_HISTORY_YEAR:
        return None, None, None
    manifest = load_manifest(args.history or find_acquired(args.dir, kind=KIND_HISTORY, year=args.year), kind=KIND_HISTORY)
    history, layout = [], None
    for member in _members(manifest, rf"historico_candidatura_{args.year}_[A-Z]{{2}}\.csv"):
        layout = detect_csv_layout(member["path"], columns=HISTORY_COLUMNS, profile_id=HISTORY_PROFILE_ID)
        history.extend(parse_history(f, line, layout.columns, member["name"]) for line, f in iter_csv(member["path"], layout))
    if layout is None:
        raise SystemExit("no historico_candidatura CSV found in the acquired history ZIP")
    return history, manifest, layout


RECORD_KINDS = {
    "asset": (KIND_ASSETS, "bem_candidato_{year}_{uf}.csv"),
    "complement": (KIND_COMPLEMENT, "consulta_cand_complementar_{year}_{uf}.csv"),
    "social_network": (KIND_SOCIAL, "rede_social_candidato_{year}_{uf}.csv"),
}


def _import_records(args: argparse.Namespace) -> int:
    uf = args.uf.upper()
    kind_name, pattern = RECORD_KINDS[args.kind]
    manifest = load_manifest(args.source or find_acquired(args.dir, kind=kind_name, year=args.year), kind=kind_name)
    (member,) = _members(manifest, re.escape(pattern.format(year=args.year, uf=uf))) or [None]
    if member is None:
        raise SystemExit(f"{pattern.format(year=args.year, uf=uf)} not found in the acquired ZIP")
    path = member["path"]
    if args.kind == "asset":
        layout = detect_csv_layout(path, columns=ASSETS_COLUMNS, profile_id=ASSETS_PROFILE_ID)
        rows = [parse_asset(f, line, layout.columns, member["name"]) for line, f in iter_rows(path, layout)]
        dropped = 0
    elif args.kind == "complement":
        layout = detect_csv_layout(path, columns=COMPLEMENT_COLUMNS, profile_id=COMPLEMENT_PROFILE_ID)
        rows = [parse_complement(f, line, layout.columns, member["name"], uf) for line, f in iter_rows(path, layout)]
        dropped = 0
    else:
        try:
            layout = detect_csv_layout(path, columns=SOCIAL_COLUMNS, profile_id=SOCIAL_PROFILE_ID)
        except LayoutError:
            layout = detect_csv_layout(path, columns=SOCIAL_COLUMNS_2022, profile_id=SOCIAL_PROFILE_ID_2022)
        parsed = [parse_social(f, line, layout.columns, member["name"]) for line, f in iter_rows(path, layout)]
        rows = [r for r in parsed if r is not None]
        dropped = len(parsed) - len(rows)
    if args.dry_run:
        _emit(args.report, {
            "status": "dry_run", "kind": args.kind, "file": {k: member[k] for k in ("name", "size", "sha256")},
            "layout": layout.profile, "rows": len(rows), "dropped_personal_contact": dropped,
            "candidacies": len({r.tse_candidate_id for r in rows}),
            "election_codes": sorted({str(r.election_code) for r in rows}),
        })
        return 0
    try:
        with electoral_db.connect(_database_url(args), autocommit=True) as conn:
            _emit(args.report, import_records(
                conn, year=args.year, uf=uf, kind=args.kind, rows=rows, manifest=manifest, layout=layout,
                supersede=args.supersede, dropped_rows=dropped,
            ))
    except RecordsConflict as exc:
        _emit(args.report, {"status": "conflict", "detail": str(exc), "diff": exc.diff})
        return 4
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.command == "acquire":
        from ..http_client import TSEHttpClient
        from ..open_data.acquire import HttpStreamSource

        client = TSEHttpClient()
        try:
            kinds = args.resource or ["candidates", "history"]
            resources = [discover_resource(client, resource_spec(k, args.year, args.uf)) for k in kinds]
        finally:
            client.close()
        source = HttpStreamSource()
        try:
            acquired = [acquire_resource(r, args.out, source=source) for r in resources]
        finally:
            source.close()
        print(dumps([{**a.manifest, "reused": a.reused, "manifest_path": str(a.manifest_path)} for a in acquired]))
        return 0

    if args.command == "import":
        units = {u.strip().upper() for u in args.units.split(",") if u.strip()}
        municipal_ufs = {u.strip().upper() for u in args.municipal_uf if u.strip()}
        if not units and not municipal_ufs:
            raise SystemExit("pass --units and/or --municipal-uf")
        cand_manifest = load_manifest(args.candidates or find_acquired(args.dir, kind=KIND_CANDIDATES, year=args.year), kind=KIND_CANDIDATES)

        candidates, cand_layout, files = [], None, []
        for unit in sorted(units | municipal_ufs):
            (member,) = _members(cand_manifest, rf"consulta_cand_{args.year}_{unit}\.csv") or [None]
            if member is None:
                raise SystemExit(f"consulta_cand_{args.year}_{unit}.csv not found in the acquired candidates ZIP")
            cand_layout = detect_csv_layout(member["path"], columns=CANDIDATES_COLUMNS, profile_id=CANDIDATES_PROFILE_ID)
            files.append({k: member[k] for k in ("name", "size", "sha256")})
            candidates.extend(
                parse_candidate(f, line, cand_layout.columns, member["name"]) for line, f in iter_csv(member["path"], cand_layout)
            )

        history, hist_manifest, hist_layout = _load_history(args)

        if args.dry_run:
            selected, other_turns, other_elections = select_candidacies(
                candidates, year=args.year, turn=args.turn, units=units, municipal_ufs=municipal_ufs
            )
            checks: dict[str, int] = {}
            for r in selected:
                status = identity.check_cpf(r.cpf_raw).status
                checks[status] = checks.get(status, 0) + 1
            keys = [(r.election_code, r.office_code, r.electoral_unit, r.tse_candidate_id) for r in selected]
            current = {r.tse_candidate_id for r in selected}
            by_office: dict[str, int] = {}
            for r in selected:
                by_office[f"{r.office_code} {r.office_name}"] = by_office.get(f"{r.office_code} {r.office_name}", 0) + 1
            _emit(args.report, {
                "status": "dry_run", "files": files, "rows_parsed": len(candidates), "candidacies": len(selected),
                "other_turn_rows": {str(t): n for t, n in sorted(other_turns.items())},
                "other_election_rows": dict(sorted(other_elections.items())),
                "duplicate_candidacies": len(keys) - len(set(keys)),
                "contests": len({k[:3] for k in keys}),
                "electoral_units": len({r.electoral_unit for r in selected}),
                "by_office": dict(sorted(by_office.items())),
                "election_dates": sorted({r.election_date or "" for r in selected}),
                "identity": checks,
                "history": "absent" if history is None else len(history),
                "history_rows_for_selected": sum(
                    1 for h in history or [] if h.current_year == args.year and h.current_tse_candidate_id in current
                ),
            })
            return 0
        key = identity.load_key()
        with electoral_db.connect(_database_url(args), autocommit=True) as conn:
            _emit(args.report, import_candidates(
                conn, year=args.year, turn=args.turn, units=units, candidates=candidates,
                candidates_manifest=cand_manifest, candidates_layout=cand_layout,
                history=history, history_manifest=hist_manifest, history_layout=hist_layout,
                key=key, supersede=args.supersede, municipal_ufs=municipal_ufs,
            ))
        return 0

    if args.command == "backfill-history":
        history, hist_manifest, hist_layout = _load_history(args)
        if history is None:
            raise SystemExit(f"no candidacy history for {args.year}")
        with electoral_db.connect(_database_url(args), autocommit=True) as conn:
            _emit(args.report, backfill_history(
                conn, year=args.year, history=history, history_manifest=hist_manifest, history_layout=hist_layout,
            ))
        return 0

    if args.command == "import-records":
        return _import_records(args)

    if args.command == "link-votables":
        with electoral_db.connect(_database_url(args), autocommit=True) as conn:
            _emit(args.report, link_votables(conn, year=args.year, turn=args.turn, uf=args.uf))
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
