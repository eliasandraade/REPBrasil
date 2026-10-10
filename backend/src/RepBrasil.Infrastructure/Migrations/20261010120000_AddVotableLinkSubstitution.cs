using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Persistence.Electoral;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    /// <summary>
    /// Vínculo votável → candidatura na substituição feita depois da carga das urnas: as duas candidaturas
    /// constam como inseridas na urna e o complementar oficial diz qual foi substituída.
    /// Rollback falha (em vez de apagar vínculos) quando o novo método já foi usado.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261010120000_AddVotableLinkSubstitution")]
    public partial class AddVotableLinkSubstitution : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(ElectoralSqlScripts.InElectoralSchema("011_votable_link_substitution.sql"));
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql($@"
SET LOCAL search_path TO {ElectoralModel.Schema}, public;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM votable_candidacy WHERE method = 'contest_number_substitution') THEN
    RAISE EXCEPTION 'cannot downgrade votable links: links resolved by the official substitution flag exist';
  END IF;
END $$;

ALTER TABLE votable_candidacy DROP CONSTRAINT IF EXISTS votable_candidacy_method_check;
ALTER TABLE votable_candidacy ADD CONSTRAINT votable_candidacy_method_check
  CHECK (method IN ('contest_number', 'contest_number_inserted_in_urn'));
");
        }
    }
}
