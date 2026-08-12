using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nostos.Backend.Migrations
{
    /// <inheritdoc />
    public partial class AddReadingNotificationDedupeKey : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DedupeKey",
                table: "ReadingNotifications",
                type: "TEXT",
                maxLength: 128,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateIndex(
                name: "IX_ReadingNotifications_DedupeKey",
                table: "ReadingNotifications",
                column: "DedupeKey",
                unique: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_ReadingNotifications_DedupeKey_NotEmpty",
                table: "ReadingNotifications",
                sql: "length(DedupeKey) > 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ReadingNotifications_DedupeKey",
                table: "ReadingNotifications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ReadingNotifications_DedupeKey_NotEmpty",
                table: "ReadingNotifications");

            migrationBuilder.DropColumn(
                name: "DedupeKey",
                table: "ReadingNotifications");
        }
    }
}
