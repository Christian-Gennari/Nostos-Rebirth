using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nostos.Backend.Migrations
{
    /// <inheritdoc />
    public partial class AddReadingWeeklyReviewDecisions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ReadingModeDecisions_ReadingSessions_SessionId",
                table: "ReadingModeDecisions");

            migrationBuilder.DropIndex(
                name: "IX_ReadingWeeklyReviews_WeekKey_Mode",
                table: "ReadingWeeklyReviews");

            migrationBuilder.DropIndex(
                name: "IX_ReadingModeDecisions_SessionId",
                table: "ReadingModeDecisions");

            migrationBuilder.DropColumn(
                name: "DecisionKind",
                table: "ReadingWeeklyReviews");

            migrationBuilder.DropColumn(
                name: "Mode",
                table: "ReadingWeeklyReviews");

            migrationBuilder.DropColumn(
                name: "Note",
                table: "ReadingModeDecisions");

            migrationBuilder.DropColumn(
                name: "SessionId",
                table: "ReadingModeDecisions");

            migrationBuilder.RenameColumn(
                name: "TargetBeforeMinutes",
                table: "ReadingWeeklyReviews",
                newName: "TotalVolumeMinutes");

            migrationBuilder.RenameColumn(
                name: "TargetAfterMinutes",
                table: "ReadingWeeklyReviews",
                newName: "PreviousWeekVolumeMinutes");

            migrationBuilder.RenameColumn(
                name: "Reason",
                table: "ReadingWeeklyReviews",
                newName: "StateVersionAfter");

            migrationBuilder.RenameColumn(
                name: "ConsolidationWeeks",
                table: "ReadingProgrammes",
                newName: "EnduranceConsecutiveIncreases");

            migrationBuilder.RenameColumn(
                name: "Qualifies",
                table: "ReadingModeDecisions",
                newName: "TargetBeforeMinutes");

            migrationBuilder.RenameColumn(
                name: "IsEvidence",
                table: "ReadingModeDecisions",
                newName: "TargetAfterMinutes");

            migrationBuilder.RenameColumn(
                name: "CompletedSeconds",
                table: "ReadingModeDecisions",
                newName: "QualifyingCount");

            migrationBuilder.AddColumn<int>(
                name: "DeepConsecutiveIncreases",
                table: "ReadingProgrammes",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<double>(
                name: "CompletionRate",
                table: "ReadingModeDecisions",
                type: "REAL",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<string>(
                name: "DecisionKind",
                table: "ReadingModeDecisions",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "MedianEffort",
                table: "ReadingModeDecisions",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "MedianFocus",
                table: "ReadingModeDecisions",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Mode",
                table: "ReadingModeDecisions",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "NextConsecutiveIncreases",
                table: "ReadingModeDecisions",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "Reason",
                table: "ReadingModeDecisions",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateIndex(
                name: "IX_ReadingWeeklyReviews_WeekKey",
                table: "ReadingWeeklyReviews",
                column: "WeekKey",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ReadingWeeklyReviews_WeekKey",
                table: "ReadingWeeklyReviews");

            migrationBuilder.DropColumn(
                name: "DeepConsecutiveIncreases",
                table: "ReadingProgrammes");

            migrationBuilder.DropColumn(
                name: "CompletionRate",
                table: "ReadingModeDecisions");

            migrationBuilder.DropColumn(
                name: "DecisionKind",
                table: "ReadingModeDecisions");

            migrationBuilder.DropColumn(
                name: "MedianEffort",
                table: "ReadingModeDecisions");

            migrationBuilder.DropColumn(
                name: "MedianFocus",
                table: "ReadingModeDecisions");

            migrationBuilder.DropColumn(
                name: "Mode",
                table: "ReadingModeDecisions");

            migrationBuilder.DropColumn(
                name: "NextConsecutiveIncreases",
                table: "ReadingModeDecisions");

            migrationBuilder.DropColumn(
                name: "Reason",
                table: "ReadingModeDecisions");

            migrationBuilder.RenameColumn(
                name: "TotalVolumeMinutes",
                table: "ReadingWeeklyReviews",
                newName: "TargetBeforeMinutes");

            migrationBuilder.RenameColumn(
                name: "StateVersionAfter",
                table: "ReadingWeeklyReviews",
                newName: "Reason");

            migrationBuilder.RenameColumn(
                name: "PreviousWeekVolumeMinutes",
                table: "ReadingWeeklyReviews",
                newName: "TargetAfterMinutes");

            migrationBuilder.RenameColumn(
                name: "EnduranceConsecutiveIncreases",
                table: "ReadingProgrammes",
                newName: "ConsolidationWeeks");

            migrationBuilder.RenameColumn(
                name: "TargetBeforeMinutes",
                table: "ReadingModeDecisions",
                newName: "Qualifies");

            migrationBuilder.RenameColumn(
                name: "TargetAfterMinutes",
                table: "ReadingModeDecisions",
                newName: "IsEvidence");

            migrationBuilder.RenameColumn(
                name: "QualifyingCount",
                table: "ReadingModeDecisions",
                newName: "CompletedSeconds");

            migrationBuilder.AddColumn<string>(
                name: "DecisionKind",
                table: "ReadingWeeklyReviews",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "Mode",
                table: "ReadingWeeklyReviews",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "Note",
                table: "ReadingModeDecisions",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SessionId",
                table: "ReadingModeDecisions",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReadingWeeklyReviews_WeekKey_Mode",
                table: "ReadingWeeklyReviews",
                columns: new[] { "WeekKey", "Mode" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReadingModeDecisions_SessionId",
                table: "ReadingModeDecisions",
                column: "SessionId");

            migrationBuilder.AddForeignKey(
                name: "FK_ReadingModeDecisions_ReadingSessions_SessionId",
                table: "ReadingModeDecisions",
                column: "SessionId",
                principalTable: "ReadingSessions",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }
    }
}
