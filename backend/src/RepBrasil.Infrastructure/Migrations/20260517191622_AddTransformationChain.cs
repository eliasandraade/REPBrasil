using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddTransformationChain : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "TransformationChainId",
                table: "Evidences",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "TransformationChains",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PipelineId = table.Column<string>(type: "text", nullable: false),
                    PipelineVersion = table.Column<string>(type: "text", nullable: false),
                    StartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    ErrorMessage = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DeletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SourceUpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TransformationChains", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "TransformationSteps",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ChainId = table.Column<Guid>(type: "uuid", nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    StepType = table.Column<string>(type: "text", nullable: false),
                    Description = table.Column<string>(type: "text", nullable: true),
                    Parameters = table.Column<string>(type: "jsonb", nullable: true),
                    ExecutedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SourceHash = table.Column<string>(type: "text", nullable: true),
                    OutputHash = table.Column<string>(type: "text", nullable: true),
                    InputReference = table.Column<string>(type: "text", nullable: true),
                    OutputReference = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DeletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SourceUpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TransformationSteps", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TransformationSteps_TransformationChains_ChainId",
                        column: x => x.ChainId,
                        principalTable: "TransformationChains",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Evidences_TransformationChainId",
                table: "Evidences",
                column: "TransformationChainId");

            migrationBuilder.CreateIndex(
                name: "IX_TransformationSteps_ChainId",
                table: "TransformationSteps",
                column: "ChainId");

            migrationBuilder.AddForeignKey(
                name: "FK_Evidences_TransformationChains_TransformationChainId",
                table: "Evidences",
                column: "TransformationChainId",
                principalTable: "TransformationChains",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Evidences_TransformationChains_TransformationChainId",
                table: "Evidences");

            migrationBuilder.DropTable(
                name: "TransformationSteps");

            migrationBuilder.DropTable(
                name: "TransformationChains");

            migrationBuilder.DropIndex(
                name: "IX_Evidences_TransformationChainId",
                table: "Evidences");

            migrationBuilder.DropColumn(
                name: "TransformationChainId",
                table: "Evidences");
        }
    }
}
