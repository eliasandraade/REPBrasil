-- Camada híbrida de serving eleitoral.
--
-- Os nomes públicos *_current continuam sendo MATERIALIZED VIEWs, portanto o backend e
-- o refresh existente não mudam. Cada refresh recompõe:
--   1. escopos quentes diretamente dos fatos vigentes no Postgres; e
--   2. escopos frios das tabelas persistentes do schema electoral_archive.
--
-- O marcador derived_archive_scope só é gravado depois de um snapshot auditado. Assim,
-- ao remover os fatos detalhados de um escopo, o refresh seguinte continua servindo os
-- mesmos agregados a partir do snapshot persistente.

CREATE SCHEMA IF NOT EXISTS electoral_archive;

CREATE TABLE IF NOT EXISTS electoral_archive.votable_zone_votes AS
SELECT * FROM votable_zone_votes_current WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS votable_zone_votes_archive_uidx
  ON electoral_archive.votable_zone_votes
     (year, turn, uf, municipality_tse_code, zone, office_code, votable_id);
CREATE INDEX IF NOT EXISTS votable_zone_votes_archive_votable_idx
  ON electoral_archive.votable_zone_votes (votable_id, year, turn);

CREATE TABLE IF NOT EXISTS electoral_archive.zone_office_totals AS
SELECT * FROM zone_office_totals_current WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS zone_office_totals_archive_uidx
  ON electoral_archive.zone_office_totals
     (year, turn, uf, municipality_tse_code, zone, office_code);

CREATE TABLE IF NOT EXISTS electoral_archive.derived_archive_scope (
  year integer NOT NULL,
  turn integer NOT NULL,
  uf text NOT NULL CHECK (uf ~ '^[A-Z]{2}$'),
  snapshotted_at timestamptz NOT NULL DEFAULT now(),
  votable_rows bigint NOT NULL CHECK (votable_rows >= 0),
  votable_votes bigint NOT NULL CHECK (votable_votes >= 0),
  zone_rows bigint NOT NULL CHECK (zone_rows >= 0),
  zone_votes bigint NOT NULL CHECK (zone_votes >= 0),
  PRIMARY KEY (year, turn, uf)
);

DROP MATERIALIZED VIEW votable_zone_votes_current;

CREATE MATERIALIZED VIEW votable_zone_votes_current AS
WITH live AS (
  SELECT r.year, r.turn, r.uf, r.municipality_tse_code, r.zone, r.office_code, v.votable_id,
         sum(v.votes)::bigint AS votes,
         count(*)::int AS urns_with_votes
    FROM latest_bu_ingestion_run l
    JOIN section_office_result r ON r.ingestion_run_id = l.ingestion_run_id
    JOIN section_office_vote v ON v.result_id = r.id
   WHERE NOT EXISTS (
     SELECT 1
       FROM electoral_archive.derived_archive_scope a
      WHERE a.year = r.year AND a.turn = r.turn AND a.uf = r.uf
   )
   GROUP BY r.year, r.turn, r.uf, r.municipality_tse_code, r.zone, r.office_code, v.votable_id
)
SELECT * FROM live
UNION ALL
SELECT a.*
  FROM electoral_archive.votable_zone_votes a
  JOIN electoral_archive.derived_archive_scope s
    ON s.year = a.year AND s.turn = a.turn AND s.uf = a.uf;

CREATE UNIQUE INDEX votable_zone_votes_current_uidx
  ON votable_zone_votes_current
     (year, turn, uf, municipality_tse_code, zone, office_code, votable_id);
CREATE INDEX votable_zone_votes_current_votable_idx
  ON votable_zone_votes_current (votable_id, year, turn);

DROP MATERIALIZED VIEW zone_office_totals_current;

CREATE MATERIALIZED VIEW zone_office_totals_current AS
WITH res AS (
  SELECT r.id, r.year, r.turn, r.uf, r.municipality_tse_code, r.municipality_name,
         r.zone, r.office_code, r.eligible, r.turnout, r.abstentions
    FROM latest_bu_ingestion_run l
    JOIN section_office_result r ON r.ingestion_run_id = l.ingestion_run_id
   WHERE NOT EXISTS (
     SELECT 1
       FROM electoral_archive.derived_archive_scope a
      WHERE a.year = r.year AND a.turn = r.turn AND a.uf = r.uf
   )
), kinds AS (
  SELECT v.result_id,
         sum(v.votes) FILTER (WHERE t.vote_kind = 'candidate') AS nominal,
         sum(v.votes) FILTER (WHERE t.vote_kind = 'party_legend') AS legend,
         sum(v.votes) FILTER (WHERE t.vote_kind = 'blank') AS blank,
         sum(v.votes) FILTER (WHERE t.vote_kind IN ('null', 'technical_null')) AS nulls,
         sum(v.votes) AS total
    FROM res
    JOIN section_office_vote v ON v.result_id = res.id
    JOIN votable t ON t.id = v.votable_id
   GROUP BY v.result_id
), live AS (
  SELECT res.year, res.turn, res.uf, res.municipality_tse_code,
         max(res.municipality_name) AS municipality_name,
         res.zone, res.office_code,
         count(*)::int AS urns,
         CASE WHEN bool_and(res.eligible IS NOT NULL) THEN sum(res.eligible)::bigint END AS eligible,
         CASE WHEN bool_and(res.turnout IS NOT NULL) THEN sum(res.turnout)::bigint END AS turnout,
         CASE WHEN bool_and(res.abstentions IS NOT NULL) THEN sum(res.abstentions)::bigint END AS abstentions,
         COALESCE(sum(k.nominal), 0)::bigint AS nominal_votes,
         COALESCE(sum(k.legend), 0)::bigint AS legend_votes,
         COALESCE(sum(k.blank), 0)::bigint AS blank_votes,
         COALESCE(sum(k.nulls), 0)::bigint AS null_votes,
         COALESCE(sum(k.total), 0)::bigint AS votes_total
    FROM res
    LEFT JOIN kinds k ON k.result_id = res.id
   GROUP BY res.year, res.turn, res.uf, res.municipality_tse_code, res.zone, res.office_code
)
SELECT * FROM live
UNION ALL
SELECT a.*
  FROM electoral_archive.zone_office_totals a
  JOIN electoral_archive.derived_archive_scope s
    ON s.year = a.year AND s.turn = a.turn AND s.uf = a.uf;

CREATE UNIQUE INDEX zone_office_totals_current_uidx
  ON zone_office_totals_current
     (year, turn, uf, municipality_tse_code, zone, office_code);

INSERT INTO derived_refresh (view_name, refreshed_at, bu_runs, bu_last_finished_at)
SELECT v.view_name, now(), x.runs, x.last_finished
  FROM (VALUES ('votable_zone_votes_current'), ('zone_office_totals_current')) v(view_name)
 CROSS JOIN (
   SELECT count(*)::int AS runs, max(finished_at) AS last_finished
     FROM ingestion_run
    WHERE source = 'tse-open-data-bu' AND status = 'succeeded'
 ) x
ON CONFLICT (view_name) DO UPDATE SET
  refreshed_at = EXCLUDED.refreshed_at,
  bu_runs = EXCLUDED.bu_runs,
  bu_last_finished_at = EXCLUDED.bu_last_finished_at;
