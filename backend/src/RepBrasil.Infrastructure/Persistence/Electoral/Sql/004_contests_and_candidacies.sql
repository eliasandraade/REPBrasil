-- Inteligência eleitoral do REPBrasil — disputas, candidaturas e vínculo de identidade.
--
-- Separa conceitos que o modelo legado ("Elections"/"ElectionResults" em public)
-- mistura:
--   election   (001)  pleito oficial + turno (ex.: Eleições Gerais 2026, 1º turno)
--   contest    (004)  disputa dentro do pleito: CD_ELEICAO + cargo + abrangência
--                     (Presidente/BR, Governador/CE, Deputado Federal/CE…)
--   candidacy  (004)  candidatura oficial (SQ_CANDIDATO) numa disputa, com o
--                     partido, o número e a situação DAQUELA eleição
--   public."Persons"      identidade humana canônica (já existente)
--   public."Politicians"  perfil político do REPBrasil (já existente)
--
-- O vínculo votável do BU → candidatura fica em `votable_candidacy`, uma camada
-- de enriquecimento: nada aqui altera section_office_result/section_office_vote.
-- Falha de identidade nunca altera voto.
--
-- Executado com search_path = electoral, public. Somente aditivo.

-- ---------------------------------------------------------------------------
-- Cargos sem votação própria no BU (vices e suplentes) também são disputados
-- na candidatura oficial. Códigos CD_CARGO do TSE.
INSERT INTO office(code, name, sort_order) VALUES
  (2, 'Vice-Presidente', 11),
  (4, 'Vice-Governador', 12),
  (9, '1º Suplente', 13),
  (10, '2º Suplente', 14)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Nova fonte versionada: "Candidatos - <ano>" (consulta_cand_<ano>.zip).
ALTER TABLE open_data_source_file DROP CONSTRAINT IF EXISTS open_data_source_file_kind_known;
ALTER TABLE open_data_source_file ADD CONSTRAINT open_data_source_file_kind_known
  CHECK (kind IN ('tse-open-data-bu', 'tse-open-data-polling-places', 'tse-open-data-municipality-codes',
                  'tse-open-data-candidates'));

-- No máximo um lote bem-sucedido por arquivo de candidatos + recorte (UE).
CREATE UNIQUE INDEX IF NOT EXISTS ingestion_run_candidates_scope_uidx
  ON ingestion_run (source_file_id, (scope->>'units'))
  WHERE status = 'succeeded' AND source = 'tse-open-data-candidates';

-- ---------------------------------------------------------------------------
-- Disputa. Identidade = pleito/turno + CD_ELEICAO + cargo + unidade eleitoral.
CREATE TABLE IF NOT EXISTS contest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id uuid NOT NULL REFERENCES election(id),
  tse_election_code integer NOT NULL,          -- CD_ELEICAO (ex.: 6257 federal, 6259 estadual)
  tse_election_description text,               -- DS_ELEICAO
  office_code integer NOT NULL REFERENCES office(code),  -- CD_CARGO
  office_name text NOT NULL,                   -- DS_CARGO, como publicado
  scope text NOT NULL CHECK (scope IN ('federal', 'state')),  -- TP_ABRANGENCIA
  electoral_unit char(2) NOT NULL,             -- SG_UE: 'BR' (federal) ou a UF
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (election_id, tse_election_code, office_code, electoral_unit)
);

-- ---------------------------------------------------------------------------
-- Candidatura oficial. Identidade = disputa + SQ_CANDIDATO (nunca nome).
-- O CPF NÃO é armazenado: a pessoa é resolvida por HMAC do CPF em
-- public."Persons"."NormalizedDocumentHash" (docs/TSE_IDENTITY.md).
CREATE TABLE IF NOT EXISTS candidacy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id uuid NOT NULL REFERENCES contest(id),
  tse_candidate_id bigint NOT NULL,            -- SQ_CANDIDATO
  candidate_number integer NOT NULL,           -- NR_CANDIDATO
  ballot_name text NOT NULL,                   -- NM_URNA_CANDIDATO
  full_name text NOT NULL,                     -- NM_CANDIDATO
  social_name text,                            -- NM_SOCIAL_CANDIDATO (NULL quando '#NULO')
  agremiation_type text,                       -- TP_AGREMIACAO
  party_number integer,                        -- NR_PARTIDO (partido DAQUELA eleição)
  party_acronym text,                          -- SG_PARTIDO
  party_name text,                             -- NM_PARTIDO
  federation_number integer,                   -- NR_FEDERACAO (NULL quando -1)
  federation_acronym text,
  federation_name text,
  coalition_name text,                         -- NM_COLIGACAO
  candidacy_status_code integer,               -- CD_SITUACAO_CANDIDATURA
  candidacy_status text,                       -- DS_SITUACAO_CANDIDATURA
  round_outcome_code integer,                  -- CD_SIT_TOT_TURNO
  round_outcome text,                          -- DS_SIT_TOT_TURNO, como publicado
  -- Derivado de round_outcome por tabela fixa (docs/TSE_IDENTITY.md):
  -- true = eleito, false = não eleito/suplente, NULL = indefinido (2º turno, #NULO).
  elected boolean,
  person_id uuid REFERENCES public."Persons"("Id"),
  politician_id uuid REFERENCES public."Politicians"("Id"),
  identity_status text NOT NULL CHECK (identity_status IN (
    'resolved',                      -- CPF oficial válido → Person/Politician
    'unresolved_document_unavailable', -- fonte não divulga CPF
    'unresolved_document_invalid'      -- CPF publicado fora do formato
  )),
  identity_method text,                        -- 'cpf_hmac_sha256' quando resolvido
  source_file_id uuid NOT NULL REFERENCES open_data_source_file(id),
  ingestion_run_id uuid NOT NULL REFERENCES ingestion_run(id),
  source_line bigint NOT NULL,
  source_row_hash char(64) NOT NULL,
  source_generated_at text,                    -- DT_GERACAO + HH_GERACAO
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contest_id, tse_candidate_id),
  CHECK ((identity_status = 'resolved') = (person_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS candidacy_number_idx ON candidacy (contest_id, candidate_number);
CREATE INDEX IF NOT EXISTS candidacy_person_idx ON candidacy (person_id) WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS candidacy_politician_idx ON candidacy (politician_id) WHERE politician_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS candidacy_tse_candidate_idx ON candidacy (tse_candidate_id);

-- ---------------------------------------------------------------------------
-- Votável do BU → candidatura. O BU não publica SQ_CANDIDATO: o vínculo é
-- determinístico por (CD_ELEICAO, cargo, número) dentro da unidade eleitoral
-- da urna (a UF da seção; 'BR' para cargos federais). Número repetido na mesma
-- disputa = ambíguo = sem vínculo (registrado no relatório da importação).
CREATE TABLE IF NOT EXISTS votable_candidacy (
  votable_id bigint NOT NULL REFERENCES votable(id),
  uf char(2) NOT NULL,                         -- UF da urna (section_office_result.uf)
  candidacy_id uuid NOT NULL REFERENCES candidacy(id),
  method text NOT NULL CHECK (method = 'contest_number'),
  ingestion_run_id uuid NOT NULL REFERENCES ingestion_run(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (votable_id, uf)
);

CREATE INDEX IF NOT EXISTS votable_candidacy_candidacy_idx ON votable_candidacy (candidacy_id);

-- ---------------------------------------------------------------------------
-- Desempenho por candidatura e território (consultas da API): votos de um
-- votável por município/zona partem de section_office_vote.
CREATE INDEX IF NOT EXISTS section_office_vote_votable_idx ON section_office_vote (votable_id);
CREATE INDEX IF NOT EXISTS section_office_result_scope_idx
  ON section_office_result (uf, municipality_tse_code, zone, office_code);
