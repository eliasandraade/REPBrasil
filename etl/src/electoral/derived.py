"""Agregados DERIVADOS do BU vigente com serving híbrido auditável.

As materialized views ``*_live`` são recalculadas a partir dos fatos ainda presentes no
Postgres. Os nomes públicos ``*_current`` são views de serving: escopos quentes vêm de
``*_live`` e escopos arquivados vêm das tabelas persistentes de snapshot.

``derived_refresh`` continua registrando os nomes lógicos ``*_current`` para manter a
semântica de freshness da API. REFRESH ... CONCURRENTLY mantém as leituras disponíveis.
"""

from __future__ import annotations

from typing import Any

import psycopg

VIEWS = (
    ("votable_zone_votes_live", "votable_zone_votes_current"),
    ("zone_office_totals_live", "zone_office_totals_current"),
)


def refresh_derived(conn: psycopg.Connection) -> dict[str, Any]:
    """Recalcula somente os agregados live; snapshots arquivados permanecem imutáveis."""
    report: dict[str, Any] = {"status": "succeeded", "views": {}}
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass('derived_refresh') IS NOT NULL")
        if not cur.fetchone()[0]:
            raise RuntimeError("electoral schema missing derived_refresh; apply the EF migration AddXrayDerived")
        cur.execute(
            "SELECT count(*), max(finished_at) FROM ingestion_run WHERE source = 'tse-open-data-bu' AND status = 'succeeded'"
        )
        runs, last = cur.fetchone()
        logical_names: list[str] = []
        for physical, logical in VIEWS:
            cur.execute(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {physical}")
            cur.execute(f"SELECT count(*) FROM {physical}")
            report["views"][logical] = int(cur.fetchone()[0])
            logical_names.append(logical)
        cur.execute(
            """INSERT INTO derived_refresh (view_name, refreshed_at, bu_runs, bu_last_finished_at)
               SELECT v, now(), %s, %s FROM unnest(%s::text[]) AS v
               ON CONFLICT (view_name) DO UPDATE SET refreshed_at = EXCLUDED.refreshed_at,
                 bu_runs = EXCLUDED.bu_runs, bu_last_finished_at = EXCLUDED.bu_last_finished_at""",
            (runs, last, logical_names),
        )
    report["bu_runs"] = int(runs)
    report["bu_last_finished_at"] = last.isoformat() if last else None
    return report
