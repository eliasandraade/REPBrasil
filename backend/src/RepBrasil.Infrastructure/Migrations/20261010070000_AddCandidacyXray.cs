using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Persistence.Electoral;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    /// <summary>
    /// Raio X da candidatura: bens, registros complementares e prestação de contas por candidatura,
    /// disputa municipal e leituras do BU vigente. Rollback falha quando já há dados importados.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261010070000_AddCandidacyXray")]
    public partial class AddCandidacyXray : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(ElectoralSqlScripts.InElectoralSchema("006_candidacy_xray.sql"));
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql($@"
SET LOCAL search_path TO {ElectoralModel.Schema}, public;

-- Guardas ANTES de qualquer DROP: rollback nunca destrói dados importados em silêncio.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM candidacy_asset) OR EXISTS (SELECT 1 FROM candidacy_source_record)
     OR EXISTS (SELECT 1 FROM candidacy_finance_record) THEN
    RAISE EXCEPTION 'cannot downgrade candidacy xray: imported assets, records or campaign finance would be destroyed';
  END IF;
  IF EXISTS (SELECT 1 FROM contest WHERE scope = 'municipal' OR length(btrim(electoral_unit)) > 2) THEN
    RAISE EXCEPTION 'cannot downgrade candidacy xray: municipal contests require variable-length electoral_unit';
  END IF;
END $$;

DROP VIEW IF EXISTS candidacy_section_vote_current;
DROP VIEW IF EXISTS latest_bu_ingestion_run;
DROP INDEX IF EXISTS section_office_result_xray_scope_idx;
DROP INDEX IF EXISTS section_office_vote_votable_result_votes_idx;
DROP INDEX IF EXISTS votable_candidacy_candidacy_uf_votable_idx;
DROP TABLE IF EXISTS candidacy_finance_record;
DROP TABLE IF EXISTS candidacy_source_record;
DROP TABLE IF EXISTS candidacy_asset;

ALTER TABLE contest DROP CONSTRAINT IF EXISTS contest_scope_check;
ALTER TABLE contest ALTER COLUMN electoral_unit TYPE char(2) USING btrim(electoral_unit)::char(2);
ALTER TABLE contest ADD CONSTRAINT contest_scope_check CHECK (scope IN ('federal', 'state'));

ALTER TABLE open_data_source_file DROP CONSTRAINT IF EXISTS open_data_source_file_kind_known;
ALTER TABLE open_data_source_file ADD CONSTRAINT open_data_source_file_kind_known
  CHECK (kind IN ('tse-open-data-bu', 'tse-open-data-polling-places', 'tse-open-data-municipality-codes',
                  'tse-open-data-candidates', 'tse-open-data-candidacy-history'));
");
        }
    }
}
