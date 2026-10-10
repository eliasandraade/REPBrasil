using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Persistence.Electoral;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    /// <summary>
    /// Vínculo votável → candidatura desempatado pelo dado oficial "inserido na urna" (substituição de
    /// candidatura mantém o mesmo número na disputa) e versão da regra na idempotência do lote de vínculo.
    /// Rollback falha (em vez de apagar vínculos ou lotes) quando o novo método ou uma regra nova já foram usados.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261010110000_AddVotableLinkUrnFlag")]
    public partial class AddVotableLinkUrnFlag : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(ElectoralSqlScripts.InElectoralSchema("010_votable_link_urn_flag.sql"));
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql($@"
SET LOCAL search_path TO {ElectoralModel.Schema}, public;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM votable_candidacy WHERE method <> 'contest_number') THEN
    RAISE EXCEPTION 'cannot downgrade votable links: links resolved by the official inserted-in-urn flag exist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM ingestion_run
     WHERE status = 'succeeded' AND source = 'electoral-identity-link'
     GROUP BY election_id, scope->>'uf', scope->>'candidates_run'
    HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'cannot downgrade votable link scope: the same candidates batch was linked under more than one rule version';
  END IF;
END $$;

DROP INDEX IF EXISTS ingestion_run_identity_link_scope_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS ingestion_run_identity_link_scope_uidx
  ON ingestion_run (election_id, (scope->>'uf'), (scope->>'candidates_run'))
  WHERE status = 'succeeded' AND source = 'electoral-identity-link';

ALTER TABLE votable_candidacy DROP CONSTRAINT IF EXISTS votable_candidacy_method_check;
ALTER TABLE votable_candidacy ADD CONSTRAINT votable_candidacy_method_check CHECK (method = 'contest_number');
");
        }
    }
}
