using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ExpandSourceFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CollectionMethod",
                table: "Sources",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ConfidenceLevel",
                table: "Sources",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "HistoricalReliability",
                table: "Sources",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsAvailable",
                table: "Sources",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "OperationalStatus",
                table: "Sources",
                type: "text",
                nullable: false,
                defaultValue: "Active");

            migrationBuilder.AddColumn<string>(
                name: "Periodicity",
                table: "Sources",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SchemaVersion",
                table: "Sources",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "SourceDataUpdatedAt",
                table: "Sources",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CollectionMethod",
                table: "Sources");

            migrationBuilder.DropColumn(
                name: "ConfidenceLevel",
                table: "Sources");

            migrationBuilder.DropColumn(
                name: "HistoricalReliability",
                table: "Sources");

            migrationBuilder.DropColumn(
                name: "IsAvailable",
                table: "Sources");

            migrationBuilder.DropColumn(
                name: "OperationalStatus",
                table: "Sources");

            migrationBuilder.DropColumn(
                name: "Periodicity",
                table: "Sources");

            migrationBuilder.DropColumn(
                name: "SchemaVersion",
                table: "Sources");

            migrationBuilder.DropColumn(
                name: "SourceDataUpdatedAt",
                table: "Sources");
        }
    }
}
