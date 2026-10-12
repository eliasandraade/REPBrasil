from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.electoral import db as electoral_db
from src.electoral.cadaster.store import load_zone_snapshot
from src.electoral.candidates.store import link_votables
from src.electoral.derived import refresh_derived
from src.electoral.open_data.acquire import load_manifest, verify_file_sha256
from src.electoral.open_data.layout import detect_layout
from src.electoral.open_data.pipeline import prepare_import
from src.electoral.open_data.scope_index import load_or_build_scope_index
from src.electoral.open_data.store import import_prepared


_UF_RE = re.compile(r"^[A-Z]{2}$")
_URL_CREDENTIALS = re.compile(r"://[^/@\s]+@")


def _safe_error(exc: BaseException) -> str:
    """Mensagem de falha para o arquivo de progresso, sem credenciais de URLs de conexão."""
    return _URL_CREDENTIALS.sub("://***@", f"{type(exc).__name__}: {exc}")[:2000]


def _normalize_uf(value: str) -> str:
    """UF de duas letras ASCII (nenhum valor livre chega a consultas, relatórios ou caminhos)."""
    uf = value.strip().upper()
    if not _UF_RE.fullmatch(uf):
        raise SystemExit(f"invalid UF {value!r}; expected two ASCII letters")
    return uf


def _validate_manifest(manifest: dict[str, Any], *, year: int, turn: int, uf: str) -> None:
    """O manifesto precisa ser do recorte pedido e registrar o checksum oficial do TSE conferido."""
    scope = manifest.get("scope", {})
    expected = (year, turn, uf)
    actual = (
        int(scope.get("year", -1)), int(scope.get("turn", -1)), str(scope.get("uf", "")).upper()
    )
    if actual != expected:
        raise SystemExit(f"manifest scope {actual} does not match requested {expected}")
    if (manifest.get("official_checksum") or {}).get("verified") is not True:
        raise SystemExit(
            "manifest does not record a verified official TSE checksum; acquire the file again"
        )


def _database_url(value: str | None) -> str:
    url = value or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL (or --database-url) is required")
    return url


def _output_root() -> Path:
    configured = os.environ.get("REPBRASIL_IMPORT_OUTPUT_ROOT")
    return Path(configured).expanduser().resolve() if configured else Path.cwd().resolve()


def _confined_output(path: Path, output_root: Path) -> Path:
    root = output_root.resolve()
    candidate = path.resolve() if path.is_absolute() else (root / path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise SystemExit(
            f"output path {path!s} escapes REPBRASIL_IMPORT_OUTPUT_ROOT {root!s}"
        ) from exc
    return candidate


def _write(path: Path | None, payload: dict[str, Any], *, output_root: Path) -> None:
    if path is None:
        return
    destination = _confined_output(path, output_root)
    destination.parent.mkdir(parents=True, exist_ok=True)
    tmp = destination.with_suffix(destination.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(destination)


def _state_stats(conn, *, year: int, turn: int, uf: str) -> dict[str, int]:
    params = {"year": year, "turn": turn, "uf": uf}
    row = conn.execute(
        """
        SELECT
          (SELECT count(*) FROM municipality WHERE state_code=%(uf)s),
          (SELECT count(*) FROM zone_municipality zm
             JOIN municipality m ON m.id=zm.municipality_id
             JOIN election e ON e.id=zm.election_id
            WHERE m.state_code=%(uf)s AND e.year=%(year)s AND e.round=%(turn)s),
          (SELECT count(*) FROM electoral_section s
             JOIN municipality m ON m.id=s.municipality_id
             JOIN election e ON e.id=s.election_id
            WHERE m.state_code=%(uf)s AND e.year=%(year)s AND e.round=%(turn)s),
          (SELECT count(*) FROM section_office_result r
            WHERE r.uf=%(uf)s AND r.year=%(year)s AND r.turn=%(turn)s),
          (SELECT count(*) FROM section_office_vote v
             JOIN section_office_result r ON r.id=v.result_id
            WHERE r.uf=%(uf)s AND r.year=%(year)s AND r.turn=%(turn)s),
          (SELECT coalesce(sum(v.votes),0) FROM section_office_vote v
             JOIN section_office_result r ON r.id=v.result_id
            WHERE r.uf=%(uf)s AND r.year=%(year)s AND r.turn=%(turn)s),
          (SELECT count(*) FROM votable v WHERE v.uf=%(uf)s),
          (SELECT count(*) FROM votable_candidacy vc WHERE vc.uf=%(uf)s)
        """,
        params,
    ).fetchone()
    return {
        "municipalities": int(row[0]),
        "municipality_zone": int(row[1]),
        "sections": int(row[2]),
        "section_office_result": int(row[3]),
        "section_office_vote": int(row[4]),
        "votes": int(row[5]),
        "votables": int(row[6]),
        "votable_links": int(row[7]),
    }


def _scopes(conn, *, year: int, turn: int, uf: str) -> list[tuple[str, int]]:
    return conn.execute(
        """
        SELECT m.tse_code, z.zone_number
          FROM zone_municipality zm
          JOIN municipality m ON m.id=zm.municipality_id
          JOIN electoral_zone z ON z.id=zm.zone_id
          JOIN election e ON e.id=zm.election_id
         WHERE m.state_code=%s AND e.year=%s AND e.round=%s
         ORDER BY m.tse_code,z.zone_number
        """,
        (uf, year, turn),
    ).fetchall()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import one UF of official TSE BU data into REPBrasil")
    parser.add_argument("--uf", required=True)
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--turn", type=int, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--database-url", default=None)
    parser.add_argument("--progress", type=Path, default=None)
    parser.add_argument("--report", type=Path, default=None)
    parser.add_argument("--link-votables", action="store_true")
    parser.add_argument("--protect-uf", default=None, help="fail if this UF changes while the target UF is imported")
    parser.add_argument(
        "--no-refresh", action="store_true",
        help="skip recalculating the derived zone aggregates at the end (the API then flags them as stale)",
    )
    args = parser.parse_args(argv)
    output_root = _output_root()

    summary: dict[str, Any] = {
        "uf": args.uf,
        "year": args.year,
        "turn": args.turn,
        "csv_sha256_verified": False,
        "scopes_total": 0,
        "imported": 0,
        "already_present": 0,
        "vote_records_imported": 0,
        "votes_imported": 0,
    }
    try:
        uf = _normalize_uf(args.uf)
        summary["uf"] = uf
        protect_uf = _normalize_uf(args.protect_uf) if args.protect_uf else None
        manifest, csv_path = load_manifest(args.manifest)
        _validate_manifest(manifest, year=args.year, turn=args.turn, uf=uf)
        verify_file_sha256(csv_path, manifest["csv"]["sha256"])
        summary["csv_sha256_verified"] = True
        scope_index = load_or_build_scope_index(
            csv_path,
            detect_layout(csv_path),
            csv_sha256=manifest["csv"]["sha256"],
            csv_size=int(manifest["csv"]["size"]),
        )
        return _run(
            args,
            uf=uf,
            protect_uf=protect_uf,
            scope_index=scope_index,
            summary=summary,
            output_root=output_root,
        )
    except BaseException as exc:
        summary["status"] = "failed"
        summary["error"] = _safe_error(exc)
        _write(args.progress, summary, output_root=output_root)
        raise


def _run(
    args: argparse.Namespace,
    *,
    uf: str,
    protect_uf: str | None,
    scope_index: Any,
    summary: dict[str, Any],
    output_root: Path,
) -> int:
    with electoral_db.connect(_database_url(args.database_url), autocommit=True) as conn:
        protected_before = _state_stats(conn, year=args.year, turn=args.turn, uf=protect_uf) if protect_uf else None
        pairs = _scopes(conn, year=args.year, turn=args.turn, uf=uf)
        if not pairs:
            raise SystemExit(f"no electoral cadaster scopes found for {uf} {args.year}/{args.turn}")
        summary["scopes_total"] = len(pairs)

        for index, (code, zone) in enumerate(pairs, 1):
            exists = conn.execute(
                """SELECT EXISTS(
                       SELECT 1 FROM section_office_result
                        WHERE year=%s AND turn=%s AND uf=%s AND municipality_tse_code=%s AND zone=%s
                     )""",
                (args.year, args.turn, uf, str(code), zone),
            ).fetchone()[0]
            if exists:
                summary["already_present"] += 1
            else:
                snapshot = load_zone_snapshot(
                    conn,
                    year=args.year,
                    turn=args.turn,
                    uf=uf,
                    municipality=int(code),
                    zone=zone,
                )
                prepared = prepare_import(
                    args.manifest,
                    municipality=int(code),
                    zone=zone,
                    cadastro=snapshot,
                    verify_csv_hash=False,
                    scope_index=scope_index,
                )
                report = import_prepared(conn, prepared)
                summary["imported"] += 1
                summary["vote_records_imported"] += int(report["vote_records"])
                summary["votes_imported"] += sum(int(item["votes_total"]) for item in report["offices"].values())
            summary["progress"] = {"done": index, "total": len(pairs)}
            _write(args.progress, summary, output_root=output_root)

        if args.link_votables:
            summary["link"] = link_votables(conn, year=args.year, turn=args.turn, uf=uf)
        if summary["imported"] > 0 and not args.no_refresh:
            summary["derived"] = refresh_derived(conn)

        summary["state"] = _state_stats(conn, year=args.year, turn=args.turn, uf=uf)
        if protect_uf:
            protected_after = _state_stats(conn, year=args.year, turn=args.turn, uf=protect_uf)
            summary["protected_uf"] = {
                "uf": protect_uf,
                "before": protected_before,
                "after": protected_after,
                "unchanged": protected_before == protected_after,
            }
            if protected_before != protected_after:
                _write(args.report, summary, output_root=output_root)
                print(json.dumps(summary, ensure_ascii=False))
                return 1

    summary["status"] = "succeeded"
    _write(args.progress, summary, output_root=output_root)
    _write(args.report, summary, output_root=output_root)
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
