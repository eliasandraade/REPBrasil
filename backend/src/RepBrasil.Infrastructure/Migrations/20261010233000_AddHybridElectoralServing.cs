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
  IF EXISTS (SELECT 1 FROM electoral_archive.derived_archive_scope) THEN
    RAISE EXCEPTION 'cannot downgrade hybrid electoral serving: archived aggregate scopes exist';
  END IF;
END $$;

DROP MATERIALIZED VIEW IF EXISTS zone_office_totals_current;
DROP MATERIALIZED VIEW IF EXISTS votable_zone_votes_current;
DROP SCHEMA IF EXISTS electoral_archive CASCADE;
");

            migrationBuilder.Sql(ElectoralSqlScripts.InElectoralSchema("008_xray_derived.sql"));
        }
    }
}
