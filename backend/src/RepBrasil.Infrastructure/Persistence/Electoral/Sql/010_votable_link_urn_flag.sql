-- REP Brasil — Inteligência Eleitoral: vínculo votável → candidatura desempatado pelo dado oficial
-- "inserido na urna".
--
-- Na substituição de candidatura o TSE mantém as duas candidaturas na mesma disputa com o MESMO
-- número; na urna há uma só. O complementar oficial (ST_CANDIDATO_INSERIDO_URNA) diz qual. Quando
-- disputa + número casam com mais de uma candidatura e exatamente uma foi inserida na urna, o
-- vínculo é feito com método próprio (auditável); sem essa prova, continua sem vínculo.
--
-- O lote de vínculo ganha a versão da regra na chave de idempotência, para que uma regra nova
-- possa ser aplicada aos mesmos dados sem apagar o lote anterior.

ALTER TABLE votable_candidacy DROP CONSTRAINT IF EXISTS votable_candidacy_method_check;
ALTER TABLE votable_candidacy ADD CONSTRAINT votable_candidacy_method_check
  CHECK (method IN ('contest_number', 'contest_number_inserted_in_urn'));

DROP INDEX IF EXISTS ingestion_run_identity_link_scope_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS ingestion_run_identity_link_scope_uidx
  ON ingestion_run (election_id, (scope->>'uf'), (scope->>'candidates_run'), (scope->>'link_rules')) NULLS NOT DISTINCT
  WHERE status = 'succeeded' AND source = 'electoral-identity-link';
