using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nostos.Backend.Migrations
{
    /// <inheritdoc />
    public partial class AddNarratorFieldForBookMetadata1 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Fix: We only add the new 'Narrator' column to the existing 'Books' table.
            // The original 'CreateTable' calls have been removed to prevent "Table already exists" errors.

            migrationBuilder.AddColumn<string>(
                name: "Narrator",
                table: "Books",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Fix: In case of rollback, we only drop the 'Narrator' column.

            migrationBuilder.DropColumn(
                name: "Narrator",
                table: "Books");
        }
    }
}
