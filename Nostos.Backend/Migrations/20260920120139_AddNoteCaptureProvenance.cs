using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nostos.Backend.Migrations
{
    /// <inheritdoc />
    public partial class AddNoteCaptureProvenance : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "AnchorVerified",
                table: "Notes",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "CaptureSource",
                table: "Notes",
                type: "TEXT",
                nullable: false,
                defaultValue: "text");

            migrationBuilder.AddColumn<string>(
                name: "ProcessingMode",
                table: "Notes",
                type: "TEXT",
                nullable: false,
                defaultValue: "verbatim");

            migrationBuilder.AddColumn<string>(
                name: "RawContent",
                table: "Notes",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SourceAnchorKind",
                table: "Notes",
                type: "TEXT",
                nullable: false,
                defaultValue: "unknown");

            migrationBuilder.AddColumn<string>(
                name: "SourceAnchorValue",
                table: "Notes",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "NoteCommandReceipts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    ClientId = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    IdempotencyKey = table.Column<string>(type: "TEXT", maxLength: 128, nullable: false),
                    Command = table.Column<string>(type: "TEXT", maxLength: 32, nullable: false),
                    ResultJson = table.Column<string>(type: "TEXT", maxLength: 131072, nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NoteCommandReceipts", x => x.Id);
                    table.CheckConstraint("CK_NoteCommandReceipts_Bounds", "length(\"ClientId\") <= 64 AND length(\"IdempotencyKey\") <= 128 AND length(\"Command\") <= 32 AND length(\"ResultJson\") <= 131072");
                });

            migrationBuilder.CreateIndex(
                name: "IX_NoteCommandReceipts_ClientId_IdempotencyKey",
                table: "NoteCommandReceipts",
                columns: new[] { "ClientId", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_NoteCommandReceipts_CreatedAtUtc",
                table: "NoteCommandReceipts",
                column: "CreatedAtUtc");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NoteCommandReceipts");

            migrationBuilder.DropColumn(
                name: "AnchorVerified",
                table: "Notes");

            migrationBuilder.DropColumn(
                name: "CaptureSource",
                table: "Notes");

            migrationBuilder.DropColumn(
                name: "ProcessingMode",
                table: "Notes");

            migrationBuilder.DropColumn(
                name: "RawContent",
                table: "Notes");

            migrationBuilder.DropColumn(
                name: "SourceAnchorKind",
                table: "Notes");

            migrationBuilder.DropColumn(
                name: "SourceAnchorValue",
                table: "Notes");
        }
    }
}
