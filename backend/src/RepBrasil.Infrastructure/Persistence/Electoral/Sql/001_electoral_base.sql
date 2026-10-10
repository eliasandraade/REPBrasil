-- Inteligência eleitoral do REPBrasil — base territorial e eleitoral.
-- Origem: infra/db/001_init.sql do projeto Urnaí (eliasandraade/urnai, 007b161),
-- portado sem mudança de semântica. Ver docs/URNAI_MIGRATION.md.
--
-- Executado com search_path = electoral, public (migration EF
-- AddElectoralIntelligence e testes do ETL): as tabelas nascem no schema
-- `electoral`; as extensões ficam em `public`, como as do restante do banco.
CREATE EXTENSION IF NOT EXISTS postgis SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;

CREATE TABLE election (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year smallint NOT NULL,
  round smallint NOT NULL,
  election_date date NOT NULL,
  pleito_code integer NOT NULL,
  federal_election_code integer,
  state_election_code integer,
  tse_cycle text NOT NULL,
  environment text NOT NULL DEFAULT 'oficial',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pleito_code, round)
);

CREATE TABLE state (
  code char(2) PRIMARY KEY,
  name text NOT NULL,
  ibge_code integer,
  geom geometry(MultiPolygon, 4326)
);

CREATE TABLE municipality (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code char(2) NOT NULL REFERENCES state(code),
  tse_code char(5) NOT NULL,
  ibge_code integer,
  name text NOT NULL,
  slug text NOT NULL,
  geom geometry(MultiPolygon, 4326),
  centroid geometry(Point, 4326),
  UNIQUE (state_code, tse_code),
  UNIQUE (state_code, slug)
);

CREATE INDEX municipality_geom_gix ON municipality USING gist(geom);
CREATE INDEX municipality_name_trgm ON municipality USING gin(name gin_trgm_ops);

CREATE TABLE electoral_zone (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code char(2) NOT NULL REFERENCES state(code),
  zone_number integer NOT NULL,
  UNIQUE (state_code, zone_number)
);

CREATE TABLE zone_municipality (
  zone_id uuid NOT NULL REFERENCES electoral_zone(id) ON DELETE CASCADE,
  municipality_id uuid NOT NULL REFERENCES municipality(id) ON DELETE CASCADE,
  election_id uuid NOT NULL REFERENCES election(id) ON DELETE CASCADE,
  PRIMARY KEY (zone_id, municipality_id, election_id)
);

CREATE TABLE polling_place (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id uuid NOT NULL REFERENCES election(id) ON DELETE CASCADE,
  municipality_id uuid NOT NULL REFERENCES municipality(id) ON DELETE CASCADE,
  zone_id uuid NOT NULL REFERENCES electoral_zone(id),
  tse_location_code text,
  name text NOT NULL,
  address text,
  neighborhood text,
  postal_code text,
  geom geometry(Point, 4326),
  geocode_provider text,
  geocode_quality numeric(5,4),
  geocoded_at timestamptz,
  source_updated_at timestamptz,
  UNIQUE (election_id, municipality_id, zone_id, tse_location_code)
);

CREATE INDEX polling_place_geom_gix ON polling_place USING gist(geom);

CREATE TYPE section_status AS ENUM (
  'unknown',
  'received',
  'not_installed',
  'not_counted',
  'annulled',
  'totalized'
);

CREATE TABLE electoral_section (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id uuid NOT NULL REFERENCES election(id) ON DELETE CASCADE,
  municipality_id uuid NOT NULL REFERENCES municipality(id) ON DELETE CASCADE,
  zone_id uuid NOT NULL REFERENCES electoral_zone(id),
  polling_place_id uuid REFERENCES polling_place(id),
  section_number integer NOT NULL,
  principal_section_number integer,
  is_aggregated boolean NOT NULL DEFAULT false,
  status section_status NOT NULL DEFAULT 'unknown',
  eligible_voters integer,
  turnout integer,
  abstentions integer,
  tse_aux_generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (election_id, municipality_id, zone_id, section_number)
);

CREATE INDEX electoral_section_lookup_idx
  ON electoral_section (election_id, municipality_id, zone_id, section_number);

CREATE TABLE office (
  code integer PRIMARY KEY,
  name text NOT NULL,
  sort_order integer NOT NULL
);

INSERT INTO office(code, name, sort_order) VALUES
  (1, 'Presidente', 1),
  (3, 'Governador', 2),
  (5, 'Senador', 3),
  (6, 'Deputado Federal', 4),
  (7, 'Deputado Estadual', 5),
  (8, 'Deputado Distrital', 5)
ON CONFLICT DO NOTHING;

CREATE TABLE party (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number integer NOT NULL,
  acronym text NOT NULL,
  name text,
  UNIQUE (number, acronym)
);

CREATE TABLE federation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text,
  acronym text,
  name text
);

CREATE TABLE candidate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id uuid NOT NULL REFERENCES election(id) ON DELETE CASCADE,
  state_code char(2),
  office_code integer NOT NULL REFERENCES office(code),
  tse_sequence bigint NOT NULL,
  ballot_number integer NOT NULL,
  ballot_name text NOT NULL,
  full_name text,
  party_id uuid REFERENCES party(id),
  federation_id uuid REFERENCES federation(id),
  status text,
  photo_url text,
  UNIQUE (election_id, tse_sequence)
);

CREATE TYPE vote_kind AS ENUM (
  'candidate',
  'party_legend',
  'blank',
  'null',
  'technical_null',
  'other'
);

CREATE TABLE section_vote (
  id bigserial PRIMARY KEY,
  section_id uuid NOT NULL REFERENCES electoral_section(id) ON DELETE CASCADE,
  office_code integer NOT NULL REFERENCES office(code),
  candidate_id uuid REFERENCES candidate(id),
  party_id uuid REFERENCES party(id),
  vote_kind vote_kind NOT NULL,
  votes integer NOT NULL CHECK (votes >= 0),
  source_hash text,
  UNIQUE NULLS NOT DISTINCT (
    section_id, office_code, candidate_id, party_id, vote_kind
  )
);

CREATE INDEX section_vote_section_office_idx
  ON section_vote(section_id, office_code);

CREATE INDEX section_vote_candidate_idx
  ON section_vote(candidate_id);

CREATE TABLE urna_artifact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES electoral_section(id) ON DELETE CASCADE,
  reception_hash text NOT NULL,
  source_status text,
  received_at timestamptz,
  filename text NOT NULL,
  file_type text NOT NULL,
  source_url text,
  content_sha256 text,
  parsed_at timestamptz,
  UNIQUE (section_id, reception_hash, filename)
);

CREATE TABLE ingestion_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  election_id uuid REFERENCES election(id),
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text
);
