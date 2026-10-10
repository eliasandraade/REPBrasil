"""Persistência em PostgreSQL (schema `electoral`, script 002_open_data_results.sql).

Garantias:
- Uma transação por importação: ou entra tudo, ou nada.
- Idempotência: o mesmo arquivo (SHA-256 do ZIP) + escopo já importado com o
  mesmo fingerprint retorna o lote existente sem escrever nada.
- Versionamento: arquivo novo do TSE ⇒ nova `open_data_source_file` e novo
  lote; lotes antigos permanecem consultáveis.
- Votável existente com atributos diferentes ⇒ erro (nunca sobrescreve).
- Falhas são registradas em `ingestion_run` (status `failed`) para auditoria.
"""
from __future__ import annotations

import json
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from .pipeline import PreparedImport
from .results import ConsistencyError

SOURCE = "tse-open-data-bu"
REQUIRED_TABLES = ("open_data_source_file", "votable", "section_office_result", "section_office_vote", "ingestion_run", "office")


class StoreError(RuntimeError):
    pass


def _check_schema(cur: psycopg.Cursor) -> None:
    cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()")
    present = {r[0] for r in cur.fetchall()}
    missing = [t for t in REQUIRED_TABLES if t not in present]
    if missing:
        raise StoreError(f"electoral schema missing {missing}; apply the EF migration AddElectoralIntelligence (dotnet ef database update)")


def _source_file_id(cur: psycopg.Cursor, prepared: PreparedImport) -> str:
    m = prepared.manifest
    values = {
        "kind": SOURCE,
        "portal": m["source"]["portal"],
        "dataset": m["source"]["dataset"],
        "dataset_id": m["source"]["dataset_id"],
        "resource_id": m["source"]["resource_id"],
        "resource_name": m["source"]["resource_name"],
        "url": m["source"]["url"],
        "year": m["scope"]["year"],
        "turn": m["scope"]["turn"],
        "uf": m["scope"]["uf"],
        "resource_metadata_modified": m["source"]["metadata_modified"],
        "downloaded_at": m["downloaded_at"],
        "zip_name": m["zip"]["name"],
        "zip_size": m["zip"]["size"],
        "zip_sha256": m["zip"]["sha256"],
        "zip_sha512": m["zip"]["sha512"],
        "official_checksum_algorithm": m["official_checksum"]["algorithm"],
        "official_checksum": m["official_checksum"]["value"],
        "official_checksum_url": m["official_checksum"]["url"],
        "csv_name": m["csv"]["name"],
        "csv_size": m["csv"]["size"],
        "csv_sha256": m["csv"]["sha256"],
        "layout_profile": prepared.layout.profile,
        "encoding": prepared.layout.encoding,
        "delimiter": prepared.layout.delimiter,
        "source_generated_at": prepared.zone.generated_at,
    }
    cols = ", ".join(values)
    params = ", ".join(f"%({k})s" for k in values)
    cur.execute(
        f"INSERT INTO open_data_source_file ({cols}) VALUES ({params}) ON CONFLICT (zip_sha256) DO NOTHING RETURNING id",
        values,
    )
    row = cur.fetchone()
    if row:
        return str(row[0])
    cur.execute("SELECT id, csv_sha256, url FROM open_data_source_file WHERE zip_sha256 = %s", (values["zip_sha256"],))
    existing = cur.fetchone()
    assert existing is not None
    if existing[1].strip() != values["csv_sha256"]:
        raise StoreError("same ZIP SHA-256 registered with a different CSV hash")
    return str(existing[0])


# Cargos de eleição municipal (TSE): o mesmo número representa candidaturas
# diferentes em cada município, então o município faz parte da identidade.
MUNICIPAL_OFFICES = frozenset({11, 12, 13})


def votable_municipality(office_code: int, municipality: str) -> str | None:
    """Escopo municipal do votável: código TSE (5 dígitos) só para cargos municipais."""
    return str(municipality).zfill(5) if office_code in MUNICIPAL_OFFICES else None


def _upsert_votables(cur: psycopg.Cursor, prepared: PreparedImport) -> dict[Any, int]:
    ids: dict[Any, int] = {}
    uf = str(prepared.scope["uf"]).upper()
    for key, v in prepared.zone.votables.items():
        municipality = votable_municipality(key.office_code, prepared.scope["municipality"])
        cur.execute(
            """
            INSERT INTO votable (uf, election_code, office_code, vote_kind, type_code, type_description, number, name,
                                 party_number, party_acronym, party_name, municipality_tse_code)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (uf, election_code, office_code, type_code, number, municipality_tse_code) DO NOTHING
            RETURNING id
            """,
            (uf, key.election_code, key.office_code, v.vote_kind, key.type_code, v.type_description, key.number,
             v.name, v.party_number, v.party_acronym, v.party_name, municipality),
        )
        row = cur.fetchone()
        if row is None:
            cur.execute(
                """SELECT id, vote_kind::text, type_description, name, party_number, party_acronym, party_name
                   FROM votable WHERE uf=%s AND election_code=%s AND office_code=%s AND type_code=%s AND number=%s
                    AND municipality_tse_code IS NOT DISTINCT FROM %s""",
                (uf, key.election_code, key.office_code, key.type_code, key.number, municipality),
            )
            existing = cur.fetchone()
            assert existing is not None
            expected = (v.vote_kind, v.type_description, v.name, v.party_number, v.party_acronym, v.party_name)
            if tuple(existing[1:]) != expected:
                raise ConsistencyError(
                    f"votable {uf}/{municipality or '-'}/{key} already stored with different attributes {existing[1:]} vs {expected}"
                )
            row = existing
        ids[key] = int(row[0])
    return ids


def import_prepared(conn: psycopg.Connection, prepared: PreparedImport) -> dict[str, Any]:
    scope = prepared.scope
    try:
        with conn.transaction(), conn.cursor() as cur:
            _check_schema(cur)
            cur.execute("SELECT code FROM office")
            known_offices = {r[0] for r in cur.fetchall()}
            unknown = sorted(set(prepared.zone.offices) - known_offices)
            if unknown:
                raise ConsistencyError(f"office codes {unknown} are not registered in table office")

            source_id = _source_file_id(cur, prepared)
            cur.execute(
                """SELECT id, fingerprint FROM ingestion_run
                   WHERE source_file_id=%s AND status='succeeded' AND scope->>'municipality'=%s AND scope->>'zone'=%s""",
                (source_id, scope["municipality"], str(scope["zone"])),
            )
            existing = cur.fetchone()
            if existing:
                if existing[1].strip() != prepared.fingerprint:
                    raise StoreError("this file and scope were imported before with a different fingerprint; refusing to overwrite")
                return prepared.report(batch_id=str(existing[0]), status="already_imported")

            cur.execute(
                """INSERT INTO ingestion_run (source, scope, status, source_file_id, ea20_validation, fingerprint)
                   VALUES (%s, %s, 'running', %s, %s, %s) RETURNING id""",
                (SOURCE, Jsonb({**scope, "zone": str(scope["zone"])}), source_id, prepared.ea20["status"], prepared.fingerprint),
            )
            batch_id = str(cur.fetchone()[0])  # type: ignore[index]
            votable_ids = _upsert_votables(cur, prepared)

            for (section, office, election), r in sorted(prepared.zone.results.items()):
                s = r.structural
                cur.execute(
                    """
                    INSERT INTO section_office_result (
                      ingestion_run_id, year, turn, pleito_code, election_code, election_description, uf,
                      municipality_tse_code, municipality_name, zone, section, office_code, office_name,
                      aggregated_sections, polling_place_code, eligible, turnout, abstentions,
                      urn_type_code, urn_type_description, urn_number, bu_received_at, bu_emitted_at,
                      opened_at, closed_at, biometric_not_enabled, votes_total)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    RETURNING id
                    """,
                    (batch_id, s["year"], s["turn"], s["pleito_code"], election, s["election_description"], s["uf"],
                     scope["municipality"], s["municipality_name"], prepared.zone.zone, section, office, s["office_name"],
                     list(s["aggregated_sections"]), s["polling_place_code"], s["eligible"], s["turnout"], s["abstentions"],  # type: ignore[arg-type]
                     s["urn_type_code"], s["urn_type_description"], s["urn_number"], s["bu_received_at"], s["bu_emitted_at"],
                     s["opened_at"], s["closed_at"], s["biometric_not_enabled"], r.votes_total),
                )
                result_id = cur.fetchone()[0]  # type: ignore[index]
                cur.executemany(
                    """INSERT INTO section_office_vote (result_id, votable_id, votes, source_row_hash, source_line)
                       VALUES (%s, %s, %s, %s, %s)""",
                    [(result_id, votable_ids[v.votable], v.votes, v.source_row_hash, v.line) for v in r.votes],
                )

            report = prepared.report(batch_id=batch_id, status="succeeded")
            cur.execute(
                "UPDATE ingestion_run SET status='succeeded', finished_at=now(), stats=%s WHERE id=%s",
                (Jsonb(report), batch_id),
            )
            return report
    except Exception as exc:
        _record_failure(conn, scope, str(exc))
        raise


def _record_failure(conn: psycopg.Connection, scope: dict[str, Any], message: str) -> None:
    try:
        with conn.transaction(), conn.cursor() as cur:
            cur.execute(
                """INSERT INTO ingestion_run (source, scope, status, finished_at, error)
                   VALUES (%s, %s, 'failed', now(), %s)""",
                (SOURCE, Jsonb({**scope, "zone": str(scope["zone"])}), message[:4000]),
            )
    except Exception:  # noqa: BLE001 - a falha original é a que importa
        pass


def dumps(report: dict[str, Any]) -> str:
    return json.dumps(report, ensure_ascii=False, indent=2, default=str)
