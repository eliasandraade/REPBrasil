-- Multi-UF: a identidade do votável do BU inclui a UF da urna.
--
-- O CD_ELEICAO, cargo, tipo e número não bastam para cargos estaduais:
-- o mesmo número pode representar pessoas diferentes em UFs distintas.
-- A migração é fail-closed: se algum votável legado já tiver sido usado em
-- resultados de mais de uma UF, não há como inferir sua UF sem ambiguidade e
-- a aplicação é interrompida antes de alterar a chave de identidade.

ALTER TABLE votable ADD COLUMN IF NOT EXISTS uf char(2);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM section_office_vote sv
      JOIN section_office_result r ON r.id = sv.result_id
     GROUP BY sv.votable_id
    HAVING count(DISTINCT r.uf) > 1
  ) THEN
    RAISE EXCEPTION
      'cannot migrate votable identity to multi-UF: at least one legacy votable is referenced by more than one UF';
  END IF;
END $$;

UPDATE votable v
   SET uf = x.uf
  FROM (
    SELECT sv.votable_id, min(r.uf)::char(2) AS uf
      FROM section_office_vote sv
      JOIN section_office_result r ON r.id = sv.result_id
     GROUP BY sv.votable_id
  ) x
 WHERE x.votable_id = v.id
   AND v.uf IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM votable WHERE uf IS NULL) THEN
    RAISE EXCEPTION
      'cannot migrate votable identity to multi-UF: at least one legacy votable has no section provenance';
  END IF;
END $$;

ALTER TABLE votable ALTER COLUMN uf SET NOT NULL;

ALTER TABLE votable
  DROP CONSTRAINT IF EXISTS votable_election_code_office_code_type_code_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS votable_identity_uf_uidx
  ON votable (uf, election_code, office_code, type_code, number);

CREATE INDEX IF NOT EXISTS votable_uf_election_office_number_idx
  ON votable (uf, election_code, office_code, number);
