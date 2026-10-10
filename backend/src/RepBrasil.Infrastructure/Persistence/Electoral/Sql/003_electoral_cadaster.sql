-- Origem: infra/db/003_electoral_cadaster.sql do projeto Urnaí (eliasandraade/urnai, 007b161), sem mudança de semântica.
-- Cadastro eleitoral genérico (território → zona → local → seção) a partir de
-- fontes OFICIAIS do TSE, com proveniência por arquivo e por lote.
--
-- Reaproveita as tabelas do 001_init.sql (election, state, municipality,
-- electoral_zone, zone_municipality, polling_place, electoral_section) e a
-- tabela de versões de fonte do 002 (open_data_source_file). Nenhuma tabela
-- paralela: só colunas de proveniência e campos que a fonte publica.
--
-- Fontes (Portal de Dados Abertos TSE, CKAN):
--   - "Códigos oficiais de UF e municípios segundo o TSE e o IBGE"
--       → state, municipality (códigos TSE + IBGE, nomes)
--   - "Eleitorado por local de votação - <ano>"
--       → election, electoral_zone, zone_municipality, polling_place, electoral_section
--
-- Idempotente e não destrutivo: só ADD COLUMN / DROP NOT NULL / índices.
-- Pode ser reaplicado.

-- ---------------------------------------------------------------------------
-- Versões de fonte: o 002 aceitava apenas o BU. Os arquivos do cadastro não
-- têm checksum oficial publicado e um ZIP traz vários CSVs (um por UF), então
-- os campos específicos do BU deixam de ser obrigatórios para os outros tipos
-- — e continuam obrigatórios para o BU.
ALTER TABLE open_data_source_file DROP CONSTRAINT IF EXISTS open_data_source_file_kind_check;
ALTER TABLE open_data_source_file DROP CONSTRAINT IF EXISTS open_data_source_file_kind_known;
ALTER TABLE open_data_source_file ADD CONSTRAINT open_data_source_file_kind_known
  CHECK (kind IN ('tse-open-data-bu', 'tse-open-data-polling-places', 'tse-open-data-municipality-codes'));

ALTER TABLE open_data_source_file ALTER COLUMN turn DROP NOT NULL;
ALTER TABLE open_data_source_file ALTER COLUMN uf DROP NOT NULL;
ALTER TABLE open_data_source_file ALTER COLUMN year DROP NOT NULL;
ALTER TABLE open_data_source_file ALTER COLUMN official_checksum_algorithm DROP NOT NULL;
ALTER TABLE open_data_source_file ALTER COLUMN official_checksum DROP NOT NULL;
ALTER TABLE open_data_source_file ALTER COLUMN official_checksum_url DROP NOT NULL;
ALTER TABLE open_data_source_file ALTER COLUMN csv_name DROP NOT NULL;
ALTER TABLE open_data_source_file ALTER COLUMN csv_size DROP NOT NULL;
ALTER TABLE open_data_source_file ALTER COLUMN csv_sha256 DROP NOT NULL;
ALTER TABLE open_data_source_file ALTER COLUMN layout_profile DROP NOT NULL;
ALTER TABLE open_data_source_file ALTER COLUMN encoding DROP NOT NULL;
ALTER TABLE open_data_source_file ALTER COLUMN delimiter DROP NOT NULL;
-- 'verified' (checksum oficial conferido) | 'not_published' (o TSE não publica; só o SHA-256 calculado)
ALTER TABLE open_data_source_file ADD COLUMN IF NOT EXISTS checksum_status text;
UPDATE open_data_source_file SET checksum_status = 'verified' WHERE checksum_status IS NULL AND kind = 'tse-open-data-bu';

ALTER TABLE open_data_source_file DROP CONSTRAINT IF EXISTS open_data_source_file_bu_complete;
ALTER TABLE open_data_source_file ADD CONSTRAINT open_data_source_file_bu_complete CHECK (
  kind <> 'tse-open-data-bu' OR (
    year IS NOT NULL AND turn IS NOT NULL AND uf IS NOT NULL
    AND official_checksum IS NOT NULL AND official_checksum_url IS NOT NULL AND official_checksum_algorithm IS NOT NULL
    AND csv_name IS NOT NULL AND csv_size IS NOT NULL AND csv_sha256 IS NOT NULL
    AND layout_profile IS NOT NULL AND encoding IS NOT NULL AND delimiter IS NOT NULL
  )
);

-- O índice de idempotência do 002 vale só para o BU (escopo município + zona).
DROP INDEX IF EXISTS ingestion_run_open_data_scope_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS ingestion_run_open_data_scope_uidx
  ON ingestion_run (source_file_id, (scope->>'municipality'), (scope->>'zone'))
  WHERE status = 'succeeded' AND source_file_id IS NOT NULL AND source = 'tse-open-data-bu';

-- Cadastro: no máximo um lote bem-sucedido por arquivo + UF + turno + recorte.
CREATE UNIQUE INDEX IF NOT EXISTS ingestion_run_cadaster_scope_uidx
  ON ingestion_run (source_file_id, (scope->>'uf'), (scope->>'turn'), (scope->>'municipality'))
  WHERE status = 'succeeded' AND source = 'tse-open-data-cadaster';

-- ---------------------------------------------------------------------------
-- Eleição: identidade explícita = ano + turno (eleições gerais/ordinárias).
-- O cadastro não publica o código do pleito; ele entra quando o BU é importado.
ALTER TABLE election ALTER COLUMN pleito_code DROP NOT NULL;
ALTER TABLE election ADD COLUMN IF NOT EXISTS description text;
CREATE UNIQUE INDEX IF NOT EXISTS election_year_round_uidx ON election (year, round);

-- ---------------------------------------------------------------------------
-- Território (TSE ↔ IBGE). Identidade = código; nome e slug são apresentação.
ALTER TABLE state ADD COLUMN IF NOT EXISTS tse_code smallint;
ALTER TABLE state ADD COLUMN IF NOT EXISTS source_file_id uuid REFERENCES open_data_source_file(id);

ALTER TABLE municipality ADD COLUMN IF NOT EXISTS tse_name text;
ALTER TABLE municipality ADD COLUMN IF NOT EXISTS source_file_id uuid REFERENCES open_data_source_file(id);
CREATE UNIQUE INDEX IF NOT EXISTS municipality_ibge_code_uidx ON municipality (ibge_code) WHERE ibge_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS zone_municipality_municipality_idx ON zone_municipality (municipality_id, election_id);

-- ---------------------------------------------------------------------------
-- Local de votação. Coordenadas SÓ quando a fonte oficial publica
-- (NR_LATITUDE/NR_LONGITUDE); ausente = NULL, nunca estimado.
ALTER TABLE polling_place ADD COLUMN IF NOT EXISTS place_type text;
ALTER TABLE polling_place ADD COLUMN IF NOT EXISTS coordinates_source text;
ALTER TABLE polling_place ADD COLUMN IF NOT EXISTS source_file_id uuid REFERENCES open_data_source_file(id);
ALTER TABLE polling_place ADD COLUMN IF NOT EXISTS ingestion_run_id uuid REFERENCES ingestion_run(id);
CREATE INDEX IF NOT EXISTS polling_place_zone_idx ON polling_place (election_id, municipality_id, zone_id);

-- ---------------------------------------------------------------------------
-- Seção. Aptos por eleição pertencem à URNA (principal, após agregações).
-- Para agregadas a fonte publica 0 por definição (leiame): gravado NULL —
-- não é "zero eleitores", é "contado na principal".
ALTER TABLE electoral_section ADD COLUMN IF NOT EXISTS eligible_federal integer CHECK (eligible_federal >= 0);
ALTER TABLE electoral_section ADD COLUMN IF NOT EXISTS eligible_state integer CHECK (eligible_state >= 0);
-- QT_ELEITOR_SECAO: eleitorado originalmente vinculado à seção (outra medida;
-- não é o total de aptos da urna).
ALTER TABLE electoral_section ADD COLUMN IF NOT EXISTS section_electorate integer CHECK (section_electorate >= 0);
ALTER TABLE electoral_section ADD COLUMN IF NOT EXISTS source_file_id uuid REFERENCES open_data_source_file(id);
ALTER TABLE electoral_section ADD COLUMN IF NOT EXISTS ingestion_run_id uuid REFERENCES ingestion_run(id);
ALTER TABLE electoral_section ADD COLUMN IF NOT EXISTS source_line bigint;
ALTER TABLE electoral_section ADD COLUMN IF NOT EXISTS source_row_hash char(64);

ALTER TABLE electoral_section DROP CONSTRAINT IF EXISTS electoral_section_aggregation_shape;
ALTER TABLE electoral_section ADD CONSTRAINT electoral_section_aggregation_shape CHECK (
  (is_aggregated AND principal_section_number IS NOT NULL AND principal_section_number <> section_number
     AND eligible_federal IS NULL AND eligible_state IS NULL)
  OR (NOT is_aggregated AND (principal_section_number IS NULL OR principal_section_number = section_number))
);

CREATE INDEX IF NOT EXISTS electoral_section_principal_idx
  ON electoral_section (election_id, municipality_id, zone_id, principal_section_number) WHERE is_aggregated;
CREATE INDEX IF NOT EXISTS electoral_section_place_idx ON electoral_section (polling_place_id);
