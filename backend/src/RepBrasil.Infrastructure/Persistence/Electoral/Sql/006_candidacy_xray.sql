-- Raio X eleitoral: enriquecimentos versionados de candidatura e visão canônica
-- de voto por candidatura × seção. Somente aditivo; fatos brutos do BU permanecem
-- imutáveis em section_office_result/section_office_vote.

ALTER TABLE open_data_source_file DROP CONSTRAINT IF EXISTS open_data_source_file_kind_known;
ALTER TABLE open_data_source_file ADD CONSTRAINT open_data_source_file_kind_known
  CHECK (kind IN (
    'tse-open-data-bu',
    'tse-open-data-polling-places',
    'tse-open-data-municipality-codes',
    'tse-open-data-candidates',
    'tse-open-data-candidacy-history',
    'tse-open-data-candidate-assets',
    'tse-open-data-candidate-complement',
    'tse-open-data-candidate-social-network',
    'tse-open-data-government-proposal',
    'tse-open-data-criminal-certificate',
    'tse-open-data-candidate-invoice',
    'tse-open-data-campaign-accounts',
    'tse-open-data-campaign-bank-statements',
    'tse-open-data-campaign-fiscal-documents'
  ));

-- Eleições municipais usam SG_UE municipal, portanto a unidade eleitoral não
-- pode ficar limitada a char(2). O escopo passa a reconhecer explicitamente o
-- nível municipal sem alterar as identidades já existentes de BR/UF.
ALTER TABLE contest DROP CONSTRAINT IF EXISTS contest_scope_check;
ALTER TABLE contest ALTER COLUMN electoral_unit TYPE text USING btrim(electoral_unit::text);
ALTER TABLE contest ADD CONSTRAINT contest_scope_check
  CHECK (scope IN ('federal', 'state', 'municipal'));

-- Bens declarados ao TSE pertencem à candidatura daquele pleito, não à pessoa
-- atemporalmente. Isso permite mostrar evolução patrimonial sem misturar eleições.
CREATE TABLE IF NOT EXISTS candidacy_asset (
  id bigserial PRIMARY KEY,
  candidacy_id uuid NOT NULL REFERENCES candidacy(id) ON DELETE CASCADE,
  asset_type_code integer,
  asset_type text,
  description text,
  value numeric(18,2) NOT NULL CHECK (value >= 0),
  source_file_id uuid NOT NULL REFERENCES open_data_source_file(id),
  ingestion_run_id uuid NOT NULL REFERENCES ingestion_run(id),
  source_member text NOT NULL,
  source_line bigint NOT NULL,
  source_row_hash char(64) NOT NULL,
  source_generated_at text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidacy_id, source_row_hash)
);

CREATE INDEX IF NOT EXISTS candidacy_asset_candidacy_idx ON candidacy_asset (candidacy_id);

-- Registros complementares cuja forma varia entre anos ficam preservados como
-- JSON sanitizado, sempre com tipo e proveniência. O ETL NÃO deve gravar CPF,
-- título eleitoral, e-mail, telefone ou outro identificador pessoal bruto aqui.
CREATE TABLE IF NOT EXISTS candidacy_source_record (
  id bigserial PRIMARY KEY,
  candidacy_id uuid NOT NULL REFERENCES candidacy(id) ON DELETE CASCADE,
  record_kind text NOT NULL CHECK (record_kind IN (
    'complement', 'social_network', 'government_proposal',
    'criminal_certificate', 'candidate_invoice'
  )),
  payload jsonb NOT NULL,
  source_file_id uuid NOT NULL REFERENCES open_data_source_file(id),
  ingestion_run_id uuid NOT NULL REFERENCES ingestion_run(id),
  source_member text NOT NULL,
  source_line bigint NOT NULL,
  source_row_hash char(64) NOT NULL,
  source_generated_at text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidacy_id, record_kind, source_row_hash)
);

CREATE INDEX IF NOT EXISTS candidacy_source_record_lookup_idx
  ON candidacy_source_record (candidacy_id, record_kind);

-- Prestação de contas: camada normalizada mínima. O payload guarda os campos
-- públicos sanitizados da linha oficial para evolução do parser sem perda de
-- proveniência. Documentos de pessoa física devem ser HMAC, nunca CPF em claro.
CREATE TABLE IF NOT EXISTS candidacy_finance_record (
  id bigserial PRIMARY KEY,
  candidacy_id uuid NOT NULL REFERENCES candidacy(id) ON DELETE CASCADE,
  record_kind text NOT NULL CHECK (record_kind IN (
    'account', 'bank_statement', 'fiscal_expense', 'fiscal_revenue'
  )),
  direction text CHECK (direction IN ('revenue', 'expense')),
  occurred_on date,
  amount numeric(18,2) CHECK (amount IS NULL OR amount >= 0),
  category text,
  description text,
  counterparty_name text,
  counterparty_document_hash char(64),
  payload jsonb NOT NULL,
  source_file_id uuid NOT NULL REFERENCES open_data_source_file(id),
  ingestion_run_id uuid NOT NULL REFERENCES ingestion_run(id),
  source_member text NOT NULL,
  source_line bigint NOT NULL,
  source_row_hash char(64) NOT NULL,
  source_generated_at text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidacy_id, record_kind, source_row_hash)
);

CREATE INDEX IF NOT EXISTS candidacy_finance_record_lookup_idx
  ON candidacy_finance_record (candidacy_id, record_kind, occurred_on);

-- Índices das consultas do Raio X. A comparação nunca altera nem resume o fato
-- original; apenas percorre os vínculos oficiais já auditados.
CREATE INDEX IF NOT EXISTS votable_candidacy_candidacy_uf_votable_idx
  ON votable_candidacy (candidacy_id, uf, votable_id);
CREATE INDEX IF NOT EXISTS section_office_vote_votable_result_votes_idx
  ON section_office_vote (votable_id, result_id, votes);
CREATE INDEX IF NOT EXISTS section_office_result_xray_scope_idx
  ON section_office_result (year, turn, uf, municipality_tse_code, zone, section, office_code, ingestion_run_id);

-- Fonte vigente do BU por ano/turno/UF/município/zona. Publicações anteriores
-- continuam no banco para auditoria, mas nunca são somadas com a versão vigente.
CREATE OR REPLACE VIEW latest_bu_ingestion_run AS
SELECT DISTINCT ON (f.year, f.turn, f.uf, r.scope->>'municipality', r.scope->>'zone')
       r.id AS ingestion_run_id,
       f.year,
       f.turn,
       f.uf,
       r.scope->>'municipality' AS municipality_tse_code,
       (r.scope->>'zone')::int AS zone,
       r.finished_at,
       f.id AS source_file_id
  FROM ingestion_run r
  JOIN open_data_source_file f ON f.id = r.source_file_id
 WHERE r.source = 'tse-open-data-bu'
   AND r.status = 'succeeded'
 ORDER BY f.year, f.turn, f.uf, r.scope->>'municipality', r.scope->>'zone', r.finished_at DESC, r.id DESC;

-- Uma linha = voto nominal de uma candidatura em uma seção principal do BU
-- vigente. section_members é o conjunto real representado pela urna (seção
-- principal + agregadas). Comparação entre eleições em nível de seção só é
-- like-for-like quando section_members for idêntico.
CREATE OR REPLACE VIEW candidacy_section_vote_current AS
SELECT vc.candidacy_id,
       v.votable_id,
       r.year,
       r.turn,
       r.election_code,
       r.uf,
       r.municipality_tse_code,
       r.municipality_name,
       r.zone,
       r.section,
       ARRAY(
         SELECT DISTINCT member
           FROM unnest(array_prepend(r.section, COALESCE(r.aggregated_sections, '{}'::integer[]))) member
          ORDER BY member
       ) AS section_members,
       r.office_code,
       r.office_name,
       v.votes,
       r.eligible,
       r.turnout,
       r.abstentions,
       r.ingestion_run_id
  FROM latest_bu_ingestion_run latest
  JOIN section_office_result r ON r.ingestion_run_id = latest.ingestion_run_id
  JOIN section_office_vote v ON v.result_id = r.id
  JOIN votable_candidacy vc ON vc.votable_id = v.votable_id AND vc.uf = r.uf;
