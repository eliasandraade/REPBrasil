using Microsoft.EntityFrameworkCore.Migrations;
using RepBrasil.Infrastructure.Persistence.Electoral;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    /// <summary>
    /// Cria o schema <c>electoral</c> (território, cadastro, Boletim de Urna, disputas e
    /// candidaturas) com PostGIS. Somente aditivo: nenhuma tabela de <c>public</c> é alterada;
    /// <c>electoral.candidacy</c> apenas referencia <c>Persons</c> e <c>Politicians</c>.
    /// Requer a extensão PostGIS disponível no servidor (imagem postgis/postgis no compose).
    /// </summary>
    public partial class AddElectoralIntelligence : Migration
    {
        // Lista fechada: scripts futuros entram em novas migrations.
        private static readonly string[] Scripts =
        [
            "001_electoral_base.sql",
            "002_open_data_results.sql",
            "003_electoral_cadaster.sql",
            "004_contests_and_candidacies.sql",
        ];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql($"CREATE SCHEMA IF NOT EXISTS {ElectoralModel.Schema};");
            foreach (var script in Scripts)
            {
                migrationBuilder.Sql(ElectoralSqlScripts.InElectoralSchema(script));
            }
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Remove apenas o que esta migration criou. As extensões ficam (podem ser usadas por outros objetos).
            migrationBuilder.Sql($"DROP SCHEMA IF EXISTS {ElectoralModel.Schema} CASCADE;");
        }
    }
}
