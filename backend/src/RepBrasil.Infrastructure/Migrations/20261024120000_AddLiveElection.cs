using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RepBrasil.Infrastructure.Persistence;
using RepBrasil.Infrastructure.Persistence.Electoral;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20261024120000_AddLiveElection")]
    public partial class AddLiveElection : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(ElectoralSqlScripts.InElectoralSchema("020_live_election.sql"));
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TABLE IF EXISTS electoral.live_candidate_photo;
                DROP TABLE IF EXISTS electoral.live_source_state;
                DROP TABLE IF EXISTS electoral.live_event;
                DROP TABLE IF EXISTS electoral.live_accompaniment;
                DROP TABLE IF EXISTS electoral.live_territory_latest;
                DROP TABLE IF EXISTS electoral.live_snapshot;
                DROP TABLE IF EXISTS electoral.live_election;
                DROP FUNCTION IF EXISTS electoral.live_audit_immutable();
                DROP SEQUENCE IF EXISTS electoral.live_revision_seq;
                """);
        }
    }
}
