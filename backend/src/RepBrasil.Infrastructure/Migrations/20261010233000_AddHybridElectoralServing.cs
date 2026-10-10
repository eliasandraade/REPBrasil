using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Persistence.Electoral;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261010233000_AddHybridElectoralServing")]
    public partial class AddHybridElectoralServing : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(ElectoralSqlScripts.InElectoralSchema("012_hybrid_electoral_serving.sql"));
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql($@"
SET LOCAL search_path TO {ElectoralModel.Schema}, public;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM derived_archive_scope) THEN
    RAISE EXCEPTION 'cannot downgrade hybrid electoral serving: archived aggregate scopes exist';
  END IF;
END $$;

DROP VIEW IF EXISTS zone_office_totals_current;
DROP VIEW IF EXISTS votable_zone_votes_current;
DROP TABLE IF EXISTS derived_archive_scope;
DROP TABLE IF EXISTS zone_office_totals_archive;
DROP TABLE IF EXISTS votable_zone_votes_archive;
ALTER MATERIALIZED VIEW IF EXISTS zone_office_totals_live RENAME TO zone_office_totals_current;
ALTER MATERIALIZED VIEW IF EXISTS votable_zone_votes_live RENAME TO votable_zone_votes_current;
");
        }
    }
}
