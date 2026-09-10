using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nostos.Backend.Migrations
{
    /// <inheritdoc />
    public partial class AddWorkModelAndWorkIdToBooks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Works",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Title = table.Column<string>(type: "TEXT", nullable: false),
                    Author = table.Column<string>(type: "TEXT", nullable: true),
                    NormalizedTitle = table.Column<string>(type: "TEXT", nullable: false),
                    NormalizedAuthor = table.Column<string>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Works", x => x.Id);
                });

            migrationBuilder.Sql(
                """
                INSERT INTO "Works" ("Id", "Title", "Author", "NormalizedTitle", "NormalizedAuthor", "CreatedAt")
                SELECT '00000000-0000-0000-0000-000000000000', 'Legacy Placeholder Work', NULL, '', NULL, '1970-01-01 00:00:00'
                WHERE EXISTS (SELECT 1 FROM "Books");
                """);

            migrationBuilder.AddColumn<Guid>(
                name: "WorkId",
                table: "Books",
                type: "TEXT",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.CreateIndex(
                name: "IX_Books_WorkId",
                table: "Books",
                column: "WorkId");

            migrationBuilder.CreateIndex(
                name: "IX_Works_NormalizedAuthor",
                table: "Works",
                column: "NormalizedAuthor");

            migrationBuilder.CreateIndex(
                name: "IX_Works_NormalizedTitle",
                table: "Works",
                column: "NormalizedTitle");

            migrationBuilder.AddForeignKey(
                name: "FK_Books_Works_WorkId",
                table: "Books",
                column: "WorkId",
                principalTable: "Works",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Books_Works_WorkId",
                table: "Books");

            migrationBuilder.DropTable(
                name: "Works");

            migrationBuilder.DropIndex(
                name: "IX_Books_WorkId",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "WorkId",
                table: "Books");
        }
    }
}
