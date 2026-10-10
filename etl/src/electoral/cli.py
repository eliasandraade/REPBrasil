from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

from . import db as electoral_db
from .acquisition import download_planned_artifact, persist_acquired_artifact, plan_section_artifact
from .bu_normalizer import normalize_bu
from .bu_parser import BUParser
from .discovery import discover_general_elections, fetch_election_context
from .ea20 import EA20Result, EA20ZoneExpectation, ea20_zone_filename, validate_zone_result
from .http_client import TSEHttpClient
from .models import EA11Config, EA12Config, EA16Config, SectionAux
from .planner import plan_aux_requests, plan_urna_artifacts
from .tse_urls import TSEConfig, election_config_url, sections_config_url

DEFAULT_CADASTER_DIR = Path("artifacts/tse/cadaster")
EXIT_CADASTER_MISSING = 3


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _cfg(args: argparse.Namespace) -> TSEConfig:
    return TSEConfig(
        base_url=args.base_url,
        environment=args.environment,
        cycle=args.cycle,
        pleito=args.pleito,
    )


def _add_live_section_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--uf", required=True)
    parser.add_argument("--municipality", required=True, help="5-digit TSE municipality code")
    parser.add_argument("--zone", type=int, required=True)
    parser.add_argument("--section", type=int, required=True)
    parser.add_argument("--turn", type=int, default=1)
    parser.add_argument("--suffix", default="-bu.dat", help="exact filename suffix listed by EA18; default: -bu.dat")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="repbrasil-electoral")
    parser.add_argument("--base-url", default="https://resultados.tse.jus.br")
    parser.add_argument("--environment", default="oficial")
    parser.add_argument("--cycle", default="ele2026")
    parser.add_argument("--pleito", type=int, default=3220, help="offline fallback only; production discovery comes from EA11")
    sub = parser.add_subparsers(dest="command", required=True)

    urls = sub.add_parser("urls", help="print canonical EA11/EA16 URLs for an explicit/offline pleito")
    urls.add_argument("--uf", default="ce")

    discover = sub.add_parser("discover", help="discover pleito/elections from a saved EA11 document")
    discover.add_argument("ea11", type=Path)
    discover.add_argument("--turn", type=int, default=1)

    discover_live = sub.add_parser("discover-live", help="explicitly fetch EA11 once and discover pleito/elections")
    discover_live.add_argument("--turn", type=int, default=1)

    municipalities = sub.add_parser("plan-municipalities", help="plan EA12 URLs from a saved EA11 document")
    municipalities.add_argument("ea11", type=Path)
    municipalities.add_argument("--turn", type=int, default=1)

    inspect_municipality = sub.add_parser("inspect-municipality", help="inspect one municipality in a saved EA12 document")
    inspect_municipality.add_argument("ea12", type=Path)
    inspect_municipality.add_argument("--uf", required=True)
    group = inspect_municipality.add_mutually_exclusive_group(required=True)
    group.add_argument("--tse-code")
    group.add_argument("--ibge-code")

    aux = sub.add_parser("plan-aux", help="plan EA18 requests only for EA16 sections with da/ha")
    aux.add_argument("ea16", type=Path)
    aux.add_argument("--uf", required=True)
    aux.add_argument("--municipality", required=True)
    aux.add_argument("--zone", type=int, required=True)

    urna = sub.add_parser("plan-urna", help="plan files from a parsed EA18 without guessing paths")
    urna.add_argument("ea18", type=Path)
    urna.add_argument("--uf", required=True)
    urna.add_argument("--municipality", required=True)
    urna.add_argument("--zone", type=int, required=True)
    urna.add_argument("--section", type=int, required=True)
    urna.add_argument("--suffix", default=None, help="optional filename suffix, e.g. -bu.dat; no tp enum is assumed")

    ea20_name = sub.add_parser("ea20-zone-filename", help="print the official EA20 zone filename without guessing a CDN path")
    ea20_name.add_argument("--uf", required=True)
    ea20_name.add_argument("--municipality", required=True, help="5-digit TSE municipality code")
    ea20_name.add_argument("--zone", required=True)
    ea20_name.add_argument("--office", required=True, help="4-digit EA20 office code, e.g. 0001")
    ea20_name.add_argument("--election", required=True, help="election id discovered via EA11")

    validate_ea20 = sub.add_parser("validate-ea20-zone", help="validate a saved EA20 zone JSON and its official accounting identities")
    validate_ea20.add_argument("ea20", type=Path)
    validate_ea20.add_argument("--zone", type=int, required=True)
    validate_ea20.add_argument("--office", required=True)
    validate_ea20.add_argument("--election", type=int, required=True)

    normalize = sub.add_parser(
        "normalize-bu",
        help="decode and normalize one official *bu.dat/*busa.dat using the reviewed TSE 2026 schema",
    )
    normalize.add_argument("bu", type=Path)
    normalize.add_argument("--schema", type=Path, required=True, help="path to the reviewed official spec/bu.asn1")

    live_plan = sub.add_parser(
        "plan-section-live",
        help="explicitly resolve EA11 -> EA12 -> EA16 -> EA18 and print the exact urna artifact without downloading it",
    )
    _add_live_section_args(live_plan)

    acquire = sub.add_parser(
        "acquire-section-live",
        help="explicitly resolve and download one urna artifact with a SHA-256 provenance manifest",
    )
    _add_live_section_args(acquire)
    acquire.add_argument("--out", type=Path, default=Path("artifacts/tse"))

    # Pipeline histórico — Portal de Dados Abertos TSE (Boletim de Urna CSV).
    od_discover = sub.add_parser(
        "discover-open-data-bu", help="find the official BU resource for a year/turn/UF via the portal CKAN metadata"
    )
    od_acquire = sub.add_parser(
        "acquire-open-data-bu", help="download the official BU ZIP, verify the published checksum and store it content-addressed"
    )
    for p in (od_discover, od_acquire):
        p.add_argument("--year", type=int, required=True)
        p.add_argument("--turn", type=int, required=True)
        p.add_argument("--uf", required=True)
    od_acquire.add_argument("--out", type=Path, default=Path("artifacts/tse/open-data"))

    od_import = sub.add_parser(
        "import-open-data-bu", help="parse, validate and import one municipality/zone from an acquired BU (manifest or directory)"
    )
    od_import.add_argument("manifest", type=Path, help="manifest.json or the content-addressed directory")
    od_import.add_argument("--municipality", type=int, required=True, help="TSE municipality code, e.g. 13935")
    od_import.add_argument("--zone", type=int, default=None, help="one zone; omitted = every zone of the municipality in the cadaster")
    od_import.add_argument(
        "--cadastro", type=Path, default=None,
        help="explicit cadaster snapshot JSON (fixtures); default: the canonical cadaster (database, or the acquired official CSV on --dry-run)",
    )
    od_import.add_argument("--cadaster-dir", type=Path, default=DEFAULT_CADASTER_DIR, help="acquired official cadaster (dry-run without database)")
    od_import.add_argument("--ea20", type=Path, action="append", default=[], help="official EA20 zone JSON (repeatable, one per office)")
    od_import.add_argument("--dry-run", action="store_true", help="parse and validate only; never touch the database")
    od_import.add_argument("--database-url", default=None, help="defaults to $DATABASE_URL")

    # Cadastro eleitoral — Portal de Dados Abertos TSE (território + eleitorado por local de votação).
    cad_discover = sub.add_parser(
        "discover-electoral-cadaster", help="find the official territory-codes and polling-place resources via CKAN"
    )
    cad_acquire = sub.add_parser(
        "acquire-electoral-cadaster", help="download both official cadaster files and store them content-addressed"
    )
    for p in (cad_discover, cad_acquire):
        p.add_argument("--year", type=int, required=True)
    cad_acquire.add_argument("--out", type=Path, default=DEFAULT_CADASTER_DIR)

    territories = sub.add_parser("import-territories", help="import UFs and municipalities (TSE <-> IBGE codes) from an acquired file")
    territories.add_argument("directory", type=Path, nargs="?", default=None, help="acquired municipality-codes directory (default: the only one under --cadaster-dir)")
    territories.add_argument("--cadaster-dir", type=Path, default=DEFAULT_CADASTER_DIR)
    territories.add_argument("--dry-run", action="store_true")
    territories.add_argument("--database-url", default=None, help="defaults to $DATABASE_URL")

    audit = sub.add_parser(
        "audit-election", help="audit one imported election/UF: official sources × database, classified divergences"
    )
    audit.add_argument("--year", type=int, required=True)
    audit.add_argument("--turn", type=int, required=True)
    audit.add_argument("--uf", required=True)
    audit.add_argument("--bu-manifest", type=Path, default=None, help="acquired BU manifest/directory (whole official CSV is scanned)")
    audit.add_argument("--candidates", type=Path, default=None, help="acquired candidates directory (consulta_cand)")
    audit.add_argument("--units", default="", help="SG_UE values used in the candidates import, e.g. CE,BR")
    audit.add_argument("--municipal-uf", action="append", default=[], help="municipal selector used in the candidates import")
    audit.add_argument(
        "--save", action="store_true",
        help="write the full JSON report to etl/artifacts/reports/ and the markdown summary to docs/audits/",
    )
    audit.add_argument("--database-url", default=None, help="defaults to $DATABASE_URL")

    derived = sub.add_parser(
        "refresh-derived", help="recalculate the derived zone aggregates of the current BU batches (after BU imports)"
    )
    derived.add_argument("--database-url", default=None, help="defaults to $DATABASE_URL")

    cad_import = sub.add_parser(
        "import-electoral-cadaster", help="import zones, polling places and sections of one UF/turn from an acquired polling-place file"
    )
    cad_import.add_argument("directory", type=Path, nargs="?", default=None, help="acquired polling-place directory (default: the only one under --cadaster-dir)")
    cad_import.add_argument("--cadaster-dir", type=Path, default=DEFAULT_CADASTER_DIR)
    cad_import.add_argument("--year", type=int, required=True)
    cad_import.add_argument("--turn", type=int, required=True)
    cad_import.add_argument("--uf", required=True)
    cad_import.add_argument("--municipality", action="append", default=[], help="TSE code (repeatable); default: the whole UF")
    cad_import.add_argument("--supersede", action="store_true", help="apply a newer official file that differs from the stored cadaster (diff is recorded)")
    cad_import.add_argument("--dry-run", action="store_true")
    cad_import.add_argument("--database-url", default=None, help="defaults to $DATABASE_URL")
    return parser


def _print_context(context) -> None:
    print(json.dumps(context.as_dict(), ensure_ascii=False, indent=2))


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    cfg = _cfg(args)
    if args.command == "urls":
        print(election_config_url(cfg))
        print(sections_config_url(cfg, args.uf))
        return 0
    if args.command == "discover":
        document = EA11Config.model_validate(_load(args.ea11))
        _print_context(discover_general_elections(document, cycle=cfg.cycle, turn=args.turn))
        return 0
    if args.command == "discover-live":
        client = TSEHttpClient()
        try:
            _print_context(fetch_election_context(client, cfg, turn=args.turn))
        finally:
            client.close()
        return 0
    if args.command == "plan-municipalities":
        document = EA11Config.model_validate(_load(args.ea11))
        context = discover_general_elections(document, cycle=cfg.cycle, turn=args.turn)
        print(json.dumps(context.municipality_config_urls(cfg), ensure_ascii=False, indent=2))
        return 0
    if args.command == "inspect-municipality":
        document = EA12Config.model_validate(_load(args.ea12))
        municipality = (
            document.find_by_tse_code(args.uf, args.tse_code)
            if args.tse_code is not None
            else document.find_by_ibge_code(args.ibge_code)
        )
        print(json.dumps(municipality.model_dump(), ensure_ascii=False, indent=2))
        return 0
    if args.command == "plan-aux":
        document = EA16Config.model_validate(_load(args.ea16))
        plan = plan_aux_requests(document, cfg, uf=args.uf, municipality=args.municipality, zone=args.zone)
        print(json.dumps([item.__dict__ for item in plan], ensure_ascii=False, indent=2))
        return 0
    if args.command == "plan-urna":
        document = SectionAux.model_validate(_load(args.ea18))
        plan = plan_urna_artifacts(
            document,
            cfg,
            uf=args.uf,
            municipality=args.municipality,
            zone=args.zone,
            section=args.section,
            suffix=args.suffix,
        )
        print(json.dumps([item.__dict__ for item in plan], ensure_ascii=False, indent=2))
        return 0
    if args.command == "ea20-zone-filename":
        print(
            ea20_zone_filename(
                uf=args.uf,
                municipality_tse_code=args.municipality,
                zone=args.zone,
                office_code=args.office,
                election=args.election,
            )
        )
        return 0
    if args.command == "validate-ea20-zone":
        document = EA20Result.model_validate(_load(args.ea20))
        validate_zone_result(
            document,
            EA20ZoneExpectation(election=args.election, zone=args.zone, office_code=args.office),
        )
        print(
            json.dumps(
                {
                    "valid": True,
                    "election": document.ele,
                    "zone": document.cdabr,
                    "office": str(args.office).zfill(4),
                    "sections": document.s.model_dump(),
                    "electorate": document.e.model_dump(),
                    "votes": document.v.model_dump(),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    if args.command == "normalize-bu":
        parser = BUParser(args.schema)
        normalized = normalize_bu(parser.decode(args.bu))
        print(json.dumps(normalized, ensure_ascii=False, indent=2))
        return 0
    if args.command in {"discover-open-data-bu", "acquire-open-data-bu", "import-open-data-bu"}:
        return _open_data(args)
    if args.command in {"discover-electoral-cadaster", "acquire-electoral-cadaster", "import-territories", "import-electoral-cadaster"}:
        return _cadaster(args)
    if args.command == "audit-election":
        return _audit(args)
    if args.command == "refresh-derived":
        from .derived import refresh_derived

        database_url = _database_url(args)
        if not database_url:
            raise SystemExit("DATABASE_URL (or --database-url) is required")
        with electoral_db.connect(database_url, autocommit=True) as conn:
            print(json.dumps(refresh_derived(conn), ensure_ascii=False, indent=2, default=str))
        return 0
    if args.command in {"plan-section-live", "acquire-section-live"}:
        client = TSEHttpClient()
        try:
            plan = plan_section_artifact(
                client,
                cfg,
                uf=args.uf,
                municipality=args.municipality,
                zone=args.zone,
                section=args.section,
                turn=args.turn,
                suffix=args.suffix,
            )
            if args.command == "plan-section-live":
                print(json.dumps(plan.as_dict(), ensure_ascii=False, indent=2))
                return 0
            artifact = download_planned_artifact(client, plan)
            persisted = persist_acquired_artifact(artifact, args.out)
            output = artifact.manifest()
            output["data_path"] = str(persisted.data_path)
            output["manifest_path"] = str(persisted.manifest_path)
            print(json.dumps(output, ensure_ascii=False, indent=2))
            return 0
        finally:
            client.close()
    raise AssertionError("unreachable")


def _open_data(args: argparse.Namespace) -> int:

    from .open_data.acquire import HttpStreamSource, acquire_bu_resource
    from .open_data.ckan import discover_bu_resource

    if args.command in {"discover-open-data-bu", "acquire-open-data-bu"}:
        client = TSEHttpClient()
        try:
            resource = discover_bu_resource(client, year=args.year, turn=args.turn, uf=args.uf)
        finally:
            client.close()
        if args.command == "discover-open-data-bu":
            print(json.dumps(resource.as_dict(), ensure_ascii=False, indent=2))
            return 0
        source = HttpStreamSource()
        try:
            acquired = acquire_bu_resource(resource, args.out, source=source)
        finally:
            source.close()
        print(json.dumps({**acquired.manifest, "reused": acquired.reused, "manifest_path": str(acquired.manifest_path)}, ensure_ascii=False, indent=2))
        return 0

    return _import_open_data_bu(args)


def _audit(args: argparse.Namespace) -> int:
    from .audit import audit_election, to_markdown
    from .cadaster.sources import extract_member
    from .cadaster.sources import load_manifest as load_cadaster_manifest
    from .candidates.layout import CANDIDATES_COLUMNS, CANDIDATES_PROFILE_ID
    from .candidates.parser import iter_csv, parse_candidate
    from .candidates.store import select_candidacies
    from .open_data.acquire import load_manifest as load_bu_manifest
    from .open_data.layout import detect_csv_layout
    from .paths import AUDITS_DIR, REPORTS_DIR, report_file, unit_code, write_report

    # Só valores validados seguem adiante (e nomeiam os arquivos de saída).
    year, turn, uf = int(args.year), int(args.turn), unit_code(args.uf)
    bu_csv = None
    if args.bu_manifest is not None:
        manifest, bu_csv = load_bu_manifest(args.bu_manifest)
        scope = manifest.get("scope", {})
        if (int(scope.get("year", -1)), int(scope.get("turn", -1)), str(scope.get("uf", "")).upper()) != (year, turn, uf):
            raise SystemExit(f"BU manifest scope {scope} does not match {year}/{turn}/{uf}")
    counts = None
    other_elections = 0
    if args.candidates is not None:
        units = {unit_code(u) for u in args.units.split(",") if u.strip()}
        municipal = {unit_code(u) for u in args.municipal_uf if u.strip()}
        cand_manifest = load_cadaster_manifest(args.candidates, kind="tse-open-data-candidates")
        rows = []
        for unit in sorted(units | municipal):
            member = extract_member(cand_manifest, rf"consulta_cand_{year}_{unit}\.csv")
            layout = detect_csv_layout(member["path"], columns=CANDIDATES_COLUMNS, profile_id=CANDIDATES_PROFILE_ID)
            rows.extend(parse_candidate(f, line, layout.columns, member["name"]) for line, f in iter_csv(member["path"], layout))
        selected, _, other = select_candidacies(rows, year=year, turn=turn, units=units, municipal_ufs=municipal)
        counts = {}
        for r in selected:
            counts[r.office_code] = counts.get(r.office_code, 0) + 1
        other_elections = sum(other.values())
    database_url = _database_url(args)
    if not database_url:
        raise SystemExit("DATABASE_URL (or --database-url) is required")
    with electoral_db.connect(database_url, autocommit=True) as conn:
        report = audit_election(conn, year=year, turn=turn, uf=uf, bu_csv=bu_csv,
                                candidate_counts=counts, other_election_rows=other_elections)
    saved = {}
    if args.save:  # diretórios fixos; nomes só com ano, turno e UF validados
        saved["report"] = str(write_report(report_file(REPORTS_DIR, "audit", year, uf, turn),
                                           json.dumps(report, ensure_ascii=False, indent=2, default=str)))
        saved["markdown"] = str(write_report(report_file(AUDITS_DIR, "audit", year, uf, turn, suffix=".md"), to_markdown(report)))
    print(json.dumps({"status": report["status"], "summary": report["summary"], "cadaster": report["cadaster"], **saved},
                     ensure_ascii=False))
    return 0 if report["status"] == "ok" else 5


def _database_url(args: argparse.Namespace) -> str | None:
    import os

    return args.database_url or os.environ.get("DATABASE_URL")


def _missing(exc: Exception) -> int:
    """Território válido sem cadastro: resposta explícita, nunca inferência."""
    print(json.dumps({"status": getattr(exc, "code", "cadaster_missing"), "detail": str(exc)}, ensure_ascii=False, indent=2))
    return EXIT_CADASTER_MISSING


def _import_open_data_bu(args: argparse.Namespace) -> int:
    from .cadaster.errors import CadasterMissing, TerritoryMissing
    from .open_data.acquire import load_manifest
    from .open_data.pipeline import prepare_import
    from .open_data.store import dumps

    manifest, _ = load_manifest(args.manifest)
    year, turn, uf = manifest["scope"]["year"], manifest["scope"]["turn"], manifest["scope"]["uf"]
    database_url = _database_url(args)
    if not args.dry_run and not database_url:
        raise SystemExit("DATABASE_URL (or --database-url) is required unless --dry-run")

    conn = None
    try:
        # Cadastro canônico: o banco (importação real), ou o CSV oficial adquirido (dry-run sem banco).
        if args.cadastro is not None:
            fixture = _load(args.cadastro)
            zones = [args.zone] if args.zone is not None else list(fixture["municipality"]["zone_numbers"])
            snapshot = lambda zone: fixture  # noqa: E731
        elif database_url:
            from .cadaster.store import load_zone_snapshot, municipality_zones

            # autocommit: cada importação é a sua própria transação (import_prepared abre e
            # confirma). Sem isso, as leituras do cadastro abririam uma transação implícita,
            # a importação viraria um savepoint e nada seria persistido ao fechar.
            conn = electoral_db.connect(database_url, autocommit=True)
            zones = [args.zone] if args.zone is not None else municipality_zones(conn, year=year, turn=turn, uf=uf, municipality=args.municipality)
            snapshot = lambda zone: load_zone_snapshot(conn, year=year, turn=turn, uf=uf, municipality=args.municipality, zone=zone)  # noqa: E731
        else:
            from .cadaster.polling_places import parse_cadaster, zone_snapshot
            from .cadaster.sources import KIND_POLLING_PLACES, find_acquired
            from .cadaster.sources import load_manifest as load_cadaster_manifest

            cad_manifest = load_cadaster_manifest(find_acquired(args.cadaster_dir, kind=KIND_POLLING_PLACES, year=year), kind=KIND_POLLING_PLACES)
            member, national = _polling_member(cad_manifest, year, uf.upper())  # CSV da UF (2026) ou nacional (até 2024)
            cadaster = parse_cadaster(member["path"], year=year, turn=turn, uf=uf, municipalities=[args.municipality], national=national)
            mun = cadaster.municipality(args.municipality)
            assert mun is not None
            zones = [args.zone] if args.zone is not None else sorted(mun.zones)
            snapshot = lambda zone: zone_snapshot(cadaster, args.municipality, zone)  # noqa: E731

        reports = []
        for zone in zones:
            prepared = prepare_import(args.manifest, municipality=args.municipality, zone=zone, cadastro=snapshot(zone), ea20_paths=args.ea20)
            if args.dry_run:
                reports.append(prepared.report(status="dry_run"))
                continue
            from .open_data.store import import_prepared

            assert conn is not None
            reports.append(import_prepared(conn, prepared))
    except (CadasterMissing, TerritoryMissing) as exc:
        return _missing(exc)
    finally:
        if conn is not None:
            conn.close()
    print(dumps(reports[0] if args.zone is not None else reports))
    return 0


def _polling_member(manifest: dict, year: int, uf: str) -> tuple[dict, bool]:
    """(membro, nacional?): um CSV por UF (2026) ou um único CSV nacional (até 2024) — nunca os dois no mesmo ZIP."""
    from .cadaster.sources import extract_member

    names = {m["name"] for m in manifest["zip_members"]}
    national = f"eleitorado_local_votacao_{year}.csv"
    per_uf = [n for n in names if re.fullmatch(rf".*_{year}_{uf}\.csv", n)]
    if per_uf and national in names:
        raise SystemExit(f"ambiguous polling-place ZIP: both {per_uf} and {national}")
    return extract_member(manifest, rf".*_{year}_{uf}\.csv" if per_uf else re.escape(national)), not per_uf


def _cadaster(args: argparse.Namespace) -> int:
    from .cadaster.errors import CadasterMissing, TerritoryMissing
    from .cadaster.sources import (
        KIND_MUNICIPALITY_CODES,
        KIND_POLLING_PLACES,
        CadasterResourceSpec,
        acquire_resource,
        discover_resource,
        extract_member,
        find_acquired,
        load_manifest,
    )
    from .cadaster.store import dumps

    if args.command in {"discover-electoral-cadaster", "acquire-electoral-cadaster"}:
        from .open_data.acquire import HttpStreamSource

        specs = [CadasterResourceSpec.municipality_codes(), CadasterResourceSpec.polling_places(args.year)]
        client = TSEHttpClient()
        try:
            resources = [discover_resource(client, spec) for spec in specs]
        finally:
            client.close()
        if args.command == "discover-electoral-cadaster":
            print(dumps([r.as_dict() for r in resources]))
            return 0
        source = HttpStreamSource()
        try:
            acquired = [acquire_resource(r, args.out, source=source) for r in resources]
        finally:
            source.close()
        print(dumps([{**a.manifest, "reused": a.reused, "manifest_path": str(a.manifest_path)} for a in acquired]))
        return 0

    if args.command == "import-territories":
        from .cadaster.territories import COLUMNS, PROFILE_ID, parse_territories
        from .open_data.layout import detect_csv_layout

        manifest = load_manifest(args.directory or find_acquired(args.cadaster_dir, kind=KIND_MUNICIPALITY_CODES), kind=KIND_MUNICIPALITY_CODES)
        member = extract_member(manifest, r"[^/]+\.csv")
        layout = detect_csv_layout(member["path"], columns=COLUMNS, profile_id=PROFILE_ID)
        territories = parse_territories(member["path"])
        if args.dry_run:
            print(dumps({"status": "dry_run", "csv": {k: member[k] for k in ("name", "size", "sha256")},
                         "generated_at": territories.generated_at, "states": len(territories.states),
                         "municipalities": len(territories.municipalities)}))
            return 0
        database_url = _database_url(args)
        if not database_url:
            raise SystemExit("DATABASE_URL (or --database-url) is required unless --dry-run")
        from .cadaster.store import import_territories

        with electoral_db.connect(database_url, autocommit=True) as conn:
            print(dumps(import_territories(conn, territories, manifest, member, layout)))
        return 0

    from .cadaster.polling_places import detect_layout, parse_cadaster

    manifest = load_manifest(args.directory or find_acquired(args.cadaster_dir, kind=KIND_POLLING_PLACES, year=args.year), kind=KIND_POLLING_PLACES)
    uf = args.uf.upper()
    member, national = _polling_member(manifest, args.year, uf)
    layout = detect_layout(member["path"])
    municipalities = [str(m).zfill(5) for m in args.municipality] or None
    cadaster = parse_cadaster(
        member["path"], year=args.year, turn=args.turn, uf=uf, municipalities=municipalities, national=national
    )
    if args.dry_run:
        print(dumps({"status": "dry_run", "csv": {k: member[k] for k in ("name", "size", "sha256")},
                     "layout": layout.as_dict(), "summary": cadaster.summary(), "warnings": cadaster.warnings}))
        return 0
    database_url = _database_url(args)
    if not database_url:
        raise SystemExit("DATABASE_URL (or --database-url) is required unless --dry-run")
    from .cadaster.errors import CadasterConflict
    from .cadaster.store import import_cadaster

    try:
        with electoral_db.connect(database_url, autocommit=True) as conn:
            print(dumps(import_cadaster(conn, cadaster, manifest, member, layout, municipalities=municipalities, supersede=args.supersede)))
    except (CadasterMissing, TerritoryMissing) as exc:
        return _missing(exc)
    except CadasterConflict as exc:
        print(dumps({"status": exc.code, "detail": str(exc), "diff": exc.diff}))
        return 4
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
