using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nostos.Backend.Migrations
{
    /// <inheritdoc />
    public partial class AddBookCollections : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BookCollections",
                columns: table => new
                {
                    BookId = table.Column<Guid>(type: "TEXT", nullable: false),
                    CollectionId = table.Column<Guid>(type: "TEXT", nullable: false),
                    AddedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BookCollections", x => new { x.BookId, x.CollectionId });
                    table.ForeignKey(
                        name: "FK_BookCollections_Books_BookId",
                        column: x => x.BookId,
                        principalTable: "Books",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_BookCollections_Collections_CollectionId",
                        column: x => x.CollectionId,
                        principalTable: "Collections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BookCollections_CollectionId",
                table: "BookCollections",
                column: "CollectionId");

            // Backfill: every existing single assignment becomes one membership
            // row, so no book loses its collection when the join table becomes
            // authoritative. EF cannot infer this INSERT...SELECT.
            //
            // AddedAt reuses Books.CreatedAt — the only honest timestamp that
            // exists for rows assigned before this table did.
            migrationBuilder.Sql(
                """
                INSERT INTO "BookCollections" ("BookId", "CollectionId", "AddedAt")
                SELECT "Id", "CollectionId", "CreatedAt"
                FROM "Books"
                WHERE "CollectionId" IS NOT NULL;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BookCollections");
        }
    }
}
