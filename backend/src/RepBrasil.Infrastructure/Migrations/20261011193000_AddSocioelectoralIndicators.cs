using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Persistence.Electoral;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261011193000_AddSocioelectoralIndicators")]
    public partial class AddSocioelectoralIndicators : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(ElectoralSqlScripts.InElectoralSchema("016_socioelectoral_indicators.sql"));
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DELETE FROM electoral.indicator
                WHERE code IN (
                    'ibge.literacy_rate_15_plus',
                    'derived.illiteracy_rate_15_plus'
                )
                AND NOT EXISTS (
                    SELECT 1
                    FROM electoral.indicator_value v
                    WHERE v.indicator_code = indicator.code
                );
                """);
        }
    }
}
