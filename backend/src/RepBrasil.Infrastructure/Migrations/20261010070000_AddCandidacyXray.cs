using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Persistence.Electoral;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
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

DROP VIEW IF EXISTS candidacy_section_vote_current;
DROP VIEW IF EXISTS latest_bu_ingestion_run;
DROP INDEX IF EXISTS section_office_result_xray_scope_idx;
DROP INDEX IF EXISTS section_office_vote_votable_result_votes_idx;
DROP INDEX IF EXISTS votable_candidacy_candidacy_uf_votable_idx;
DROP TABLE IF EXISTS candidacy_finance_record;
DROP TABLE IF EXISTS candidacy_source_record;
DROP TABLE IF EXISTS candidacy_asset;

ALTER TABLE open_data_source_file DROP CONSTRAINT IF EXISTS open_data_source_file_kind_known;
ALTER TABLE open_data_source_file ADD CONSTRAINT open_data_source_file_kind_known
  CHECK (kind IN ('tse-open-data-bu', 'tse-open-data-polling-places', 'tse-open-data-municipality-codes',
                  'tse-open-data-candidates', 'tse-open-data-candidacy-history'));
");
        }
    }
}
