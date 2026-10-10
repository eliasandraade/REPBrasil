-- Eleições municipais como cidadãs de primeira classe.
--
-- 1. Identidade do votável municipal. Em eleições municipais o CD_ELEICAO é o
--    mesmo para todos os municípios da UF e o mesmo número (ex.: vereador 12345)
--    representa candidaturas diferentes em cada município. A chave
--    (uf, eleição, cargo, tipo, número) do 005 fundiria essas pessoas. Para os
--    cargos municipais (11 Prefeito, 12 Vice-Prefeito, 13 Vereador) o município
--    passa a fazer parte da identidade; para os demais cargos ele é NULL e a
--    identidade continua exatamente a do 005.
-- 2. Disputa municipal: contest.uf explícita (SG_UF) e unidade eleitoral
--    municipal = código TSE do município com 5 dígitos.
-- 3. Identidade sem CPF publicado: status próprio e histórico oficial de
--    candidaturas persistido (candidacy_prior).
-- 4. Índices das consultas territoriais do Raio X.
--
-- Fail-closed: se algum votável legado de cargo municipal já tiver votos em mais
-- de um município, não há como separar as pessoas sem ambiguidade e a migração
-- é interrompida antes de alterar a chave.

-- 1 ── Identidade municipal do votável ───────────────────────────────────────

ALTER TABLE votable ADD COLUMN IF NOT EXISTS municipality_tse_code char(5);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM section_office_vote sv
      JOIN section_office_result r ON r.id = sv.result_id
      JOIN votable v ON v.id = sv.votable_id
     WHERE v.office_code IN (11, 12, 13)
     GROUP BY sv.votable_id
    HAVING count(DISTINCT r.municipality_tse_code) > 1
  ) THEN
    RAISE EXCEPTION
      'cannot migrate municipal votable identity: a legacy municipal votable has votes in more than one municipality';
  END IF;
END $$;

UPDATE votable v
   SET municipality_tse_code = x.municipality_tse_code
  FROM (
    SELECT sv.votable_id, min(r.municipality_tse_code) AS municipality_tse_code
      FROM section_office_vote sv
      JOIN section_office_result r ON r.id = sv.result_id
     GROUP BY sv.votable_id
  ) x
 WHERE x.votable_id = v.id
   AND v.office_code IN (11, 12, 13)
   AND v.municipality_tse_code IS NULL;

ALTER TABLE votable DROP CONSTRAINT IF EXISTS votable_municipal_scope_check;
ALTER TABLE votable ADD CONSTRAINT votable_municipal_scope_check CHECK (
  (office_code IN (11, 12, 13)) = (municipality_tse_code IS NOT NULL)
);

DROP INDEX IF EXISTS votable_identity_uf_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS votable_identity_scope_uidx
  ON votable (uf, election_code, office_code, type_code, number, municipality_tse_code) NULLS NOT DISTINCT;

-- 2 ── Disputa municipal ──────────────────────────────────────────────────────

ALTER TABLE contest ADD COLUMN IF NOT EXISTS uf char(2);
UPDATE contest SET uf = btrim(electoral_unit) WHERE scope = 'state' AND uf IS NULL;

ALTER TABLE contest DROP CONSTRAINT IF EXISTS contest_unit_format_check;
ALTER TABLE contest ADD CONSTRAINT contest_unit_format_check CHECK (
  (scope = 'federal' AND electoral_unit = 'BR' AND uf IS NULL)
  OR (scope = 'state' AND electoral_unit ~ '^[A-Z]{2}$' AND uf = electoral_unit)
  OR (scope = 'municipal' AND electoral_unit ~ '^[0-9]{5}$' AND uf ~ '^[A-Z]{2}$')
);

CREATE INDEX IF NOT EXISTS contest_scope_uf_idx ON contest (election_id, scope, uf, office_code);

-- 3 ── Identidade sem CPF publicado ──────────────────────────────────────────
--
-- A partir de 2024 o TSE não publica o CPF dos candidatos. A pessoa de uma
-- candidatura sem CPF só é resolvida por relação OFICIAL entre SQ_CANDIDATO:
-- o "Histórico de candidaturas" de uma eleição posterior lista o SQ desta
-- candidatura sob a candidatura atual de uma pessoa já resolvida por CPF.
-- Esse caminho tem status próprio para nunca se confundir com prova por CPF.

ALTER TABLE candidacy DROP CONSTRAINT IF EXISTS candidacy_identity_status_check;
ALTER TABLE candidacy ADD CONSTRAINT candidacy_identity_status_check CHECK (identity_status IN (
  'resolved',                          -- CPF oficial válido (HMAC) → Person/Politician
  'resolved_tse_link',                 -- sem CPF: SQ_CANDIDATO ligado a pessoa resolvida pelo histórico oficial
  'unresolved_document_unavailable',   -- fonte não divulga CPF e nenhuma relação oficial prova a pessoa
  'unresolved_document_invalid'        -- CPF publicado fora do formato
));

-- O CHECK anônimo do 004 amarra 'resolved' à pessoa; a pessoa agora também pode
-- vir do vínculo oficial.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'candidacy'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%identity_status = ''resolved''%person_id IS NOT NULL%'
  LOOP
    EXECUTE format('ALTER TABLE candidacy DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE candidacy DROP CONSTRAINT IF EXISTS candidacy_person_matches_status_check;
ALTER TABLE candidacy ADD CONSTRAINT candidacy_person_matches_status_check CHECK (
  (identity_status IN ('resolved', 'resolved_tse_link')) = (person_id IS NOT NULL)
);

-- Histórico oficial de candidaturas: para a candidatura atual, as candidaturas
-- anteriores da MESMA pessoa segundo o TSE (por SQ_CANDIDATO daquele ano).
-- Fato da fonte, nunca inferido: alimenta a identidade sem CPF e a linha do tempo.
CREATE TABLE IF NOT EXISTS candidacy_prior (
  id bigserial PRIMARY KEY,
  candidacy_id uuid NOT NULL REFERENCES candidacy(id) ON DELETE CASCADE,
  prior_year smallint NOT NULL,
  prior_turn smallint NOT NULL,
  prior_tse_candidate_id bigint NOT NULL,
  prior_office_code integer,
  prior_office_name text,
  prior_electoral_unit text,
  prior_unit_name text,
  prior_candidate_number integer,
  prior_ballot_name text,
  prior_party_acronym text,
  prior_round_outcome text,
  source_file_id uuid NOT NULL REFERENCES open_data_source_file(id),
  source_member text NOT NULL,
  source_line bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidacy_id, prior_year, prior_turn, prior_tse_candidate_id)
);

CREATE INDEX IF NOT EXISTS candidacy_prior_lookup_idx ON candidacy_prior (prior_year, prior_tse_candidate_id);

-- 4 ── Índices do Raio X ──────────────────────────────────────────────────────

-- Totais por candidatura × território: parte do vínculo (votable_candidacy) para os
-- votos e agrupa por município/zona do resultado.
CREATE INDEX IF NOT EXISTS section_office_result_year_office_scope_idx
  ON section_office_result (year, turn, uf, office_code, municipality_tse_code, zone, section);

-- O view candidacy_section_vote_current (006) junta pelo votável já com escopo
-- municipal: como cada votável municipal pertence a um único município, o par
-- (votable_id, uf) de votable_candidacy continua inequívoco.
