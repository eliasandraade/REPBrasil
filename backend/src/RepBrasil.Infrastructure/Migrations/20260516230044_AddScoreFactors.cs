using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddScoreFactors : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ScoreFactors",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ScoreSnapshotId = table.Column<Guid>(type: "uuid", nullable: false),
                    FactorKey = table.Column<string>(type: "text", nullable: false),
                    FactorCategory = table.Column<string>(type: "text", nullable: false),
                    FactorLabel = table.Column<string>(type: "text", nullable: false),
                    FactorValue = table.Column<decimal>(type: "numeric", nullable: true),
                    FactorWeight = table.Column<decimal>(type: "numeric", nullable: true),
                    EvidenceId = table.Column<Guid>(type: "uuid", nullable: true),
                    SourceId = table.Column<Guid>(type: "uuid", nullable: true),
                    EvidenceReference = table.Column<string>(type: "text", nullable: true),
                    SourceReference = table.Column<string>(type: "text", nullable: true),
                    Explanation = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DeletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SourceUpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ScoreFactors", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ScoreFactors_ScoreSnapshots_ScoreSnapshotId",
                        column: x => x.ScoreSnapshotId,
                        principalTable: "ScoreSnapshots",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ScoreFactors_SnapshotId",
                table: "ScoreFactors",
                column: "ScoreSnapshotId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ScoreFactors");
        }
    }
}
