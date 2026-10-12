-- REPBrasil — pesquisas eleitorais e snapshots oficiais de totalização.
--
-- Somente fontes auditáveis entram nestas tabelas. Ausência permanece NULL/ausente;
-- nenhum loader pode transformar campo não publicado em zero. Pesquisas são estimativas
-- amostrais e totalização parcial não é resultado final.

CREATE TABLE IF NOT EXISTS poll_source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  dataset text NOT NULL,
  source_url text NOT NULL,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  content_sha256 char(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  parser_version text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (provider, dataset, content_sha256)
);

CREATE TABLE IF NOT EXISTS poll_institute (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  legal_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug)
);

-- O registro PesqEle pertence ao ciclo/ano e ao cargo, não a um turno específico:
-- uma única pesquisa pode testar cenários de 1º e 2º turno. O turno, quando auditável,
-- vive em poll_scenario.
CREATE TABLE IF NOT EXISTS poll (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year smallint NOT NULL CHECK (year BETWEEN 2012 AND 2200),
  office_code integer NOT NULL REFERENCES office(code),
  state_code char(2) REFERENCES state(code),
  municipality_id uuid REFERENCES municipality(id),
  registration_number text NOT NULL,
  institute_id uuid NOT NULL REFERENCES poll_institute(id),
  field_start date NOT NULL,
  field_end date NOT NULL,
  published_at timestamptz,
  sample_size integer,
  margin_error_pp numeric(6,3),
  confidence_level numeric(6,3),
  methodology text,
  source_id uuid NOT NULL REFERENCES poll_source(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (field_end >= field_start),
  CHECK (sample_size IS NULL OR sample_size > 0),
  CHECK (margin_error_pp IS NULL OR margin_error_pp >= 0),
  CHECK (confidence_level IS NULL OR (confidence_level > 0 AND confidence_level <= 100)),
  CHECK (municipality_id IS NULL OR state_code IS NOT NULL),
  UNIQUE NULLS NOT DISTINCT (
    year, registration_number, office_code, state_code, municipality_id, source_id
  )
);

CREATE INDEX IF NOT EXISTS poll_scope_idx
  ON poll (year, office_code, state_code, municipality_id, field_end DESC);
CREATE INDEX IF NOT EXISTS poll_registration_idx ON poll (registration_number);

CREATE TABLE IF NOT EXISTS poll_scenario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES poll(id) ON DELETE CASCADE,
  round smallint CHECK (round IN (1, 2)),
  name text NOT NULL,
  scenario_order integer NOT NULL CHECK (scenario_order >= 0),
  UNIQUE (poll_id, scenario_order)
);

CREATE INDEX IF NOT EXISTS poll_scenario_round_idx ON poll_scenario (poll_id, round);

CREATE TABLE IF NOT EXISTS poll_result (
  id bigserial PRIMARY KEY,
  scenario_id uuid NOT NULL REFERENCES poll_scenario(id) ON DELETE CASCADE,
  option_order integer NOT NULL CHECK (option_order >= 0),
  option_label text NOT NULL,
  option_kind text NOT NULL CHECK (option_kind IN ('candidate', 'blank_null', 'undecided', 'other')),
  candidacy_id uuid REFERENCES candidacy(id),
  party_acronym text,
  percentage numeric(6,3),
  CHECK (percentage IS NULL OR (percentage >= 0 AND percentage <= 100)),
  CHECK (candidacy_id IS NULL OR option_kind = 'candidate'),
  UNIQUE (scenario_id, option_order)
);

CREATE INDEX IF NOT EXISTS poll_result_candidacy_idx
  ON poll_result (candidacy_id) WHERE candidacy_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS totalization_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id uuid NOT NULL REFERENCES election(id) ON DELETE CASCADE,
  office_code integer NOT NULL REFERENCES office(code),
  scope text NOT NULL CHECK (scope IN ('national', 'state', 'municipal')),
  state_code char(2) REFERENCES state(code),
  municipality_id uuid REFERENCES municipality(id),
  captured_at timestamptz NOT NULL DEFAULT now(),
  tse_generated_at timestamptz,
  status text NOT NULL CHECK (status IN ('not_started', 'partial', 'final')),
  counted_sections integer,
  total_sections integer,
  counted_percent numeric(7,4),
  source_url text NOT NULL,
  content_sha256 char(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  parser_version text NOT NULL,
  ingestion_run_id uuid REFERENCES ingestion_run(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (counted_sections IS NULL OR counted_sections >= 0),
  CHECK (total_sections IS NULL OR total_sections >= 0),
  CHECK (counted_sections IS NULL OR total_sections IS NULL OR counted_sections <= total_sections),
  CHECK (counted_percent IS NULL OR (counted_percent >= 0 AND counted_percent <= 100)),
  CHECK (
    (scope = 'national' AND state_code IS NULL AND municipality_id IS NULL)
    OR (scope = 'state' AND state_code IS NOT NULL AND municipality_id IS NULL)
    OR (scope = 'municipal' AND state_code IS NOT NULL AND municipality_id IS NOT NULL)
  ),
  UNIQUE NULLS NOT DISTINCT (
    election_id, office_code, scope, state_code, municipality_id, content_sha256
  )
);

CREATE INDEX IF NOT EXISTS totalization_snapshot_latest_idx
  ON totalization_snapshot (
    election_id, office_code, scope, state_code, municipality_id,
    tse_generated_at DESC, captured_at DESC
  );

CREATE TABLE IF NOT EXISTS totalization_result (
  id bigserial PRIMARY KEY,
  snapshot_id uuid NOT NULL REFERENCES totalization_snapshot(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position > 0),
  candidacy_id uuid REFERENCES candidacy(id),
  candidate_number integer,
  option_label text NOT NULL,
  party_acronym text,
  votes bigint,
  percentage numeric(7,4),
  result_status text,
  CHECK (votes IS NULL OR votes >= 0),
  CHECK (percentage IS NULL OR (percentage >= 0 AND percentage <= 100)),
  UNIQUE (snapshot_id, position)
);

CREATE INDEX IF NOT EXISTS totalization_result_candidacy_idx
  ON totalization_result (candidacy_id) WHERE candidacy_id IS NOT NULL;
