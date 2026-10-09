using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPersonDocumentHashIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Persons_DocumentType_NormalizedDocumentHash",
                table: "Persons",
                columns: new[] { "DocumentType", "NormalizedDocumentHash" },
                unique: true,
                filter: "\"NormalizedDocumentHash\" IS NOT NULL AND \"DeletedAt\" IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Persons_DocumentType_NormalizedDocumentHash",
                table: "Persons");
        }
    }
}
