using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RepBrasil.Infrastructure.Persistence;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    /// <summary>
    /// Endereço público e permanente do político: /politicos/&lt;slug&gt;. O slug é escolhido UMA vez (no INSERT, por
    /// gatilho — vale para o ETL e para a API) e nunca muda, nem se o nome de urna mudar:
    /// nome de urna ("andre-fernandes"); se já usado, nome civil ("andre-fernandes-de-moura"); depois nome civil + número.
    /// Na carga inicial, quem foi eleito e disputou mais recentemente escolhe primeiro.
    /// Rollback falha (em vez de apagar endereços já publicados) quando algum slug existe.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261011110000_AddPoliticianSlug")]
    public partial class AddPoliticianSlug : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                ALTER TABLE public."Politicians" ADD COLUMN IF NOT EXISTS "Slug" text;

                CREATE OR REPLACE FUNCTION public.slugify(value text) RETURNS text
                  LANGUAGE sql IMMUTABLE PARALLEL SAFE
                AS $$
                  SELECT nullif(btrim(left(replace(public.search_fold(value), ' ', '-'), 80), '-'), '')
                $$;

                CREATE UNIQUE INDEX IF NOT EXISTS politicians_slug_uidx ON public."Politicians" ("Slug") WHERE "Slug" IS NOT NULL;

                CREATE OR REPLACE FUNCTION public.politician_free_slug(ballot_name text, civil_name text) RETURNS text
                  LANGUAGE plpgsql
                AS $$
                DECLARE
                  candidate text;
                  base text := coalesce(public.slugify(civil_name), public.slugify(ballot_name), 'politico');
                  n int := 2;
                BEGIN
                  FOREACH candidate IN ARRAY ARRAY[public.slugify(ballot_name), public.slugify(civil_name)] LOOP
                    IF candidate IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public."Politicians" WHERE "Slug" = candidate) THEN
                      RETURN candidate;
                    END IF;
                  END LOOP;
                  WHILE EXISTS (SELECT 1 FROM public."Politicians" WHERE "Slug" = base || '-' || n) LOOP
                    n := n + 1;
                  END LOOP;
                  RETURN base || '-' || n;
                END $$;

                CREATE OR REPLACE FUNCTION public.politicians_assign_slug() RETURNS trigger
                  LANGUAGE plpgsql
                AS $$
                BEGIN
                  IF NEW."Slug" IS NULL THEN
                    PERFORM pg_advisory_xact_lock(hashtext('public.politicians.slug'));
                    NEW."Slug" := public.politician_free_slug(NEW."BallotName", NEW."Name");
                  END IF;
                  RETURN NEW;
                END $$;

                DROP TRIGGER IF EXISTS politicians_assign_slug ON public."Politicians";
                CREATE TRIGGER politicians_assign_slug BEFORE INSERT ON public."Politicians"
                  FOR EACH ROW EXECUTE FUNCTION public.politicians_assign_slug();

                DO $$
                DECLARE r record;
                BEGIN
                  PERFORM pg_advisory_xact_lock(hashtext('public.politicians.slug'));
                  FOR r IN
                    SELECT p."Id", p."BallotName", p."Name"
                      FROM public."Politicians" p
                      LEFT JOIN (
                        SELECT c.politician_id, count(*) FILTER (WHERE c.elected) AS elected, max(e.year * 10 + e.round) AS latest
                          FROM electoral.candidacy c
                          JOIN electoral.contest k ON k.id = c.contest_id
                          JOIN electoral.election e ON e.id = k.election_id
                         WHERE c.politician_id IS NOT NULL
                         GROUP BY c.politician_id
                      ) s ON s.politician_id = p."Id"
                     WHERE p."Slug" IS NULL
                     ORDER BY (p."DeletedAt" IS NULL) DESC, coalesce(s.elected, 0) DESC, coalesce(s.latest, 0) DESC, p."CreatedAt", p."Id"
                  LOOP
                    UPDATE public."Politicians" SET "Slug" = public.politician_free_slug(r."BallotName", r."Name") WHERE "Id" = r."Id";
                  END LOOP;
                END $$;
                """);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$
                BEGIN
                  IF EXISTS (SELECT 1 FROM public."Politicians" WHERE "Slug" IS NOT NULL) THEN
                    RAISE EXCEPTION 'cannot downgrade politician slugs: they are permanent public URLs already assigned';
                  END IF;
                END $$;

                DROP TRIGGER IF EXISTS politicians_assign_slug ON public."Politicians";
                DROP FUNCTION IF EXISTS public.politicians_assign_slug();
                DROP FUNCTION IF EXISTS public.politician_free_slug(text, text);
                DROP FUNCTION IF EXISTS public.slugify(text);
                DROP INDEX IF EXISTS public.politicians_slug_uidx;
                """);
            migrationBuilder.DropColumn(name: "Slug", table: "Politicians");
        }
    }
}
