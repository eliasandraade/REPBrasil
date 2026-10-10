using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Persistence.Electoral;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    /// <summary>
    /// Idempotência da importação de candidaturas por turno: o mesmo arquivo oficial traz os dois
    /// turnos. Rollback falha (em vez de apagar lotes) quando o mesmo arquivo já foi importado para
    /// mais de um turno, pois o índice anterior não comporta esse estado.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261010100000_AddCandidatesRunTurn")]
    public partial class AddCandidatesRunTurn : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(ElectoralSqlScripts.InElectoralSchema("009_candidates_run_turn.sql"));
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql($@"
SET LOCAL search_path TO {ElectoralModel.Schema}, public;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ingestion_run
     WHERE status = 'succeeded' AND source = 'tse-open-data-candidates'
     GROUP BY source_file_id, scope->>'units', scope->>'history_zip_sha256'
    HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'cannot downgrade candidates run scope: the same official file was imported for more than one turn';
  END IF;
END $$;

DROP INDEX IF EXISTS ingestion_run_candidates_scope_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS ingestion_run_candidates_scope_uidx
  ON ingestion_run (source_file_id, (scope->>'units'), (scope->>'history_zip_sha256')) NULLS NOT DISTINCT
  WHERE status = 'succeeded' AND source = 'tse-open-data-candidates';
");
        }
    }
}
