-- REP Brasil — Inteligência Eleitoral: idempotência da importação de candidaturas POR TURNO.
--
-- O arquivo oficial de candidatos (consulta_cand_<ano>) traz os dois turnos. O lote
-- bem-sucedido era único por arquivo × UEs × versão do histórico, e o 2º turno do MESMO
-- arquivo era tomado por "já importado" (encontrado na carga de 2022: 2º turno de
-- Presidente). O turno passa a fazer parte da chave; nenhum dado é alterado.

DROP INDEX IF EXISTS ingestion_run_candidates_scope_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS ingestion_run_candidates_scope_uidx
  ON ingestion_run (source_file_id, (scope->>'turn'), (scope->>'units'), (scope->>'history_zip_sha256')) NULLS NOT DISTINCT
  WHERE status = 'succeeded' AND source = 'tse-open-data-candidates';
