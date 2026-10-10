-- Camada híbrida de serving eleitoral.
--
-- Os agregados calculáveis do BU continuam sendo atualizados em materialized views *_live.
-- Quando um escopo (ano, turno, UF) é arquivado no lake e recebe snapshot confirmado,
-- os nomes *_current passam a servir o snapshot persistente daquele escopo. Isso permite
-- remover os fatos detalhados do Postgres sem perder rankings, mapas ou totais por zona.

ALTER MATERIALIZED VIEW IF EXISTS votable_zone_votes_current RENAME TO votable_zone_votes_live;
ALTER MATERIALIZED VIEW IF EXISTS zone_office_totals_current RENAME TO zone_office_totals_live;

CREATE TABLE IF NOT EXISTS votable_zone_votes_archive AS
SELECT * FROM votable_zone_votes_live WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS votable_zone_votes_archive_uidx
  ON votable_zone_votes_archive (year, turn, uf, municipality_tse_code, zone, office_code, votable_id);
CREATE INDEX IF NOT EXISTS votable_zone_votes_archive_votable_idx
  ON votable_zone_votes_archive (votable_id, year, turn);

CREATE TABLE IF NOT EXISTS zone_office_totals_archive AS
SELECT * FROM zone_office_totals_live WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS zone_office_totals_archive_uidx
  ON zone_office_totals_archive (year, turn, uf, municipality_tse_code, zone, office_code);

CREATE TABLE IF NOT EXISTS derived_archive_scope (
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

CREATE VIEW votable_zone_votes_current AS
SELECT l.*
  FROM votable_zone_votes_live l
 WHERE NOT EXISTS (
   SELECT 1 FROM derived_archive_scope s
    WHERE s.year = l.year AND s.turn = l.turn AND s.uf = l.uf
 )
UNION ALL
SELECT a.*
  FROM votable_zone_votes_archive a
  JOIN derived_archive_scope s
    ON s.year = a.year AND s.turn = a.turn AND s.uf = a.uf;

CREATE VIEW zone_office_totals_current AS
SELECT l.*
  FROM zone_office_totals_live l
 WHERE NOT EXISTS (
   SELECT 1 FROM derived_archive_scope s
    WHERE s.year = l.year AND s.turn = l.turn AND s.uf = l.uf
 )
UNION ALL
SELECT a.*
  FROM zone_office_totals_archive a
  JOIN derived_archive_scope s
    ON s.year = a.year AND s.turn = a.turn AND s.uf = a.uf;
