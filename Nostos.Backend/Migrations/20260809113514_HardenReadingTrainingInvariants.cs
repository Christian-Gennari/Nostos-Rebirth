using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nostos.Backend.Migrations
{
    /// <inheritdoc />
    public partial class HardenReadingTrainingInvariants : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ReadingNotifications_AckedAt",
                table: "ReadingNotifications");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ReadingSessions_OpenSlot_Matches_Status",
                table: "ReadingSessions",
                sql: "(OpenSlot IS NOT NULL AND Status IN (1, 2, 3, 4) AND OpenSlot = 0) OR (OpenSlot IS NULL AND Status IN (0, 5, 6))");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ReadingProgrammes_SingletonSlot",
                table: "ReadingProgrammes",
                sql: "SingletonSlot = 1");

            migrationBuilder.CreateIndex(
                name: "IX_ReadingNotifications_AckedAt_LeaseUntil",
                table: "ReadingNotifications",
                columns: new[] { "AckedAt", "LeaseUntil" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_ReadingBookAssignments_DefaultSlot_Mode_Status",
                table: "ReadingBookAssignments",
                sql: "DefaultSlot IS NULL OR (DefaultSlot = Mode AND Status = 0)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_ReadingSessions_OpenSlot_Matches_Status",
                table: "ReadingSessions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ReadingProgrammes_SingletonSlot",
                table: "ReadingProgrammes");

            migrationBuilder.DropIndex(
                name: "IX_ReadingNotifications_AckedAt_LeaseUntil",
                table: "ReadingNotifications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ReadingBookAssignments_DefaultSlot_Mode_Status",
                table: "ReadingBookAssignments");

            migrationBuilder.CreateIndex(
                name: "IX_ReadingNotifications_AckedAt",
                table: "ReadingNotifications",
                column: "AckedAt");
        }
    }
}
