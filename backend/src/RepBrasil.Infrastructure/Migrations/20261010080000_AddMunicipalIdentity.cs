using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Persistence.Electoral;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    /// <summary>
    /// Eleições municipais: o município entra na identidade do votável dos cargos
    /// municipais, a disputa municipal ganha UF explícita, candidaturas sem CPF publicado
    /// podem ser resolvidas pelo histórico oficial (status próprio) e as consultas
    /// territoriais do Raio X ganham índice. Rollback falha (nunca destrói semântica) quando já
    /// existem votáveis ou disputas municipais.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261010080000_AddMunicipalIdentity")]
    public partial class AddMunicipalIdentity : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(ElectoralSqlScripts.InElectoralSchema("007_municipal_identity.sql"));
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql($@"
SET LOCAL search_path TO {ElectoralModel.Schema}, public;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM votable WHERE municipality_tse_code IS NOT NULL) THEN
    RAISE EXCEPTION
      'cannot downgrade municipal identity: municipal votables exist and would collide under the UF-only key';
  END IF;
  IF EXISTS (SELECT 1 FROM contest WHERE scope = 'municipal') THEN
    RAISE EXCEPTION 'cannot downgrade municipal identity: municipal contests exist';
  END IF;
  IF EXISTS (SELECT 1 FROM candidacy WHERE identity_status = 'resolved_tse_link') THEN
    RAISE EXCEPTION 'cannot downgrade municipal identity: candidacies resolved by the official TSE link exist';
  END IF;
END $$;

DROP TABLE IF EXISTS candidacy_prior;
ALTER TABLE candidacy DROP CONSTRAINT IF EXISTS candidacy_person_matches_status_check;
ALTER TABLE candidacy DROP CONSTRAINT IF EXISTS candidacy_identity_status_check;
ALTER TABLE candidacy ADD CONSTRAINT candidacy_identity_status_check CHECK (identity_status IN (
  'resolved', 'unresolved_document_unavailable', 'unresolved_document_invalid'));
ALTER TABLE candidacy ADD CONSTRAINT candidacy_person_matches_status_check CHECK (
  (identity_status = 'resolved') = (person_id IS NOT NULL));

DROP INDEX IF EXISTS section_office_result_year_office_scope_idx;
DROP INDEX IF EXISTS contest_scope_uf_idx;
ALTER TABLE contest DROP CONSTRAINT IF EXISTS contest_unit_format_check;
ALTER TABLE contest DROP COLUMN IF EXISTS uf;
DROP INDEX IF EXISTS votable_identity_scope_uidx;
ALTER TABLE votable DROP CONSTRAINT IF EXISTS votable_municipal_scope_check;
ALTER TABLE votable DROP COLUMN IF EXISTS municipality_tse_code;
CREATE UNIQUE INDEX IF NOT EXISTS votable_identity_uf_uidx
  ON votable (uf, election_code, office_code, type_code, number);
");
        }
    }
}
