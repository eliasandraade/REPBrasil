using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPoliticianElectoralFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CandidacyStatus",
                table: "Politicians",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Office",
                table: "Politicians",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PartyAcronym",
                table: "Politicians",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PartyName",
                table: "Politicians",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "State",
                table: "Politicians",
                type: "text",
                nullable: true);

            migrationBuilder.Sql("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
            migrationBuilder.Sql(
                @"CREATE INDEX ""IX_Politicians_Name_trgm"" ON ""Politicians"" USING gin (""Name"" gin_trgm_ops);");
            migrationBuilder.Sql(
                @"CREATE INDEX ""IX_Politicians_BallotName_trgm"" ON ""Politicians"" USING gin (""BallotName"" gin_trgm_ops);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"DROP INDEX IF EXISTS ""IX_Politicians_Name_trgm"";");
            migrationBuilder.Sql(@"DROP INDEX IF EXISTS ""IX_Politicians_BallotName_trgm"";");

            migrationBuilder.DropColumn(
                name: "CandidacyStatus",
                table: "Politicians");

            migrationBuilder.DropColumn(
                name: "Office",
                table: "Politicians");

            migrationBuilder.DropColumn(
                name: "PartyAcronym",
                table: "Politicians");

            migrationBuilder.DropColumn(
                name: "PartyName",
                table: "Politicians");

            migrationBuilder.DropColumn(
                name: "State",
                table: "Politicians");
        }
    }
}
