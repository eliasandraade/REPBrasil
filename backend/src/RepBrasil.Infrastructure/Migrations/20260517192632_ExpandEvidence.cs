using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ExpandEvidence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Evidences_TransformationChains_TransformationChainId",
                table: "Evidences");

            migrationBuilder.AddColumn<int>(
                name: "CertaintyGrade",
                table: "Evidences",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CollectedAt",
                table: "Evidences",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<int>(
                name: "ConfidenceLevel",
                table: "Evidences",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<string>(
                name: "ContentHash",
                table: "Evidences",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ContestationStatus",
                table: "Evidences",
                type: "text",
                nullable: false,
                defaultValue: "None");

            migrationBuilder.AddColumn<string>(
                name: "DatasetId",
                table: "Evidences",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EvidenceType",
                table: "Evidences",
                type: "text",
                nullable: false,
                defaultValue: "Primary");

            migrationBuilder.AddColumn<string>(
                name: "Metadata",
                table: "Evidences",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NormalizedReference",
                table: "Evidences",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ObservedAt",
                table: "Evidences",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Evidences_SourceId",
                table: "Evidences",
                column: "SourceId");

            migrationBuilder.AddForeignKey(
                name: "FK_Evidences_Sources_SourceId",
                table: "Evidences",
                column: "SourceId",
                principalTable: "Sources",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Evidences_TransformationChains_TransformationChainId",
                table: "Evidences",
                column: "TransformationChainId",
                principalTable: "TransformationChains",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Evidences_Sources_SourceId",
                table: "Evidences");

            migrationBuilder.DropForeignKey(
                name: "FK_Evidences_TransformationChains_TransformationChainId",
                table: "Evidences");

            migrationBuilder.DropIndex(
                name: "IX_Evidences_SourceId",
                table: "Evidences");

            migrationBuilder.DropColumn(
                name: "CertaintyGrade",
                table: "Evidences");

            migrationBuilder.DropColumn(
                name: "CollectedAt",
                table: "Evidences");

            migrationBuilder.DropColumn(
                name: "ConfidenceLevel",
                table: "Evidences");

            migrationBuilder.DropColumn(
                name: "ContentHash",
                table: "Evidences");

            migrationBuilder.DropColumn(
                name: "ContestationStatus",
                table: "Evidences");

            migrationBuilder.DropColumn(
                name: "DatasetId",
                table: "Evidences");

            migrationBuilder.DropColumn(
                name: "EvidenceType",
                table: "Evidences");

            migrationBuilder.DropColumn(
                name: "Metadata",
                table: "Evidences");

            migrationBuilder.DropColumn(
                name: "NormalizedReference",
                table: "Evidences");

            migrationBuilder.DropColumn(
                name: "ObservedAt",
                table: "Evidences");

            migrationBuilder.AddForeignKey(
                name: "FK_Evidences_TransformationChains_TransformationChainId",
                table: "Evidences",
                column: "TransformationChainId",
                principalTable: "TransformationChains",
                principalColumn: "Id");
        }
    }
}
