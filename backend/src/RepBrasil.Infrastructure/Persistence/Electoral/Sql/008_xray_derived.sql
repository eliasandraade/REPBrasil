-- Raio X eleitoral: eleitorado municipal do cadastro, idempotência de importações
-- sem histórico, prestação de contas e agregados derivados do BU vigente.
--
-- 1. Cadastro: aptos da urna para cargos municipais (QT_ELEITOR_ELEICAO_MUNICIPAL).
--    Em eleição geral o TSE publica 0 (sem disputa municipal); em eleição municipal,
--    federal e estadual vêm 0. Agregadas continuam NULL ("contado na principal").
-- 2. Lotes: o arquivo de candidatos de 2022/2024 não tem histórico (NULL na chave de
--    idempotência ⇒ NULLS NOT DISTINCT) e o histórico de 2026 pode ser gravado depois.
-- 3. Prestação de contas: receitas, despesas contratadas e despesas pagas. Documento
--    de pessoa física só como HMAC; CNPJ (identificador público de empresa) em claro.
-- 4. Agregados derivados por zona × cargo do BU vigente (materialized views). São
--    DERIVADOS: recalculados por REFRESH após importações; `derived_refresh` registra
--    o estado dos lotes no momento do cálculo para a API detectar defasagem.

-- 1 ── Eleitorado municipal ──────────────────────────────────────────────────

ALTER TABLE electoral_section ADD COLUMN IF NOT EXISTS eligible_municipal integer CHECK (eligible_municipal >= 0);

ALTER TABLE electoral_section DROP CONSTRAINT IF EXISTS electoral_section_aggregation_shape;
ALTER TABLE electoral_section ADD CONSTRAINT electoral_section_aggregation_shape CHECK (
  (is_aggregated AND principal_section_number IS NOT NULL AND principal_section_number <> section_number
     AND eligible_federal IS NULL AND eligible_state IS NULL AND eligible_municipal IS NULL)
  OR (NOT is_aggregated AND (principal_section_number IS NULL OR principal_section_number = section_number))
);

-- 2 ── Idempotência dos lotes ────────────────────────────────────────────────

DROP INDEX IF EXISTS ingestion_run_candidates_scope_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS ingestion_run_candidates_scope_uidx
  ON ingestion_run (source_file_id, (scope->>'units'), (scope->>'history_zip_sha256')) NULLS NOT DISTINCT
  WHERE status = 'succeeded' AND source = 'tse-open-data-candidates';

CREATE UNIQUE INDEX IF NOT EXISTS ingestion_run_history_scope_uidx
  ON ingestion_run (source_file_id, (scope->>'year'))
  WHERE status = 'succeeded' AND source = 'tse-open-data-candidacy-history';

-- Bens, registros complementares e prestação de contas: um lote bem-sucedido por
-- arquivo × ano × UF × tipo de registro.
CREATE UNIQUE INDEX IF NOT EXISTS ingestion_run_candidate_records_scope_uidx
  ON ingestion_run (source, source_file_id, (scope->>'year'), (scope->>'uf'), (scope->>'record_kind')) NULLS NOT DISTINCT
  WHERE status = 'succeeded' AND source IN (
    'tse-open-data-candidate-assets', 'tse-open-data-candidate-records', 'tse-open-data-campaign-finance');

-- 3 ── Prestação de contas ───────────────────────────────────────────────────

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
    'tse-open-data-campaign-fiscal-documents',
    'tse-open-data-campaign-finance'
  ));

ALTER TABLE candidacy_finance_record DROP CONSTRAINT IF EXISTS candidacy_finance_record_record_kind_check;
ALTER TABLE candidacy_finance_record DROP CONSTRAINT IF EXISTS candidacy_finance_record_kind_check;
ALTER TABLE candidacy_finance_record ADD CONSTRAINT candidacy_finance_record_kind_check CHECK (record_kind IN (
  'account', 'bank_statement', 'fiscal_expense', 'fiscal_revenue',
  'revenue',             -- receitas_candidatos
  'expense_contracted',  -- despesas_contratadas_candidatos
  'expense_paid'         -- despesas_pagas_candidatos
));

ALTER TABLE candidacy_finance_record ADD COLUMN IF NOT EXISTS counterparty_kind text;
ALTER TABLE candidacy_finance_record ADD COLUMN IF NOT EXISTS counterparty_cnpj char(14);
ALTER TABLE candidacy_finance_record DROP CONSTRAINT IF EXISTS candidacy_finance_counterparty_check;
ALTER TABLE candidacy_finance_record ADD CONSTRAINT candidacy_finance_counterparty_check CHECK (
  (counterparty_kind IS NULL OR counterparty_kind IN ('person', 'company', 'unidentified'))
  AND (counterparty_cnpj IS NULL OR (counterparty_kind = 'company' AND counterparty_cnpj ~ '^[0-9]{14}$'))
);

CREATE INDEX IF NOT EXISTS candidacy_finance_record_category_idx
  ON candidacy_finance_record (candidacy_id, record_kind, category);

-- 4 ── Agregados derivados do BU vigente ─────────────────────────────────────

-- Votos de cada votável por zona × cargo (somente lotes vigentes). Base de rankings,
-- mapas e comparações em nível de estado/município/zona sem varrer o fato bruto.
CREATE MATERIALIZED VIEW IF NOT EXISTS votable_zone_votes_current AS
SELECT r.year, r.turn, r.uf, r.municipality_tse_code, r.zone, r.office_code, v.votable_id,
       sum(v.votes)::bigint AS votes,
       count(*)::int AS urns_with_votes
  FROM latest_bu_ingestion_run l
  JOIN section_office_result r ON r.ingestion_run_id = l.ingestion_run_id
  JOIN section_office_vote v ON v.result_id = r.id
 GROUP BY r.year, r.turn, r.uf, r.municipality_tse_code, r.zone, r.office_code, v.votable_id;

CREATE UNIQUE INDEX IF NOT EXISTS votable_zone_votes_current_uidx
  ON votable_zone_votes_current (year, turn, uf, municipality_tse_code, zone, office_code, votable_id);
CREATE INDEX IF NOT EXISTS votable_zone_votes_current_votable_idx
  ON votable_zone_votes_current (votable_id, year, turn);

-- Totais por zona × cargo. Os zeros por tipo de voto são reais (a urna existe e não
-- tem linha daquele tipo); aptos/comparecimento só somam quando TODAS as urnas
-- publicam o dado — ausência nunca vira zero.
CREATE MATERIALIZED VIEW IF NOT EXISTS zone_office_totals_current AS
WITH res AS (
  SELECT r.id, r.year, r.turn, r.uf, r.municipality_tse_code, r.municipality_name, r.zone, r.office_code,
         r.eligible, r.turnout, r.abstentions
    FROM latest_bu_ingestion_run l
    JOIN section_office_result r ON r.ingestion_run_id = l.ingestion_run_id
), kinds AS (
  SELECT v.result_id,
         sum(v.votes) FILTER (WHERE t.vote_kind = 'candidate') AS nominal,
         sum(v.votes) FILTER (WHERE t.vote_kind = 'party_legend') AS legend,
         sum(v.votes) FILTER (WHERE t.vote_kind = 'blank') AS blank,
         sum(v.votes) FILTER (WHERE t.vote_kind IN ('null', 'technical_null')) AS nulls,
         sum(v.votes) AS total
    FROM res
    JOIN section_office_vote v ON v.result_id = res.id
    JOIN votable t ON t.id = v.votable_id
   GROUP BY v.result_id
)
SELECT res.year, res.turn, res.uf, res.municipality_tse_code, max(res.municipality_name) AS municipality_name,
       res.zone, res.office_code,
       count(*)::int AS urns,
       CASE WHEN bool_and(res.eligible IS NOT NULL) THEN sum(res.eligible)::bigint END AS eligible,
       CASE WHEN bool_and(res.turnout IS NOT NULL) THEN sum(res.turnout)::bigint END AS turnout,
       CASE WHEN bool_and(res.abstentions IS NOT NULL) THEN sum(res.abstentions)::bigint END AS abstentions,
       COALESCE(sum(k.nominal), 0)::bigint AS nominal_votes,
       COALESCE(sum(k.legend), 0)::bigint AS legend_votes,
       COALESCE(sum(k.blank), 0)::bigint AS blank_votes,
       COALESCE(sum(k.nulls), 0)::bigint AS null_votes,
       COALESCE(sum(k.total), 0)::bigint AS votes_total
  FROM res
  LEFT JOIN kinds k ON k.result_id = res.id
 GROUP BY res.year, res.turn, res.uf, res.municipality_tse_code, res.zone, res.office_code;

CREATE UNIQUE INDEX IF NOT EXISTS zone_office_totals_current_uidx
  ON zone_office_totals_current (year, turn, uf, municipality_tse_code, zone, office_code);

-- Estado dos lotes do BU quando os agregados foram calculados. A API compara com os
-- lotes atuais e sinaliza agregados defasados em vez de servir números silenciosamente velhos.
CREATE TABLE IF NOT EXISTS derived_refresh (
  view_name text PRIMARY KEY,
  refreshed_at timestamptz NOT NULL,
  bu_runs integer NOT NULL,
  bu_last_finished_at timestamptz
);

INSERT INTO derived_refresh (view_name, refreshed_at, bu_runs, bu_last_finished_at)
SELECT v.view_name, now(), x.runs, x.last_finished
  FROM (VALUES ('votable_zone_votes_current'), ('zone_office_totals_current')) v(view_name)
 CROSS JOIN (
   SELECT count(*)::int AS runs, max(finished_at) AS last_finished
     FROM ingestion_run WHERE source = 'tse-open-data-bu' AND status = 'succeeded'
 ) x
ON CONFLICT (view_name) DO UPDATE SET
  refreshed_at = EXCLUDED.refreshed_at, bu_runs = EXCLUDED.bu_runs, bu_last_finished_at = EXCLUDED.bu_last_finished_at;

-- O índice (votable_id) do 004 é prefixo do índice de cobertura (votable_id, result_id, votes)
-- do 006: redundante, só ocupa espaço e custa escrita.
DROP INDEX IF EXISTS section_office_vote_votable_idx;
