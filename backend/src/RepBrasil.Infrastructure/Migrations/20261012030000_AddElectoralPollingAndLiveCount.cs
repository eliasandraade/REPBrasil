using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Persistence.Electoral;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261012030000_AddElectoralPollingAndLiveCount")]
    public partial class AddElectoralPollingAndLiveCount : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(ElectoralSqlScripts.InElectoralSchema("018_polling_and_live_count.sql"));
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TABLE IF EXISTS electoral.totalization_result;
                DROP TABLE IF EXISTS electoral.totalization_snapshot;
                DROP TABLE IF EXISTS electoral.poll_result;
                DROP TABLE IF EXISTS electoral.poll_scenario;
                DROP TABLE IF EXISTS electoral.poll;
                DROP TABLE IF EXISTS electoral.poll_institute;
                DROP TABLE IF EXISTS electoral.poll_source;
                """);
        }
    }
}
