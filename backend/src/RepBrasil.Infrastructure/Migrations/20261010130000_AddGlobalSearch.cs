using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Persistence.Electoral;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    /// <summary>
    /// Busca global: função de normalização sem acento e índice de trigramas sobre os nomes dos políticos.
    /// Só objetos derivados (função e índice) — o rollback não apaga dado nenhum.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261010130000_AddGlobalSearch")]
    public partial class AddGlobalSearch : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(ElectoralSqlScripts.InElectoralSchema("012_global_search.sql"));
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP INDEX IF EXISTS public.politicians_search_trgm_idx;
                DROP FUNCTION IF EXISTS public.search_fold(text);
                """);
        }
    }
}
