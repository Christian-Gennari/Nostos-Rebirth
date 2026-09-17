using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nostos.Backend.Migrations
{
    /// <inheritdoc />
    public partial class AddBookAcquisitionProvenance : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BookAcquisitions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    BookId = table.Column<Guid>(type: "TEXT", nullable: false),
                    ProviderId = table.Column<string>(type: "TEXT", nullable: false),
                    ProviderDisplayName = table.Column<string>(type: "TEXT", nullable: false),
                    ExternalId = table.Column<string>(type: "TEXT", nullable: false),
                    AssetId = table.Column<string>(type: "TEXT", nullable: false),
                    AssetFormat = table.Column<string>(type: "TEXT", nullable: true),
                    ImportedExtension = table.Column<string>(type: "TEXT", nullable: true),
                    SourceUrl = table.Column<string>(type: "TEXT", nullable: true),
                    RightsStatement = table.Column<string>(type: "TEXT", nullable: true),
                    AcquiredAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BookAcquisitions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BookAcquisitions_Books_BookId",
                        column: x => x.BookId,
                        principalTable: "Books",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BookAcquisitions_BookId",
                table: "BookAcquisitions",
                column: "BookId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BookAcquisitions_ProviderId_ExternalId_AssetId",
                table: "BookAcquisitions",
                columns: new[] { "ProviderId", "ExternalId", "AssetId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BookAcquisitions");
        }
    }
}
