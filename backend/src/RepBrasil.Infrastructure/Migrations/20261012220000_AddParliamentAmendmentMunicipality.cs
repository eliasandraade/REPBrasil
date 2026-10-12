using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Persistence.Electoral;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261012220000_AddParliamentAmendmentMunicipality")]
    public partial class AddParliamentAmendmentMunicipality : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(ElectoralSqlScripts.InElectoralSchema("019_parliament_amendment_municipality.sql"));
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE electoral.parliament_amendment DROP COLUMN IF EXISTS municipality_ibge_code;");
        }
    }
}
