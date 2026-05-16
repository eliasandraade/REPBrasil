using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddElectionResultFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<Guid>(
                name: "PartyId",
                table: "ElectionResults",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<decimal>(
                name: "Percentage",
                table: "ElectionResults",
                type: "numeric",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Round",
                table: "ElectionResults",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<string>(
                name: "Situation",
                table: "ElectionResults",
                type: "text",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_ElectionResults_ElectionId",
                table: "ElectionResults",
                column: "ElectionId");

            migrationBuilder.CreateIndex(
                name: "IX_ElectionResults_Politician_Election_Round",
                table: "ElectionResults",
                columns: new[] { "PoliticianId", "ElectionId", "Round" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_ElectionResults_Elections_ElectionId",
                table: "ElectionResults",
                column: "ElectionId",
                principalTable: "Elections",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ElectionResults_Elections_ElectionId",
                table: "ElectionResults");

            migrationBuilder.DropIndex(
                name: "IX_ElectionResults_ElectionId",
                table: "ElectionResults");

            migrationBuilder.DropIndex(
                name: "IX_ElectionResults_Politician_Election_Round",
                table: "ElectionResults");

            migrationBuilder.DropColumn(
                name: "Percentage",
                table: "ElectionResults");

            migrationBuilder.DropColumn(
                name: "Round",
                table: "ElectionResults");

            migrationBuilder.DropColumn(
                name: "Situation",
                table: "ElectionResults");

            migrationBuilder.AlterColumn<Guid>(
                name: "PartyId",
                table: "ElectionResults",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }
    }
}
