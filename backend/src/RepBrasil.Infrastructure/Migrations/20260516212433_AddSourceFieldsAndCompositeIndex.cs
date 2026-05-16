using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddSourceFieldsAndCompositeIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "FileSizeBytes",
                table: "Sources",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Organization",
                table: "Sources",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateIndex(
                name: "IX_Sources_Name_SourceType",
                table: "Sources",
                columns: new[] { "Name", "SourceType" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Sources_Name_SourceType",
                table: "Sources");

            migrationBuilder.DropColumn(
                name: "FileSizeBytes",
                table: "Sources");

            migrationBuilder.DropColumn(
                name: "Organization",
                table: "Sources");
        }
    }
}
