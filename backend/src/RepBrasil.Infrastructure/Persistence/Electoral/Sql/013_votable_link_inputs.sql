-- REP Brasil — Inteligência Eleitoral: idempotência do vínculo votável → candidatura pelo conteúdo
-- das entradas.
--
-- Até a 012 o lote de vínculo era identificado por (pleito, UF, lote de candidaturas, versão da regra).
-- Um complementar oficial importado DEPOIS do vínculo (carga real de 2024: 69 votáveis ambíguos, 68
-- resolvidos pelo "inserido na urna" e 1 pela substituição) não mudava essa chave: o vínculo respondia
-- "already_imported" e o índice único abaixo impedia um lote novo — foi preciso invalidar o lote à mão.
--
-- O ETL agora grava em scope->>'inputs_fingerprint' o hash do CONTEÚDO que decide o vínculo (votáveis do
-- escopo, candidaturas casáveis com número e nome de urna, sinalizadores do complementar, versão da regra).
-- O índice passa a incluir essa impressão digital. Lotes anteriores (sem impressão digital, NULL) mantêm
-- exatamente a unicidade de antes; o índice novo é estritamente mais fraco que o antigo, então não falha
-- sobre dados existentes. Nenhum lote nem vínculo é alterado ou apagado.

DROP INDEX IF EXISTS ingestion_run_identity_link_scope_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS ingestion_run_identity_link_scope_uidx
  ON ingestion_run (election_id, (scope->>'uf'), (scope->>'candidates_run'), (scope->>'link_rules'),
                    (scope->>'inputs_fingerprint')) NULLS NOT DISTINCT
  WHERE status = 'succeeded' AND source = 'electoral-identity-link';
