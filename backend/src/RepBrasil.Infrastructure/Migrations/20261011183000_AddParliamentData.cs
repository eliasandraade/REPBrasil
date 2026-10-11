using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Persistence.Electoral;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261011183000_AddParliamentData")]
    public partial class AddParliamentData : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(ElectoralSqlScripts.InElectoralSchema("017_parliament.sql"));
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TABLE IF EXISTS electoral.parliament_amendment;
                DROP TABLE IF EXISTS electoral.parliament_activity;
                DROP TABLE IF EXISTS electoral.parliament_mandate;
                DROP TABLE IF EXISTS electoral.parliament_member;
                DROP TABLE IF EXISTS electoral.parliament_source;
                """);
        }
    }
}
