"""Persistência do território e do cadastro eleitoral (001 + 003).

Garantias (mesma filosofia do BU):
- uma transação por importação; falha registrada como `failed`;
- idempotência: o mesmo conteúdo não gera escrita (lote `already_imported`
  ou `unchanged`);
- versionamento: cada arquivo oficial é uma linha em `open_data_source_file`
  e cada importação um lote em `ingestion_run`; linhas do cadastro apontam
  para o arquivo e o lote de origem;
- arquivo novo que DIVERGE do cadastro existente ⇒ `CadasterConflict`. Só
  `--supersede` explícito aplica a mudança, e o diff fica no lote. Seções que
  desaparecem nunca são apagadas automaticamente.
"""
from __future__ import annotations

import json
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from ..open_data.layout import DetectedLayout
from .errors import CadasterConflict, CadasterError, CadasterMissing, TerritoryMissing
from .polling_places import (
    COORDINATES_SOURCE,
    Cadaster,
    MunicipalityCadaster,
    PlaceRecord,
    SectionRecord,
    ZoneCadaster,
    snapshot_dict,
)
from .territories import Territories

SOURCE_TERRITORIES = "tse-open-data-territories"
SOURCE_CADASTER = "tse-open-data-cadaster"
REQUIRED_COLUMNS = {
    ("electoral_section", "eligible_federal"), ("electoral_section", "eligible_municipal"),
    ("polling_place", "coordinates_source"), ("municipality", "tse_name"),
}


def _check_schema(cur: psycopg.Cursor) -> None:
    cur.execute(
        "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema() AND (table_name, column_name) IN "
        "(('electoral_section','eligible_federal'),('electoral_section','eligible_municipal'),"
        "('polling_place','coordinates_source'),('municipality','tse_name'))"
    )
    if {tuple(r) for r in cur.fetchall()} != REQUIRED_COLUMNS:
        raise CadasterError("electoral schema missing or outdated; apply the EF migrations (dotnet ef database update)")


def _source_file_id(cur: psycopg.Cursor, manifest: dict[str, Any], *, year: int | None, layout: DetectedLayout | None) -> str:
    m = manifest
    checksum = m["official_checksum"]
    values = {
        "kind": m["kind"],
        "portal": m["source"]["portal"],
        "dataset": m["source"]["dataset"],
        "dataset_id": m["source"]["dataset_id"],
        "resource_id": m["source"]["resource_id"],
        "resource_name": m["source"]["resource_name"],
        "url": m["source"]["url"],
        "year": year,
        "resource_metadata_modified": m["source"]["metadata_modified"],
        "downloaded_at": m["downloaded_at"],
        "zip_name": m["zip"]["name"],
        "zip_size": m["zip"]["size"],
        "zip_sha256": m["zip"]["sha256"],
        "zip_sha512": m["zip"]["sha512"],
        "checksum_status": checksum["status"],
        "official_checksum_algorithm": checksum.get("algorithm"),
        "official_checksum": checksum.get("value"),
        "layout_profile": layout.profile if layout else None,
        "encoding": layout.encoding if layout else None,
        "delimiter": layout.delimiter if layout else None,
    }
    cols = ", ".join(values)
    params = ", ".join(f"%({k})s" for k in values)
    cur.execute(f"INSERT INTO open_data_source_file ({cols}) VALUES ({params}) ON CONFLICT (zip_sha256) DO NOTHING RETURNING id", values)
    row = cur.fetchone()
    if row:
        return str(row[0])
    cur.execute("SELECT id, kind FROM open_data_source_file WHERE zip_sha256 = %s", (values["zip_sha256"],))
    existing = cur.fetchone()
    assert existing is not None
    if existing[1] != values["kind"]:
        raise CadasterError(f"ZIP {values['zip_sha256']} already registered as {existing[1]}")
    return str(existing[0])


def _record_failure(conn: psycopg.Connection, source: str, scope: dict[str, Any], message: str) -> None:
    try:
        with conn.transaction(), conn.cursor() as cur:
            cur.execute(
                "INSERT INTO ingestion_run (source, scope, status, finished_at, error) VALUES (%s, %s, 'failed', now(), %s)",
                (source, Jsonb(scope), message[:4000]),
            )
    except Exception:  # noqa: BLE001
        pass


# ---------------------------------------------------------------------------
# Território


def import_territories(conn: psycopg.Connection, territories: Territories, manifest: dict[str, Any], member: dict[str, Any], layout: DetectedLayout) -> dict[str, Any]:
    scope = {"member": member["name"], "csv_sha256": member["sha256"]}
    try:
        with conn.transaction(), conn.cursor() as cur:
            _check_schema(cur)
            source_id = _source_file_id(cur, manifest, year=None, layout=layout)
            cur.execute(
                "SELECT id FROM ingestion_run WHERE source=%s AND source_file_id=%s AND status='succeeded'",
                (SOURCE_TERRITORIES, source_id),
            )
            done = cur.fetchone()
            if done:
                return {"status": "already_imported", "import_batch_id": str(done[0]), "states": len(territories.states), "municipalities": len(territories.municipalities)}

            states_new = municipalities_new = 0
            for s in sorted(territories.states.values(), key=lambda x: x.uf):
                cur.execute("SELECT name, ibge_code, tse_code FROM state WHERE code=%s", (s.uf,))
                current = cur.fetchone()
                if current is None:
                    cur.execute(
                        "INSERT INTO state (code, name, ibge_code, tse_code, source_file_id) VALUES (%s, %s, %s, %s, %s)",
                        (s.uf, s.name, s.ibge_code, s.tse_code, source_id),
                    )
                    states_new += 1
                    continue
                for label, have, want in (("name", current[0], s.name), ("ibge_code", current[1], s.ibge_code), ("tse_code", current[2], s.tse_code)):
                    if have is not None and have != want:
                        raise CadasterConflict(f"state {s.uf}: stored {label} {have!r} differs from the official {want!r}", {"state": s.uf, label: [have, want]})
                cur.execute(
                    "UPDATE state SET name=%s, ibge_code=%s, tse_code=%s, source_file_id=COALESCE(source_file_id, %s) WHERE code=%s",
                    (s.name, s.ibge_code, s.tse_code, source_id, s.uf),
                )

            cur.execute("SELECT state_code, tse_code, ibge_code, name, slug FROM municipality")
            existing = {(r[0], r[1]): r[2:] for r in cur.fetchall()}
            rows = []
            for key, m in sorted(territories.municipalities.items()):
                have = existing.get(key)
                if have is None:
                    rows.append((m.uf, m.tse_code, m.ibge_code, m.name, m.tse_name, m.slug, source_id))
                elif tuple(have) != (m.ibge_code, m.name, m.slug):
                    raise CadasterConflict(f"municipality {key}: stored {tuple(have)} differs from the official {(m.ibge_code, m.name, m.slug)}", {"municipality": list(key)})
            cur.executemany(
                "INSERT INTO municipality (state_code, tse_code, ibge_code, name, tse_name, slug, source_file_id) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                rows,
            )
            municipalities_new = len(rows)
            report = {
                "status": "succeeded",
                "source": {"dataset": manifest["source"]["dataset"], "resource_id": manifest["source"]["resource_id"],
                           "url": manifest["source"]["url"], "zip_sha256": manifest["zip"]["sha256"], "checksum": manifest["official_checksum"]["status"],
                           "csv_name": member["name"], "csv_sha256": member["sha256"], "generated_at": territories.generated_at},
                "states": len(territories.states),
                "states_inserted": states_new,
                "municipalities": len(territories.municipalities),
                "municipalities_inserted": municipalities_new,
            }
            cur.execute(
                "INSERT INTO ingestion_run (source, scope, status, finished_at, source_file_id, stats) VALUES (%s, %s, 'succeeded', now(), %s, %s) RETURNING id",
                (SOURCE_TERRITORIES, Jsonb(scope), source_id, Jsonb(report)),
            )
            report["import_batch_id"] = str(cur.fetchone()[0])  # type: ignore[index]
            return report
    except Exception as exc:
        _record_failure(conn, SOURCE_TERRITORIES, scope, str(exc))
        raise


# ---------------------------------------------------------------------------
# Cadastro eleitoral

_PLACE_FIELDS = ("name", "address", "neighborhood", "postal_code", "place_type", "latitude", "longitude")
_SECTION_FIELDS = (
    "place_code", "is_aggregated", "principal_number", "eligible_federal", "eligible_state", "section_electorate",
    "eligible_municipal",
)


def _round(v: float | None) -> float | None:
    return None if v is None else round(v, 7)


def _canonical(m: MunicipalityCadaster) -> tuple[dict[tuple[int, str], tuple[Any, ...]], dict[tuple[int, int], tuple[Any, ...]]]:
    places = {
        (z.number, p.code): (p.name, p.address, p.neighborhood, p.postal_code, p.place_type, _round(p.latitude), _round(p.longitude))
        for z in m.zones.values() for p in z.places.values()
    }
    sections = {
        (z.number, s.number): (s.place_code, s.is_aggregated, s.principal_number, s.eligible_federal, s.eligible_state,
                               s.section_electorate, s.eligible_municipal)
        for z in m.zones.values() for s in z.sections.values()
    }
    return places, sections


def _stored(cur: psycopg.Cursor, election_id: str, municipality_id: str):
    cur.execute(
        """SELECT z.zone_number, p.tse_location_code, p.name, p.address, p.neighborhood, p.postal_code, p.place_type,
                  ST_Y(p.geom), ST_X(p.geom)
             FROM polling_place p JOIN electoral_zone z ON z.id = p.zone_id
            WHERE p.election_id=%s AND p.municipality_id=%s""",
        (election_id, municipality_id),
    )
    places = {(r[0], r[1]): (r[2], r[3], r[4], r[5], r[6], _round(r[7]), _round(r[8])) for r in cur.fetchall()}
    cur.execute(
        """SELECT z.zone_number, s.section_number, p.tse_location_code, s.is_aggregated,
                  CASE WHEN s.is_aggregated THEN s.principal_section_number END,
                  s.eligible_federal, s.eligible_state, s.section_electorate, s.eligible_municipal
             FROM electoral_section s JOIN electoral_zone z ON z.id = s.zone_id LEFT JOIN polling_place p ON p.id = s.polling_place_id
            WHERE s.election_id=%s AND s.municipality_id=%s""",
        (election_id, municipality_id),
    )
    sections = {(r[0], r[1]): tuple(r[2:]) for r in cur.fetchall()}
    return places, sections


def _diff(old: dict[Any, tuple[Any, ...]], new: dict[Any, tuple[Any, ...]], fields: tuple[str, ...]) -> dict[str, Any]:
    added = sorted(set(new) - set(old))
    removed = sorted(set(old) - set(new))
    changed = []
    for key in sorted(set(old) & set(new)):
        if old[key] != new[key]:
            changed.append({"key": list(key), "changes": {f: [a, b] for f, a, b in zip(fields, old[key], new[key], strict=False) if a != b}})
    return {"added": [list(k) for k in added], "removed": [list(k) for k in removed], "changed": changed}


def _ensure_election(cur: psycopg.Cursor, cadaster: Cadaster) -> str:
    cur.execute(
        """INSERT INTO election (year, round, election_date, tse_cycle, description)
           VALUES (%s, %s, %s, %s, %s) ON CONFLICT (year, round) DO NOTHING RETURNING id""",
        (cadaster.year, cadaster.turn, cadaster.election_date, f"ele{cadaster.year}", cadaster.election_description),
    )
    row = cur.fetchone()
    if row:
        return str(row[0])
    cur.execute("SELECT id, election_date::text FROM election WHERE year=%s AND round=%s", (cadaster.year, cadaster.turn))
    existing = cur.fetchone()
    assert existing is not None
    if existing[1] != cadaster.election_date:
        raise CadasterConflict(
            f"election {cadaster.year}/{cadaster.turn} stored with date {existing[1]}, source says {cadaster.election_date}",
            {"election_date": [existing[1], cadaster.election_date]},
        )
    return str(existing[0])


def _zone_ids(cur: psycopg.Cursor, uf: str, numbers: set[int]) -> dict[int, str]:
    for n in sorted(numbers):
        cur.execute("INSERT INTO electoral_zone (state_code, zone_number) VALUES (%s, %s) ON CONFLICT DO NOTHING", (uf, n))
    cur.execute("SELECT zone_number, id FROM electoral_zone WHERE state_code=%s AND zone_number = ANY(%s)", (uf, sorted(numbers)))
    return {r[0]: str(r[1]) for r in cur.fetchall()}


def _write_municipality(cur, *, election_id, municipality_id, mun: MunicipalityCadaster, zone_ids, source_id, run_id) -> None:
    """Grava o município inteiro (novo, ou --supersede). Cada linha passa a
    apontar para o arquivo/lote que a contém."""
    for z in sorted(mun.zones.values(), key=lambda x: x.number):
        zone_id = zone_ids[z.number]
        cur.execute(
            "INSERT INTO zone_municipality (zone_id, municipality_id, election_id) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
            (zone_id, municipality_id, election_id),
        )
        place_ids: dict[str, str] = {}
        for p in sorted(z.places.values(), key=lambda x: x.code):
            geom = (p.longitude, p.latitude) if p.latitude is not None else (None, None)
            cur.execute(
                """INSERT INTO polling_place (election_id, municipality_id, zone_id, tse_location_code, name, address, neighborhood,
                                              postal_code, place_type, geom, coordinates_source, source_file_id, ingestion_run_id)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,
                           CASE WHEN %s::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(%s::float8, %s::float8), 4326) END,
                           %s,%s,%s)
                   ON CONFLICT (election_id, municipality_id, zone_id, tse_location_code) DO UPDATE SET
                     name=EXCLUDED.name, address=EXCLUDED.address, neighborhood=EXCLUDED.neighborhood, postal_code=EXCLUDED.postal_code,
                     place_type=EXCLUDED.place_type, geom=EXCLUDED.geom, coordinates_source=EXCLUDED.coordinates_source,
                     source_file_id=EXCLUDED.source_file_id, ingestion_run_id=EXCLUDED.ingestion_run_id
                   RETURNING id""",
                (election_id, municipality_id, zone_id, p.code, p.name, p.address, p.neighborhood, p.postal_code, p.place_type,
                 geom[0], geom[0], geom[1], p.coordinates_source, source_id, run_id),
            )
            place_ids[p.code] = str(cur.fetchone()[0])  # type: ignore[index]
        cur.executemany(
            """INSERT INTO electoral_section (election_id, municipality_id, zone_id, polling_place_id, section_number,
                                              principal_section_number, is_aggregated, eligible_federal, eligible_state,
                                              section_electorate, source_file_id, ingestion_run_id, source_line, source_row_hash,
                                              eligible_municipal)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (election_id, municipality_id, zone_id, section_number) DO UPDATE SET
                 polling_place_id=EXCLUDED.polling_place_id, principal_section_number=EXCLUDED.principal_section_number,
                 is_aggregated=EXCLUDED.is_aggregated, eligible_federal=EXCLUDED.eligible_federal, eligible_state=EXCLUDED.eligible_state,
                 section_electorate=EXCLUDED.section_electorate, eligible_municipal=EXCLUDED.eligible_municipal,
                 source_file_id=EXCLUDED.source_file_id,
                 ingestion_run_id=EXCLUDED.ingestion_run_id, source_line=EXCLUDED.source_line, source_row_hash=EXCLUDED.source_row_hash,
                 updated_at=now()""",
            [
                (election_id, municipality_id, zone_id, place_ids[s.place_code], s.number,
                 s.principal_number if s.is_aggregated else s.number, s.is_aggregated, s.eligible_federal, s.eligible_state,
                 s.section_electorate, source_id, run_id, s.line, s.row_hash, s.eligible_municipal)
                for s in sorted(z.sections.values(), key=lambda x: x.number)
            ],
        )


def import_cadaster(
    conn: psycopg.Connection,
    cadaster: Cadaster,
    manifest: dict[str, Any],
    member: dict[str, Any],
    layout: DetectedLayout,
    *,
    municipalities: list[str] | None = None,
    supersede: bool = False,
) -> dict[str, Any]:
    scope = {
        "year": cadaster.year,
        "turn": str(cadaster.turn),
        "uf": cadaster.uf,
        "municipality": ",".join(sorted(municipalities)) if municipalities else "*",
        "member": member["name"],
        "csv_sha256": member["sha256"],
    }
    try:
        with conn.transaction(), conn.cursor() as cur:
            _check_schema(cur)
            cur.execute("SELECT 1 FROM state WHERE code=%s", (cadaster.uf,))
            if cur.fetchone() is None:
                raise TerritoryMissing(f"state {cadaster.uf} is not registered; run import-territories first")
            source_id = _source_file_id(cur, manifest, year=cadaster.year, layout=layout)
            cur.execute(
                """SELECT id FROM ingestion_run WHERE source=%s AND source_file_id=%s AND status='succeeded'
                     AND scope->>'uf'=%s AND scope->>'turn'=%s AND scope->>'municipality'=%s""",
                (SOURCE_CADASTER, source_id, scope["uf"], scope["turn"], scope["municipality"]),
            )
            done = cur.fetchone()
            if done:
                return {"status": "already_imported", "import_batch_id": str(done[0]), "summary": cadaster.summary()}

            election_id = _ensure_election(cur, cadaster)
            cur.execute("SELECT tse_code, id FROM municipality WHERE state_code=%s", (cadaster.uf,))
            municipality_ids = {r[0].strip(): str(r[1]) for r in cur.fetchall()}
            unknown = sorted(set(cadaster.municipalities) - set(municipality_ids))
            if unknown:
                raise TerritoryMissing(f"municipalities {unknown} of {cadaster.uf} are not in the territory registry; run import-territories")

            cur.execute(
                """INSERT INTO ingestion_run (source, election_id, scope, status, source_file_id)
                   VALUES (%s, %s, %s, 'running', %s) RETURNING id""",
                (SOURCE_CADASTER, election_id, Jsonb(scope), source_id),
            )
            run_id = str(cur.fetchone()[0])  # type: ignore[index]
            zone_ids = _zone_ids(cur, cadaster.uf, {z for m in cadaster.municipalities.values() for z in m.zones})

            outcome: dict[str, list[str]] = {"inserted": [], "unchanged": [], "superseded": []}
            diffs: dict[str, Any] = {}
            for code, mun in sorted(cadaster.municipalities.items()):
                municipality_id = municipality_ids[code]
                old_places, old_sections = _stored(cur, election_id, municipality_id)
                new_places, new_sections = _canonical(mun)
                if not old_sections and not old_places:
                    kind = "inserted"
                elif old_places == new_places and old_sections == new_sections:
                    outcome["unchanged"].append(code)
                    continue
                else:
                    diff = {"polling_places": _diff(old_places, new_places, _PLACE_FIELDS),
                            "sections": _diff(old_sections, new_sections, _SECTION_FIELDS)}
                    if not supersede:
                        raise CadasterConflict(
                            f"municipality {code}: the official file {manifest['zip']['sha256'][:12]}… differs from the stored cadaster; "
                            "review the diff and re-run with --supersede to apply it",
                            {code: diff},
                        )
                    if diff["sections"]["removed"] or diff["polling_places"]["removed"]:
                        raise CadasterConflict(
                            f"municipality {code}: sections/places disappeared in the new file; refusing to delete them automatically",
                            {code: diff},
                        )
                    diffs[code] = diff
                    kind = "superseded"
                _write_municipality(cur, election_id=election_id, municipality_id=municipality_id, mun=mun,
                                    zone_ids=zone_ids, source_id=source_id, run_id=run_id)
                outcome[kind].append(code)

            report = {
                "status": "succeeded",
                "import_batch_id": run_id,
                "source": {"dataset": manifest["source"]["dataset"], "resource_id": manifest["source"]["resource_id"],
                           "resource_name": manifest["source"]["resource_name"], "url": manifest["source"]["url"],
                           "zip_sha256": manifest["zip"]["sha256"], "checksum": manifest["official_checksum"]["status"],
                           "csv_name": member["name"], "csv_sha256": member["sha256"], "generated_at": cadaster.generated_at},
                "layout": layout.as_dict(),
                "summary": cadaster.summary(),
                "municipalities": {k: len(v) for k, v in outcome.items()},
                "warnings": cadaster.warnings,
                "diff": diffs,
            }
            cur.execute("UPDATE ingestion_run SET status='succeeded', finished_at=now(), stats=%s WHERE id=%s", (Jsonb(report), run_id))
            return report
    except Exception as exc:
        _record_failure(conn, SOURCE_CADASTER, scope, str(exc))
        raise


# ---------------------------------------------------------------------------
# Leitura (reconciliação do BU contra o cadastro canônico)


def municipality_zones(conn: psycopg.Connection, *, year: int, turn: int, uf: str, municipality: str | int) -> list[int]:
    code = str(municipality).zfill(5)
    with conn.cursor() as cur:
        cur.execute(
            """SELECT m.id FROM municipality m WHERE m.state_code=%s AND m.tse_code=%s""",
            (uf.upper(), code),
        )
        if cur.fetchone() is None:
            raise TerritoryMissing(f"municipality {uf}/{code} is not in the territory registry")
        cur.execute(
            """SELECT DISTINCT z.zone_number
                 FROM electoral_section s
                 JOIN election e ON e.id = s.election_id
                 JOIN municipality m ON m.id = s.municipality_id
                 JOIN electoral_zone z ON z.id = s.zone_id
                WHERE e.year=%s AND e.round=%s AND m.state_code=%s AND m.tse_code=%s
                ORDER BY 1""",
            (year, turn, uf.upper(), code),
        )
        zones = [r[0] for r in cur.fetchall()]
    if not zones:
        raise CadasterMissing(f"no electoral cadaster for {uf}/{code} in {year}/{turn}; run import-electoral-cadaster")
    return zones


def load_zone_snapshot(conn: psycopg.Connection, *, year: int, turn: int, uf: str, municipality: str | int, zone: int) -> dict[str, Any]:
    code = str(municipality).zfill(5)
    zones = municipality_zones(conn, year=year, turn=turn, uf=uf, municipality=code)
    zc: ZoneCadaster | None = None
    if zone in zones:
        zc = ZoneCadaster(zone)
        with conn.cursor() as cur:
            cur.execute(
                """SELECT s.section_number, p.tse_location_code, s.is_aggregated, s.principal_section_number,
                          s.eligible_federal, s.eligible_state, s.section_electorate, COALESCE(s.source_line, 0), COALESCE(s.source_row_hash, ''),
                          p.name, s.eligible_municipal
                     FROM electoral_section s
                     JOIN election e ON e.id = s.election_id
                     JOIN municipality m ON m.id = s.municipality_id
                     JOIN electoral_zone z ON z.id = s.zone_id
                     JOIN polling_place p ON p.id = s.polling_place_id
                    WHERE e.year=%s AND e.round=%s AND m.state_code=%s AND m.tse_code=%s AND z.zone_number=%s""",
                (year, turn, uf.upper(), code, zone),
            )
            for r in cur.fetchall():
                zc.sections[r[0]] = SectionRecord(
                    zone, r[0], r[1], r[2], r[3] if r[2] else None, r[4], r[5], r[6], r[7], r[8], eligible_municipal=r[10]
                )
                zc.places.setdefault(r[1], PlaceRecord(zone, r[1], r[9], None, None, None, None, None, None))
    return snapshot_dict(tse_code=code, zone_numbers=zones, zone=zc, source={"kind": "database", "year": year, "turn": turn})


def dumps(report: dict[str, Any]) -> str:
    return json.dumps(report, ensure_ascii=False, indent=2, default=str)


__all__ = [
    "COORDINATES_SOURCE",
    "import_territories",
    "import_cadaster",
    "municipality_zones",
    "load_zone_snapshot",
    "dumps",
]
