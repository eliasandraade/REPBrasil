using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Persistence.Electoral;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261010060000_AddVotableUfIdentity")]
    public partial class AddVotableUfIdentity : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(ElectoralSqlScripts.InElectoralSchema("005_votable_uf_identity.sql"));
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql($@"
SET LOCAL search_path TO {ElectoralModel.Schema}, public;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM votable
     GROUP BY election_code, office_code, type_code, number
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'cannot downgrade multi-UF votable identity: rows from different UFs collide under the legacy key';
  END IF;
END $$;

DROP INDEX IF EXISTS votable_uf_election_office_number_idx;
DROP INDEX IF EXISTS votable_identity_uf_uidx;
ALTER TABLE votable DROP COLUMN uf;
ALTER TABLE votable
  ADD CONSTRAINT votable_election_code_office_code_type_code_number_key
  UNIQUE (election_code, office_code, type_code, number);
");
        }
    }
}
