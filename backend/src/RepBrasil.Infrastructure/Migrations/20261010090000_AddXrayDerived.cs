using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Persistence.Electoral;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    /// <summary>
    /// Raio X: eleitorado municipal do cadastro, idempotência de importações sem histórico,
    /// prestação de contas e agregados derivados do BU vigente (materialized views).
    /// Rollback falha (nunca destrói semântica) quando já há eleitorado municipal ou
    /// registros de prestação de contas gravados; os agregados derivados são recalculáveis.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261010090000_AddXrayDerived")]
    public partial class AddXrayDerived : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(ElectoralSqlScripts.InElectoralSchema("008_xray_derived.sql"));
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql($@"
SET LOCAL search_path TO {ElectoralModel.Schema}, public;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM electoral_section WHERE eligible_municipal IS NOT NULL) THEN
    RAISE EXCEPTION 'cannot downgrade xray derived: municipal electorate already imported';
  END IF;
  IF EXISTS (SELECT 1 FROM candidacy_finance_record
              WHERE record_kind IN ('revenue', 'expense_contracted', 'expense_paid')
                 OR counterparty_kind IS NOT NULL OR counterparty_cnpj IS NOT NULL) THEN
    RAISE EXCEPTION 'cannot downgrade xray derived: campaign finance records already imported';
  END IF;
  IF EXISTS (SELECT 1 FROM open_data_source_file WHERE kind = 'tse-open-data-campaign-finance') THEN
    RAISE EXCEPTION 'cannot downgrade xray derived: campaign finance source files registered';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS section_office_vote_votable_idx ON section_office_vote (votable_id);
DROP TABLE IF EXISTS derived_refresh;
DROP MATERIALIZED VIEW IF EXISTS zone_office_totals_current;
DROP MATERIALIZED VIEW IF EXISTS votable_zone_votes_current;

DROP INDEX IF EXISTS candidacy_finance_record_category_idx;
ALTER TABLE candidacy_finance_record DROP CONSTRAINT IF EXISTS candidacy_finance_counterparty_check;
ALTER TABLE candidacy_finance_record DROP COLUMN IF EXISTS counterparty_cnpj;
ALTER TABLE candidacy_finance_record DROP COLUMN IF EXISTS counterparty_kind;
ALTER TABLE candidacy_finance_record DROP CONSTRAINT IF EXISTS candidacy_finance_record_kind_check;
ALTER TABLE candidacy_finance_record ADD CONSTRAINT candidacy_finance_record_record_kind_check CHECK (record_kind IN (
  'account', 'bank_statement', 'fiscal_expense', 'fiscal_revenue'));

ALTER TABLE open_data_source_file DROP CONSTRAINT IF EXISTS open_data_source_file_kind_known;
ALTER TABLE open_data_source_file ADD CONSTRAINT open_data_source_file_kind_known
  CHECK (kind IN (
    'tse-open-data-bu', 'tse-open-data-polling-places', 'tse-open-data-municipality-codes',
    'tse-open-data-candidates', 'tse-open-data-candidacy-history', 'tse-open-data-candidate-assets',
    'tse-open-data-candidate-complement', 'tse-open-data-candidate-social-network',
    'tse-open-data-government-proposal', 'tse-open-data-criminal-certificate', 'tse-open-data-candidate-invoice',
    'tse-open-data-campaign-accounts', 'tse-open-data-campaign-bank-statements', 'tse-open-data-campaign-fiscal-documents'));

DROP INDEX IF EXISTS ingestion_run_candidate_records_scope_uidx;
DROP INDEX IF EXISTS ingestion_run_history_scope_uidx;
DROP INDEX IF EXISTS ingestion_run_candidates_scope_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS ingestion_run_candidates_scope_uidx
  ON ingestion_run (source_file_id, (scope->>'units'), (scope->>'history_zip_sha256'))
  WHERE status = 'succeeded' AND source = 'tse-open-data-candidates';

ALTER TABLE electoral_section DROP CONSTRAINT IF EXISTS electoral_section_aggregation_shape;
ALTER TABLE electoral_section ADD CONSTRAINT electoral_section_aggregation_shape CHECK (
  (is_aggregated AND principal_section_number IS NOT NULL AND principal_section_number <> section_number
     AND eligible_federal IS NULL AND eligible_state IS NULL)
  OR (NOT is_aggregated AND (principal_section_number IS NULL OR principal_section_number = section_number))
);
ALTER TABLE electoral_section DROP COLUMN IF EXISTS eligible_municipal;
");
        }
    }
}
