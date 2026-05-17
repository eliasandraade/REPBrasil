using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ExpandContestation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "EvidenceId",
                table: "Contestations",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReviewNotes",
                table: "Contestations",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ReviewedAt",
                table: "Contestations",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReviewerRole",
                table: "Contestations",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SourceId",
                table: "Contestations",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SubmitterType",
                table: "Contestations",
                type: "text",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Contestations_EvidenceId",
                table: "Contestations",
                column: "EvidenceId");

            migrationBuilder.CreateIndex(
                name: "IX_Contestations_PoliticianId",
                table: "Contestations",
                column: "PoliticianId");

            migrationBuilder.CreateIndex(
                name: "IX_Contestations_SourceId",
                table: "Contestations",
                column: "SourceId");

            migrationBuilder.AddForeignKey(
                name: "FK_Contestations_Evidences_EvidenceId",
                table: "Contestations",
                column: "EvidenceId",
                principalTable: "Evidences",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Contestations_Politicians_PoliticianId",
                table: "Contestations",
                column: "PoliticianId",
                principalTable: "Politicians",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Contestations_Sources_SourceId",
                table: "Contestations",
                column: "SourceId",
                principalTable: "Sources",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Contestations_Evidences_EvidenceId",
                table: "Contestations");

            migrationBuilder.DropForeignKey(
                name: "FK_Contestations_Politicians_PoliticianId",
                table: "Contestations");

            migrationBuilder.DropForeignKey(
                name: "FK_Contestations_Sources_SourceId",
                table: "Contestations");

            migrationBuilder.DropIndex(
                name: "IX_Contestations_EvidenceId",
                table: "Contestations");

            migrationBuilder.DropIndex(
                name: "IX_Contestations_PoliticianId",
                table: "Contestations");

            migrationBuilder.DropIndex(
                name: "IX_Contestations_SourceId",
                table: "Contestations");

            migrationBuilder.DropColumn(
                name: "EvidenceId",
                table: "Contestations");

            migrationBuilder.DropColumn(
                name: "ReviewNotes",
                table: "Contestations");

            migrationBuilder.DropColumn(
                name: "ReviewedAt",
                table: "Contestations");

            migrationBuilder.DropColumn(
                name: "ReviewerRole",
                table: "Contestations");

            migrationBuilder.DropColumn(
                name: "SourceId",
                table: "Contestations");

            migrationBuilder.DropColumn(
                name: "SubmitterType",
                table: "Contestations");
        }
    }
}
