"""Bulk/state-wide import for one official TSE BU CSV.

The historical BU resource is one large CSV per UF. Re-running the single-zone
pipeline once per municipality would re-scan the same 1+ GB file hundreds of
times. This module validates the file once (routing columns only), then
streams it a second time distributing the rows into one temporary spill file
per municipality/zone on disk, and finally imports one zone at a time through
the *same* normalization, cadaster reconciliation and PostgreSQL store used by
the regular importer.

The official file is NOT grouped by municipality/zone (CE 2026: ~2.38 million
consecutive runs in 2.75 million rows). Row order carries no meaning, so it is
never relied upon; memory stays bounded by ``buffer_rows`` regardless of the
order, and every row keeps its original line number for provenance.

Safety properties:
- official CSV SHA-256 is verified once before the sync;
- the file scope (year/turn/UF) is validated before any write;
- BU scopes must match the canonical cadaster scopes exactly for the selected
  municipalities;
- the per-scope row counts of the second pass must equal the preflight counts;
- each zone keeps its existing transaction/idempotency semantics, so an
  interrupted run is safely resumable;
- absence is never coerced to zero and aggregated sections never gain votes.
"""
from __future__ import annotations

import csv
import json
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Iterator

import psycopg

from ..cadaster.store import load_zone_snapshot
from .acquire import load_manifest, verify_file_sha256
from .ea20_check import validate_against_ea20
from .layout import COLUMNS, DetectedLayout, LayoutError, detect_layout
from .parser import BURow, RowError, ScanStats, parse_row
from .pipeline import PreparedImport, fingerprint
from .reconcile import reconcile_with_cadastro
from .results import ConsistencyError, normalize_zone
from .store import import_prepared

_IDX = {name: i for i, name in enumerate(COLUMNS)}


@dataclass(frozen=True, order=True)
class ZoneScope:
    municipality: int
    zone: int

    @property
    def municipality_code(self) -> str:
        return str(self.municipality).zfill(5)

    def as_dict(self) -> dict[str, Any]:
        return {"municipality": self.municipality_code, "zone": self.zone}


@dataclass(frozen=True)
class ScopePlan:
    scope: ZoneScope
    rows: int


@dataclass(frozen=True)
class StatePlan:
    year: int
    turn: int
    uf: str
    rows: int
    scopes: tuple[ScopePlan, ...]

    @property
    def municipalities(self) -> tuple[str, ...]:
        return tuple(sorted({s.scope.municipality_code for s in self.scopes}))

    def as_dict(self) -> dict[str, Any]:
        return {
            "year": self.year,
            "turn": self.turn,
            "uf": self.uf,
            "rows": self.rows,
            "municipalities": len(self.municipalities),
            "zones": len(self.scopes),
            "scopes": [{**p.scope.as_dict(), "rows": p.rows} for p in self.scopes],
        }


def _int_field(fields: list[str], column: str, line: int) -> int:
    raw = fields[_IDX[column]].strip()
    try:
        value = int(raw)
    except ValueError as exc:
        raise RowError(line, f"{column}={raw!r} is not an integer") from exc
    if value < 0:
        raise RowError(line, f"{column}={raw!r} is negative")
    return value


def _reader(path: Path, layout: DetectedLayout):
    fh = path.open("r", encoding=layout.encoding, newline="")
    reader = csv.reader(fh, delimiter=layout.delimiter, quotechar=layout.quotechar, strict=True)
    try:
        header = next(reader)
    except StopIteration:
        fh.close()
        raise LayoutError("empty CSV")
    if tuple(header) != layout.columns:
        fh.close()
        raise LayoutError("header changed between detection and parsing")
    return fh, reader, len(header)


def preflight_state(
    path: Path,
    layout: DetectedLayout,
    *,
    year: int,
    turn: int,
    uf: str,
    municipalities: set[int] | None = None,
) -> StatePlan:
    """Validate the source scope of every row and count rows per municipality/zone.

    This pass performs no writes and only parses the routing columns. Scopes
    may be interleaved anywhere in the file (as in the official TSE CSV);
    they are reported in order of first appearance.
    """
    uf = uf.upper()
    fh, reader, width = _reader(path, layout)
    total = 0
    counts: dict[ZoneScope, int] = {}
    try:
        for fields in reader:
            total += 1
            line = reader.line_num
            if len(fields) != width:
                raise LayoutError(f"line {line}: expected {width} fields, found {len(fields)} (truncated or malformed)")
            row_uf = fields[_IDX["SG_UF"]].strip().upper()
            if row_uf != uf:
                raise ConsistencyError(f"line {line}: SG_UF {row_uf!r} differs from resource UF {uf!r}")
            if _int_field(fields, "ANO_ELEICAO", line) != year or _int_field(fields, "NR_TURNO", line) != turn:
                raise ConsistencyError(f"line {line}: year/turn differ from resource scope {year}/{turn}")
            municipality = _int_field(fields, "CD_MUNICIPIO", line)
            zone = _int_field(fields, "NR_ZONA", line)
            if municipalities is not None and municipality not in municipalities:
                continue
            key = ZoneScope(municipality, zone)
            counts[key] = counts.get(key, 0) + 1
    finally:
        fh.close()
    if not counts:
        selected = "all municipalities" if municipalities is None else ", ".join(str(x).zfill(5) for x in sorted(municipalities))
        raise ConsistencyError(f"no BU rows found for {selected} in {uf} {year}/{turn}")
    return StatePlan(year, turn, uf, total, tuple(ScopePlan(k, n) for k, n in counts.items()))


DEFAULT_BUFFER_ROWS = 50_000


def iter_zone_groups(
    path: Path,
    layout: DetectedLayout,
    *,
    year: int,
    turn: int,
    uf: str,
    municipalities: set[int] | None = None,
    expected_rows: dict[ZoneScope, int] | None = None,
    buffer_rows: int = DEFAULT_BUFFER_ROWS,
    workdir: Path | None = None,
) -> Iterator[tuple[ZoneScope, list[BURow]]]:
    """Second pass: distribute rows per scope on disk, then yield one zone at a time.

    Rows are buffered in memory up to ``buffer_rows`` (all scopes together) and
    appended to one temporary CSV per scope; each spilled row keeps its
    original physical line number. Scopes are yielded in order of first
    appearance, each with its rows in original file order. When
    ``expected_rows`` is given (the preflight counts), every scope must match.
    """
    if buffer_rows < 1:
        raise ValueError("buffer_rows must be >= 1")
    uf = uf.upper()
    with tempfile.TemporaryDirectory(prefix="urnai-bu-spill-", dir=workdir) as tmp:
        spill_dir = Path(tmp)
        order: list[ZoneScope] = []
        files: dict[ZoneScope, Path] = {}
        pending: dict[ZoneScope, list[list[str]]] = {}
        buffered = 0

        def flush() -> None:
            nonlocal buffered
            for scope, rows in pending.items():
                with files[scope].open("a", encoding=layout.encoding, newline="") as out:
                    csv.writer(out, delimiter=";", quotechar='"', quoting=csv.QUOTE_ALL, lineterminator="\n").writerows(rows)
            pending.clear()
            buffered = 0

        fh, reader, width = _reader(path, layout)
        try:
            for fields in reader:
                line = reader.line_num
                if len(fields) != width:
                    raise LayoutError(f"line {line}: expected {width} fields, found {len(fields)} (truncated or malformed)")
                row_uf = fields[_IDX["SG_UF"]].strip().upper()
                if row_uf != uf:
                    raise ConsistencyError(f"line {line}: SG_UF {row_uf!r} differs from resource UF {uf!r}")
                row_year = _int_field(fields, "ANO_ELEICAO", line)
                row_turn = _int_field(fields, "NR_TURNO", line)
                if row_year != year or row_turn != turn:
                    raise ConsistencyError(f"line {line}: year/turn {row_year}/{row_turn} differ from resource scope {year}/{turn}")
                municipality = _int_field(fields, "CD_MUNICIPIO", line)
                zone = _int_field(fields, "NR_ZONA", line)
                if municipalities is not None and municipality not in municipalities:
                    continue
                key = ZoneScope(municipality, zone)
                if key not in files:
                    order.append(key)
                    files[key] = spill_dir / f"{key.municipality_code}-{key.zone:04d}.csv"
                pending.setdefault(key, []).append([str(line), *fields])
                buffered += 1
                if buffered >= buffer_rows:
                    flush()
            flush()
        finally:
            fh.close()

        if expected_rows is not None and set(expected_rows) != set(order):
            raise ConsistencyError("scopes of the second pass differ from the preflight")
        for key in order:
            rows: list[BURow] = []
            with files[key].open("r", encoding=layout.encoding, newline="") as spilled:
                for record in csv.reader(spilled, delimiter=";", quotechar='"', strict=True):
                    if len(record) != width + 1:
                        raise LayoutError(f"spill file for {key.municipality_code}/zone {key.zone} is malformed")
                    rows.append(parse_row(record[1:], int(record[0])))
            if expected_rows is not None and len(rows) != expected_rows[key]:
                raise ConsistencyError(
                    f"scope {key.municipality_code}/zone {key.zone}: preflight counted {expected_rows[key]} rows, second pass {len(rows)}"
                )
            yield key, rows
            files[key].unlink()


def _expected_scopes(
    conn: psycopg.Connection,
    *,
    year: int,
    turn: int,
    uf: str,
    municipalities: set[int] | None,
) -> set[ZoneScope]:
    params: list[Any] = [year, turn, uf.upper()]
    selected = ""
    if municipalities is not None:
        selected = " AND m.tse_code = ANY(%s)"
        params.append([str(x).zfill(5) for x in sorted(municipalities)])
    with conn.cursor() as cur:
        cur.execute(
            f"""SELECT DISTINCT m.tse_code, z.zone_number
                  FROM electoral_section s
                  JOIN election e ON e.id=s.election_id
                  JOIN municipality m ON m.id=s.municipality_id
                  JOIN electoral_zone z ON z.id=s.zone_id
                 WHERE e.year=%s AND e.round=%s AND m.state_code=%s{selected}
                 ORDER BY m.tse_code, z.zone_number""",
            params,
        )
        return {ZoneScope(int(code), int(zone)) for code, zone in cur.fetchall()}


def _prepare_group(
    manifest: dict[str, Any],
    layout: DetectedLayout,
    scope: ZoneScope,
    rows: list[BURow],
    cadastro: dict[str, Any],
) -> PreparedImport:
    if not rows:
        raise ConsistencyError(f"empty scope {scope.municipality_code}/zone {scope.zone}")
    info = manifest["scope"]
    for row in rows:
        if row.year != info["year"] or row.turn != info["turn"]:
            raise ConsistencyError(f"line {row.line}: year/turn {row.year}/{row.turn} differ from resource scope {info}")
    normalized = normalize_zone(rows, municipality=scope.municipality, zone=scope.zone)
    reconciliation = reconcile_with_cadastro(normalized, cadastro)
    ea20 = validate_against_ea20(normalized, [])
    import_scope = {
        "year": info["year"],
        "turn": info["turn"],
        "uf": info["uf"],
        "municipality": scope.municipality_code,
        "zone": scope.zone,
    }
    count = len(rows)
    stats = ScanStats(rows_read=count, rows_matching_uf=count, rows_matching_municipality=count, rows_matching_zone=count)
    return PreparedImport(manifest, layout, stats, normalized, reconciliation, ea20, fingerprint(import_scope, normalized), import_scope)


def sync_state_results(
    conn: psycopg.Connection,
    manifest_path: Path,
    *,
    municipalities: Iterable[int | str] | None = None,
    dry_run: bool = False,
    verify_csv_hash: bool = True,
    progress=None,
) -> dict[str, Any]:
    """Import every canonical municipality/zone represented by one UF BU file.

    Each zone is committed independently through ``import_prepared``. If a
    later zone fails, already committed zones remain valid and a rerun resumes
    idempotently. The top-level operation never hides partial coverage.
    """
    manifest, csv_path = load_manifest(manifest_path)
    info = manifest["scope"]
    year, turn, uf = int(info["year"]), int(info["turn"]), str(info["uf"]).upper()
    wanted = None if municipalities is None else {int(str(x)) for x in municipalities}
    if verify_csv_hash:
        verify_file_sha256(csv_path, manifest["csv"]["sha256"])
    layout = detect_layout(csv_path)
    plan = preflight_state(csv_path, layout, year=year, turn=turn, uf=uf, municipalities=wanted)

    expected = _expected_scopes(conn, year=year, turn=turn, uf=uf, municipalities=wanted)
    if not expected:
        raise ConsistencyError(f"canonical cadaster has no scopes for {uf} {year}/{turn}")
    seen = {p.scope for p in plan.scopes}
    missing, extra = sorted(expected - seen), sorted(seen - expected)
    if missing or extra:
        detail = {
            "missing_from_bu": [s.as_dict() for s in missing],
            "unknown_to_cadaster": [s.as_dict() for s in extra],
        }
        raise ConsistencyError(f"BU/cadaster zone coverage differs: {json.dumps(detail, ensure_ascii=False)}")

    reports: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    groups = iter_zone_groups(
        csv_path, layout, year=year, turn=turn, uf=uf, municipalities=wanted,
        expected_rows={p.scope: p.rows for p in plan.scopes},
    )
    total = len(plan.scopes)
    for index, (scope, rows) in enumerate(groups, start=1):
        cadastro = load_zone_snapshot(conn, year=year, turn=turn, uf=uf, municipality=scope.municipality, zone=scope.zone)
        prepared = _prepare_group(manifest, layout, scope, rows, cadastro)
        report = prepared.report(status="dry_run") if dry_run else import_prepared(conn, prepared)
        reports.append(report)
        for warning in report.get("warnings", []):
            warnings.append({**scope.as_dict(), **warning})
        if progress is not None:
            progress(index, total, scope, report)

    status_counts: dict[str, int] = {}
    for report in reports:
        status = str(report["status"])
        status_counts[status] = status_counts.get(status, 0) + 1
    vote_records = sum(int(r.get("vote_records", 0)) for r in reports)
    municipalities_done = sorted({r["scope"]["municipality"] for r in reports})
    return {
        "status": "dry_run" if dry_run else "succeeded",
        "source": {
            "resource_name": manifest["source"]["resource_name"],
            "resource_id": manifest["source"]["resource_id"],
            "url": manifest["source"]["url"],
            "zip_sha256": manifest["zip"]["sha256"],
            "csv_name": manifest["csv"]["name"],
            "csv_sha256": manifest["csv"]["sha256"],
        },
        "scope": {"year": year, "turn": turn, "uf": uf},
        "preflight": {
            "rows": plan.rows,
            "municipalities": len(plan.municipalities),
            "zones": len(plan.scopes),
            "cadaster_coverage": "exact",
        },
        "import": {
            "municipalities": len(municipalities_done),
            "zones": len(reports),
            "zone_statuses": dict(sorted(status_counts.items())),
            "vote_records": vote_records,
            "warnings": len(warnings),
        },
        "warnings": warnings,
    }
