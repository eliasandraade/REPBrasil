-- REPBrasil — apuração ao vivo (2º turno presidencial e eleições seguintes).
--
-- Fonte única: arquivos de divulgação do TSE (EA11/EA12/EA14/EA15/EA20). Snapshots só entram quando o conteúdo
-- relevante muda (hash); o histórico nunca é reescrito. Eventos são a trilha de auditoria: imutáveis.
-- Modos official, simulation e replay ficam em linhas separadas de live_election e nunca se misturam.

CREATE TABLE IF NOT EXISTS live_election (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('official', 'simulation', 'replay')),
  environment text NOT NULL,
  cycle text NOT NULL,
  election_code integer NOT NULL CHECK (election_code > 0),
  office_code integer NOT NULL CHECK (office_code > 0),
  round smallint NOT NULL CHECK (round IN (1, 2)),
  pleito_code integer,
  first_round_code integer,
  election_date date,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (mode, environment, election_code, office_code)
);

-- Snapshots normalizados (br e uf com o JSON oficial bruto). Deduplicação contra o ÚLTIMO snapshot da abrangência
-- (feita na gravação): um retorno a um conteúdo anterior por reprocessamento do TSE é gravado de novo, na ordem.
CREATE TABLE IF NOT EXISTS live_snapshot (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  election_id integer NOT NULL REFERENCES live_election(id),
  scope_type text NOT NULL CHECK (scope_type IN ('br', 'uf', 'mu', 'zona')),
  scope_code text NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  payload_sha256 char(64) NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  tse_generation_id bigint,
  tse_generated_at timestamptz,
  tse_totalized_at timestamptz,
  ingested_at timestamptz NOT NULL,
  etag text,
  last_modified text,
  sections_totalized_pct numeric(13, 9),
  snapshot jsonb NOT NULL,
  raw jsonb
);

CREATE INDEX IF NOT EXISTS live_snapshot_scope_idx
  ON live_snapshot (election_id, scope_type, scope_code, id DESC);

-- Último resultado recebido por município/zona (alta cardinalidade: sem histórico completo por arquivo).
CREATE TABLE IF NOT EXISTS live_territory_latest (
  election_id integer NOT NULL REFERENCES live_election(id),
  scope_type text NOT NULL CHECK (scope_type IN ('mu', 'zona')),
  scope_code text NOT NULL,
  content_hash char(64) NOT NULL,
  tse_totalized_at timestamptz,
  ingested_at timestamptz NOT NULL,
  snapshot jsonb NOT NULL,
  PRIMARY KEY (election_id, scope_type, scope_code)
);

-- Trilha de auditoria: troca de liderança, definição matemática (md=e), totalização final, correções, alertas.
CREATE TABLE IF NOT EXISTS live_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  election_id integer NOT NULL REFERENCES live_election(id),
  event_type text NOT NULL,
  dedupe_key text,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'internal')),
  scope_type text NOT NULL DEFAULT 'br',
  scope_code text NOT NULL DEFAULT 'br',
  tse_at timestamptz,
  detected_at timestamptz NOT NULL,
  title text NOT NULL,
  detail text,
  sections_totalized_pct numeric(13, 9),
  snapshot_id bigint REFERENCES live_snapshot(id),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (election_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS live_event_election_idx ON live_event (election_id, id);

-- ETag/Last-Modified por URL: o GET condicional sobrevive a reinícios.
CREATE TABLE IF NOT EXISTS live_source_state (
  election_id integer NOT NULL REFERENCES live_election(id),
  url text NOT NULL,
  etag text,
  last_modified text,
  last_status integer,
  last_success_at timestamptz,
  last_change_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (election_id, url)
);

-- Fotos oficiais (diretório "fotos" do TSE), baixadas uma única vez por candidato.
CREATE TABLE IF NOT EXISTS live_candidate_photo (
  sqcand text PRIMARY KEY CHECK (sqcand ~ '^[0-9]{1,20}$'),
  content bytea NOT NULL,
  content_type text NOT NULL,
  etag text,
  source_url text NOT NULL,
  retrieved_at timestamptz NOT NULL DEFAULT now()
);

-- Imutabilidade da trilha: snapshots e eventos nunca são alterados nem apagados.
CREATE OR REPLACE FUNCTION live_audit_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'tabela % é trilha de auditoria imutável', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS live_snapshot_immutable ON live_snapshot;
CREATE TRIGGER live_snapshot_immutable BEFORE UPDATE OR DELETE ON live_snapshot
  FOR EACH ROW EXECUTE FUNCTION live_audit_immutable();

DROP TRIGGER IF EXISTS live_event_immutable ON live_event;
CREATE TRIGGER live_event_immutable BEFORE UPDATE OR DELETE ON live_event
  FOR EACH ROW EXECUTE FUNCTION live_audit_immutable();
