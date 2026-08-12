using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nostos.Backend.Migrations
{
    /// <inheritdoc />
    public partial class AddLibraryCommandSurface : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "NormalizedAsin",
                table: "Books",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NormalizedIsbn",
                table: "Books",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "LibraryCommandReceipts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    ClientId = table.Column<string>(type: "TEXT", nullable: false),
                    IdempotencyKey = table.Column<string>(type: "TEXT", nullable: false),
                    CommandKind = table.Column<string>(type: "TEXT", nullable: false),
                    ResponseJson = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LibraryCommandReceipts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "LibraryStates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    SingletonSlot = table.Column<int>(type: "INTEGER", nullable: false),
                    StateVersion = table.Column<string>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LibraryStates", x => x.Id);
                    table.CheckConstraint("CK_LibraryStates_SingletonSlot", "SingletonSlot = 1");
                });

            migrationBuilder.CreateIndex(
                name: "IX_Books_NormalizedAsin",
                table: "Books",
                column: "NormalizedAsin",
                unique: true,
                filter: "\"NormalizedAsin\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Books_NormalizedIsbn",
                table: "Books",
                column: "NormalizedIsbn",
                unique: true,
                filter: "\"NormalizedIsbn\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_LibraryCommandReceipts_ClientId_IdempotencyKey",
                table: "LibraryCommandReceipts",
                columns: new[] { "ClientId", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_LibraryStates_SingletonSlot",
                table: "LibraryStates",
                column: "SingletonSlot",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "LibraryCommandReceipts");

            migrationBuilder.DropTable(
                name: "LibraryStates");

            migrationBuilder.DropIndex(
                name: "IX_Books_NormalizedAsin",
                table: "Books");

            migrationBuilder.DropIndex(
                name: "IX_Books_NormalizedIsbn",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "NormalizedAsin",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "NormalizedIsbn",
                table: "Books");
        }
    }
}
