"""CLI: candidaturas oficiais do TSE → schema electoral + identidade.

    python -m src.electoral.candidates.cli acquire --year 2026
    python -m src.electoral.candidates.cli import --year 2026 --turn 1 --units CE,BR
    python -m src.electoral.candidates.cli link-votables --year 2026 --turn 1 --uf CE

`import` exige `REPBRASIL_PERSON_DOCUMENT_KEY` (HMAC do CPF; ver docs/TSE_IDENTITY.md).
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
from ..open_data.layout import detect_csv_layout
from . import identity
from .layout import CANDIDATES_COLUMNS, CANDIDATES_PROFILE_ID, HISTORY_COLUMNS, HISTORY_PROFILE_ID
from .parser import iter_csv, parse_candidate, parse_history
from .store import dumps, import_candidates, link_votables

KIND_CANDIDATES = "tse-open-data-candidates"
KIND_HISTORY = "tse-open-data-candidacy-history"
DEFAULT_DIR = Path("../data/raw/tse/candidates")


def candidates_spec(year: int) -> CadasterResourceSpec:
    return CadasterResourceSpec(KIND_CANDIDATES, f"candidatos-{year}", "Candidatos")


def history_spec(year: int) -> CadasterResourceSpec:
    return CadasterResourceSpec(KIND_HISTORY, f"candidatos-{year}", "Histórico de candidaturas")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="repbrasil-electoral-candidates")
    sub = parser.add_subparsers(dest="command", required=True)

    acquire = sub.add_parser("acquire", help="download the official candidates and candidacy-history files (content-addressed)")
    acquire.add_argument("--year", type=int, required=True)
    acquire.add_argument("--out", type=Path, default=DEFAULT_DIR)

    imp = sub.add_parser("import", help="import contests and candidacies of the given electoral units and resolve identity")
    imp.add_argument("--year", type=int, required=True)
    imp.add_argument("--turn", type=int, required=True)
    imp.add_argument("--units", required=True, help="comma-separated SG_UE values, e.g. CE,BR")
    imp.add_argument("--dir", type=Path, default=DEFAULT_DIR, help="acquired files root")
    imp.add_argument("--candidates", type=Path, default=None, help="acquired candidates directory (default: the only one under --dir)")
    imp.add_argument("--history", type=Path, default=None, help="acquired candidacy-history directory (default: the only one under --dir)")
    imp.add_argument("--supersede", action="store_true", help="apply a newer official file that changes stored candidacies (diff recorded)")
    imp.add_argument("--dry-run", action="store_true", help="parse and validate only; never touch the database")
    imp.add_argument("--database-url", default=None, help="defaults to $DATABASE_URL")

    link = sub.add_parser("link-votables", help="link BU votables of one UF to official candidacies (no vote table is changed)")
    link.add_argument("--year", type=int, required=True)
    link.add_argument("--turn", type=int, required=True)
    link.add_argument("--uf", required=True)
    link.add_argument("--database-url", default=None, help="defaults to $DATABASE_URL")
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


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.command == "acquire":
        from ..http_client import TSEHttpClient
        from ..open_data.acquire import HttpStreamSource

        client = TSEHttpClient()
        try:
            resources = [discover_resource(client, spec) for spec in (candidates_spec(args.year), history_spec(args.year))]
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
        cand_manifest = load_manifest(args.candidates or find_acquired(args.dir, kind=KIND_CANDIDATES, year=args.year), kind=KIND_CANDIDATES)
        hist_manifest = load_manifest(args.history or find_acquired(args.dir, kind=KIND_HISTORY, year=args.year), kind=KIND_HISTORY)

        candidates, cand_layout, files = [], None, []
        for unit in sorted(units):
            (member,) = _members(cand_manifest, rf"consulta_cand_{args.year}_{unit}\.csv") or [None]
            if member is None:
                raise SystemExit(f"consulta_cand_{args.year}_{unit}.csv not found in the acquired candidates ZIP")
            cand_layout = detect_csv_layout(member["path"], columns=CANDIDATES_COLUMNS, profile_id=CANDIDATES_PROFILE_ID)
            files.append({k: member[k] for k in ("name", "size", "sha256")})
            candidates.extend(
                parse_candidate(f, line, cand_layout.columns, member["name"]) for line, f in iter_csv(member["path"], cand_layout)
            )

        history, hist_layout = [], None
        for member in _members(hist_manifest, rf"historico_candidatura_{args.year}_[A-Z]{{2}}\.csv"):
            hist_layout = detect_csv_layout(member["path"], columns=HISTORY_COLUMNS, profile_id=HISTORY_PROFILE_ID)
            history.extend(parse_history(f, line, hist_layout.columns) for line, f in iter_csv(member["path"], hist_layout))
        if hist_layout is None:
            raise SystemExit("no historico_candidatura CSV found in the acquired history ZIP")

        if args.dry_run:
            checks: dict[str, int] = {}
            for r in candidates:
                status = identity.check_cpf(r.cpf_raw).status
                checks[status] = checks.get(status, 0) + 1
            print(dumps({"status": "dry_run", "files": files, "candidacies": len(candidates), "history_rows": len(history),
                         "identity": checks}))
            return 0
        key = identity.load_key()
        with electoral_db.connect(_database_url(args), autocommit=True) as conn:
            print(dumps(import_candidates(
                conn, year=args.year, turn=args.turn, units=units, candidates=candidates,
                candidates_manifest=cand_manifest, candidates_layout=cand_layout,
                history=history, history_manifest=hist_manifest, history_layout=hist_layout,
                key=key, supersede=args.supersede,
            )))
        return 0

    if args.command == "link-votables":
        with electoral_db.connect(_database_url(args), autocommit=True) as conn:
            print(dumps(link_votables(conn, year=args.year, turn=args.turn, uf=args.uf)))
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
