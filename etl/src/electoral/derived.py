"""Agregados DERIVADOS do BU vigente (migration 008): recálculo explícito e auditável.

`votable_zone_votes_current` e `zone_office_totals_current` são materialized views sobre os
lotes vigentes do Boletim de Urna. Depois de importar (ou substituir) lotes do BU, o refresh
recalcula os agregados e grava em `derived_refresh` quantos lotes existiam no cálculo — a API
compara com os lotes atuais e sinaliza agregados defasados em vez de servir números velhos.

REFRESH ... CONCURRENTLY mantém as leituras da API disponíveis durante o recálculo.
"""

from __future__ import annotations

from typing import Any

import psycopg

VIEWS = ("votable_zone_votes_current", "zone_office_totals_current")


def refresh_derived(conn: psycopg.Connection) -> dict[str, Any]:
    """Recalcula os agregados derivados (conexão em autocommit: um comando por vez)."""
    report: dict[str, Any] = {"status": "succeeded", "views": {}}
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass('derived_refresh') IS NOT NULL")
        if not cur.fetchone()[0]:
            raise RuntimeError("electoral schema missing derived_refresh; apply the EF migration AddXrayDerived")
        cur.execute(
            "SELECT count(*), max(finished_at) FROM ingestion_run WHERE source = 'tse-open-data-bu' AND status = 'succeeded'"
        )
        runs, last = cur.fetchone()
        for view in VIEWS:
            cur.execute(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {view}")
            cur.execute(f"SELECT count(*) FROM {view}")
            report["views"][view] = int(cur.fetchone()[0])
        cur.execute(
            """INSERT INTO derived_refresh (view_name, refreshed_at, bu_runs, bu_last_finished_at)
               SELECT v, now(), %s, %s FROM unnest(%s::text[]) AS v
               ON CONFLICT (view_name) DO UPDATE SET refreshed_at = EXCLUDED.refreshed_at,
                 bu_runs = EXCLUDED.bu_runs, bu_last_finished_at = EXCLUDED.bu_last_finished_at""",
            (runs, last, list(VIEWS)),
        )
    report["bu_runs"] = int(runs)
    report["bu_last_finished_at"] = last.isoformat() if last else None
    return report
