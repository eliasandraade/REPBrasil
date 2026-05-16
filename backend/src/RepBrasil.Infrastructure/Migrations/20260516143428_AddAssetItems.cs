using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddAssetItems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SourceElectionYear",
                table: "AssetDeclarations",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "AssetItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DeclarationId = table.Column<Guid>(type: "uuid", nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    TypeCode = table.Column<string>(type: "text", nullable: true),
                    TypeDescription = table.Column<string>(type: "text", nullable: true),
                    Description = table.Column<string>(type: "text", nullable: true),
                    Value = table.Column<decimal>(type: "numeric", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DeletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SourceUpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AssetItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AssetItems_AssetDeclarations_DeclarationId",
                        column: x => x.DeclarationId,
                        principalTable: "AssetDeclarations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AssetDeclarations_Politician_Year",
                table: "AssetDeclarations",
                columns: new[] { "PoliticianId", "ElectionYear" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AssetItems_Declaration_Order",
                table: "AssetItems",
                columns: new[] { "DeclarationId", "Order" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AssetItems");

            migrationBuilder.DropIndex(
                name: "IX_AssetDeclarations_Politician_Year",
                table: "AssetDeclarations");

            migrationBuilder.DropColumn(
                name: "SourceElectionYear",
                table: "AssetDeclarations");
        }
    }
}
