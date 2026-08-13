using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nostos.Backend.Migrations
{
    /// <inheritdoc />
    public partial class AddLibraryCommandBounds : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddCheckConstraint(
                name: "CK_LibraryCommandReceipts_Bounds",
                table: "LibraryCommandReceipts",
                sql: "length(\"ClientId\") <= 64 AND length(\"IdempotencyKey\") <= 128 AND length(\"CommandKind\") <= 32 AND length(\"ResponseJson\") <= 131072");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_LibraryCommandReceipts_Bounds",
                table: "LibraryCommandReceipts");
        }
    }
}
