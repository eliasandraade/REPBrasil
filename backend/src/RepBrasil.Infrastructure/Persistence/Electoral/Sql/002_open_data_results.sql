-- Origem: infra/db/002_open_data_results.sql do projeto Urnaí (eliasandraade/urnai, 007b161), sem mudança de semântica.
-- Resultados históricos oficiais: Portal de Dados Abertos TSE → Boletim de Urna (CSV).
--
-- Reaproveita do 001_init.sql: office (códigos de cargo), vote_kind (enum de
-- tipo de voto) e ingestion_run (lote de importação). Não usa candidate /
-- section_vote: o CSV do BU não publica SQ_CANDIDATO, e esses modelos exigem
-- identificadores que só viriam inventados.
--
-- Idempotente (IF NOT EXISTS): pode ser reaplicado em bancos existentes.

-- Versão de fonte: um arquivo oficial do TSE, identificado pelo SHA-256 do ZIP.
-- Uma nova publicação (URL/hash diferentes) gera outra linha; nada é sobrescrito.
CREATE TABLE IF NOT EXISTS open_data_source_file (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind = 'tse-open-data-bu'),
  portal text NOT NULL,
  dataset text NOT NULL,
  dataset_id text,
  resource_id text,
  resource_name text NOT NULL,
  url text NOT NULL,
  year smallint NOT NULL,
  turn smallint NOT NULL,
  uf char(2) NOT NULL,
  resource_metadata_modified text,
  downloaded_at timestamptz NOT NULL,
  zip_name text NOT NULL,
  zip_size bigint NOT NULL CHECK (zip_size > 0),
  zip_sha256 char(64) NOT NULL UNIQUE,
  zip_sha512 char(128) NOT NULL,
  official_checksum_algorithm text NOT NULL,
  official_checksum text NOT NULL,
  official_checksum_url text NOT NULL,
  csv_name text NOT NULL,
  csv_size bigint NOT NULL CHECK (csv_size > 0),
  csv_sha256 char(64) NOT NULL,
  layout_profile text NOT NULL,
  encoding text NOT NULL,
  delimiter text NOT NULL,
  source_generated_at text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ingestion_run ADD COLUMN IF NOT EXISTS source_file_id uuid REFERENCES open_data_source_file(id);
ALTER TABLE ingestion_run ADD COLUMN IF NOT EXISTS ea20_validation text;
ALTER TABLE ingestion_run ADD COLUMN IF NOT EXISTS fingerprint char(64);

-- No máximo uma importação bem-sucedida por arquivo + escopo: reimportar o
-- mesmo arquivo não duplica nada.
CREATE UNIQUE INDEX IF NOT EXISTS ingestion_run_open_data_scope_uidx
  ON ingestion_run (source_file_id, (scope->>'municipality'), (scope->>'zone'))
  WHERE status = 'succeeded' AND source_file_id IS NOT NULL;

-- Votável oficial. Identidade = eleição + cargo + tipo + número (nunca nome).
CREATE TABLE IF NOT EXISTS votable (
  id bigserial PRIMARY KEY,
  election_code integer NOT NULL,
  office_code integer NOT NULL REFERENCES office(code),
  vote_kind vote_kind NOT NULL,
  type_code smallint NOT NULL,
  type_description text NOT NULL,
  number integer NOT NULL,
  name text,
  party_number integer,
  party_acronym text,
  party_name text,
  UNIQUE (election_code, office_code, type_code, number)
);

-- Uma urna (seção principal) × cargo, por lote. Métricas estruturais são
-- guardadas uma vez (nunca somadas entre linhas). NULL = não informado.
CREATE TABLE IF NOT EXISTS section_office_result (
  id bigserial PRIMARY KEY,
  ingestion_run_id uuid NOT NULL REFERENCES ingestion_run(id) ON DELETE CASCADE,
  year smallint NOT NULL,
  turn smallint NOT NULL,
  pleito_code integer,
  election_code integer NOT NULL,
  election_description text,
  uf char(2) NOT NULL,
  municipality_tse_code char(5) NOT NULL,
  municipality_name text,
  zone integer NOT NULL,
  section integer NOT NULL,
  office_code integer NOT NULL REFERENCES office(code),
  office_name text,
  aggregated_sections integer[] NOT NULL DEFAULT '{}',
  polling_place_code integer,
  eligible integer CHECK (eligible >= 0),
  turnout integer CHECK (turnout >= 0),
  abstentions integer CHECK (abstentions >= 0),
  urn_type_code smallint,
  urn_type_description text,
  urn_number integer,
  bu_received_at timestamp,
  bu_emitted_at timestamp,
  opened_at timestamp,
  closed_at timestamp,
  biometric_not_enabled integer,
  votes_total integer NOT NULL CHECK (votes_total >= 0),
  UNIQUE (ingestion_run_id, election_code, municipality_tse_code, zone, section, office_code)
);

CREATE INDEX IF NOT EXISTS section_office_result_lookup_idx
  ON section_office_result (year, turn, uf, municipality_tse_code, zone, section, office_code);

CREATE TABLE IF NOT EXISTS section_office_vote (
  id bigserial PRIMARY KEY,
  result_id bigint NOT NULL REFERENCES section_office_result(id) ON DELETE CASCADE,
  votable_id bigint NOT NULL REFERENCES votable(id),
  votes integer NOT NULL CHECK (votes >= 0),
  source_row_hash char(64) NOT NULL,
  source_line bigint NOT NULL,
  UNIQUE (result_id, votable_id),
  UNIQUE (result_id, source_row_hash)
);
