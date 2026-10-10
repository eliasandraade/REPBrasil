-- REP Brasil — Inteligência Eleitoral: vínculo votável → candidatura na substituição feita depois da
-- carga das urnas.
--
-- Quando o titular é substituído depois que as urnas foram carregadas (ex.: falecimento), o
-- complementar oficial marca as DUAS candidaturas como inseridas na urna (ST_CANDIDATO_INSERIDO_URNA)
-- e indica qual foi substituída (ST_SUBSTITUIDO = 'S'). Se exatamente uma não foi substituída, o
-- vínculo é feito com ela, com método próprio (auditável); o nome de urna do BU ainda precisa
-- conferir com o dela. Sem essa prova, continua sem vínculo.

ALTER TABLE votable_candidacy DROP CONSTRAINT IF EXISTS votable_candidacy_method_check;
ALTER TABLE votable_candidacy ADD CONSTRAINT votable_candidacy_method_check
  CHECK (method IN ('contest_number', 'contest_number_inserted_in_urn', 'contest_number_substitution'));
