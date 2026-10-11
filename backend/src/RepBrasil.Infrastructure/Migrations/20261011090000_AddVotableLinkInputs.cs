using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Persistence.Electoral;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    /// <summary>
    /// Idempotência do vínculo votável → candidatura pela impressão digital do conteúdo das entradas
    /// (votáveis, candidaturas, complementar oficial, regra). Rollback falha (em vez de apagar lotes)
    /// quando já existem lotes que só a impressão digital distingue.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261011090000_AddVotableLinkInputs")]
    public partial class AddVotableLinkInputs : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(ElectoralSqlScripts.InElectoralSchema("013_votable_link_inputs.sql"));
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql($@"
SET LOCAL search_path TO {ElectoralModel.Schema}, public;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM ingestion_run
     WHERE status = 'succeeded' AND source = 'electoral-identity-link'
     GROUP BY election_id, scope->>'uf', scope->>'candidates_run', scope->>'link_rules'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'cannot downgrade votable link idempotency: link batches distinguished only by inputs_fingerprint exist';
  END IF;
END $$;

DROP INDEX IF EXISTS ingestion_run_identity_link_scope_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS ingestion_run_identity_link_scope_uidx
  ON ingestion_run (election_id, (scope->>'uf'), (scope->>'candidates_run'), (scope->>'link_rules')) NULLS NOT DISTINCT
  WHERE status = 'succeeded' AND source = 'electoral-identity-link';
");
        }
    }
}
