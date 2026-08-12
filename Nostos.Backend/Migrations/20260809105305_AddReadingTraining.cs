using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nostos.Backend.Migrations
{
    /// <inheritdoc />
    public partial class AddReadingTraining : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ReadingBookAssignments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    BookId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Mode = table.Column<int>(type: "INTEGER", nullable: false),
                    Status = table.Column<int>(type: "INTEGER", nullable: false),
                    QueueOrder = table.Column<int>(type: "INTEGER", nullable: false),
                    DefaultSlot = table.Column<int>(type: "INTEGER", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    StartedAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                    CompletedAt = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReadingBookAssignments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ReadingBookAssignments_Books_BookId",
                        column: x => x.BookId,
                        principalTable: "Books",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ReadingCommandReceipts",
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
                    table.PrimaryKey("PK_ReadingCommandReceipts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ReadingImportReceipts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    SourceFingerprint = table.Column<string>(type: "TEXT", nullable: false),
                    ResultJson = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReadingImportReceipts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ReadingNotifications",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Kind = table.Column<string>(type: "TEXT", nullable: false),
                    PayloadJson = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    LeaseUntil = table.Column<DateTime>(type: "TEXT", nullable: true),
                    AckedAt = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReadingNotifications", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ReadingProgrammes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    SingletonSlot = table.Column<int>(type: "INTEGER", nullable: false),
                    TimezoneId = table.Column<string>(type: "TEXT", nullable: false),
                    StateVersion = table.Column<string>(type: "TEXT", nullable: false),
                    EnduranceTargetMinutes = table.Column<int>(type: "INTEGER", nullable: false),
                    DeepTargetMinutes = table.Column<int>(type: "INTEGER", nullable: false),
                    RecoveryTargetMinutes = table.Column<int>(type: "INTEGER", nullable: false),
                    EnduranceEstablishedMinutes = table.Column<int>(type: "INTEGER", nullable: false),
                    DeepEstablishedMinutes = table.Column<int>(type: "INTEGER", nullable: false),
                    RecoveryEstablishedMinutes = table.Column<int>(type: "INTEGER", nullable: false),
                    ConsolidationWeeks = table.Column<int>(type: "INTEGER", nullable: false),
                    DeloadActive = table.Column<bool>(type: "INTEGER", nullable: false),
                    DeloadStartedAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReadingProgrammes", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ReadingWeeklyReviews",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    WeekKey = table.Column<string>(type: "TEXT", nullable: false),
                    Mode = table.Column<int>(type: "INTEGER", nullable: false),
                    CommittedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    TargetBeforeMinutes = table.Column<int>(type: "INTEGER", nullable: false),
                    TargetAfterMinutes = table.Column<int>(type: "INTEGER", nullable: false),
                    DecisionKind = table.Column<string>(type: "TEXT", nullable: false),
                    Reason = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReadingWeeklyReviews", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ReadingSessions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    BookAssignmentId = table.Column<Guid>(type: "TEXT", nullable: false),
                    BookId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Mode = table.Column<int>(type: "INTEGER", nullable: false),
                    Status = table.Column<int>(type: "INTEGER", nullable: false),
                    OpenSlot = table.Column<int>(type: "INTEGER", nullable: true),
                    TargetMinutes = table.Column<int>(type: "INTEGER", nullable: false),
                    Constraint = table.Column<int>(type: "INTEGER", nullable: false),
                    PlannedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    StartedAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                    LastStartedAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                    PausedAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                    CompletedAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                    AccumulatedSeconds = table.Column<int>(type: "INTEGER", nullable: false),
                    MeasuredSeconds = table.Column<int>(type: "INTEGER", nullable: false),
                    ReportedMinutes = table.Column<int>(type: "INTEGER", nullable: true),
                    Effort = table.Column<int>(type: "INTEGER", nullable: false),
                    Focus = table.Column<int>(type: "INTEGER", nullable: false),
                    Rating = table.Column<int>(type: "INTEGER", nullable: true),
                    RatingsSkipped = table.Column<bool>(type: "INTEGER", nullable: false),
                    NoticeSent = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReadingSessions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ReadingSessions_Books_BookId",
                        column: x => x.BookId,
                        principalTable: "Books",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ReadingSessions_ReadingBookAssignments_BookAssignmentId",
                        column: x => x.BookAssignmentId,
                        principalTable: "ReadingBookAssignments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ReadingCaptures",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Text = table.Column<string>(type: "TEXT", nullable: false),
                    Type = table.Column<int>(type: "INTEGER", nullable: false),
                    BookId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SessionId = table.Column<Guid>(type: "TEXT", nullable: true),
                    ExternalId = table.Column<string>(type: "TEXT", nullable: true),
                    Resolved = table.Column<bool>(type: "INTEGER", nullable: false),
                    PromotedNoteId = table.Column<Guid>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReadingCaptures", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ReadingCaptures_Books_BookId",
                        column: x => x.BookId,
                        principalTable: "Books",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ReadingCaptures_ReadingSessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "ReadingSessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ReadingModeDecisions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    WeeklyReviewId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SessionId = table.Column<Guid>(type: "TEXT", nullable: true),
                    CompletedSeconds = table.Column<int>(type: "INTEGER", nullable: false),
                    Qualifies = table.Column<bool>(type: "INTEGER", nullable: false),
                    IsEvidence = table.Column<bool>(type: "INTEGER", nullable: false),
                    Note = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReadingModeDecisions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ReadingModeDecisions_ReadingSessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "ReadingSessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_ReadingModeDecisions_ReadingWeeklyReviews_WeeklyReviewId",
                        column: x => x.WeeklyReviewId,
                        principalTable: "ReadingWeeklyReviews",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ReadingBookAssignments_BookId",
                table: "ReadingBookAssignments",
                column: "BookId");

            migrationBuilder.CreateIndex(
                name: "IX_ReadingBookAssignments_DefaultSlot",
                table: "ReadingBookAssignments",
                column: "DefaultSlot",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReadingBookAssignments_Mode_Status_QueueOrder",
                table: "ReadingBookAssignments",
                columns: new[] { "Mode", "Status", "QueueOrder" });

            migrationBuilder.CreateIndex(
                name: "IX_ReadingCaptures_BookId",
                table: "ReadingCaptures",
                column: "BookId");

            migrationBuilder.CreateIndex(
                name: "IX_ReadingCaptures_ExternalId",
                table: "ReadingCaptures",
                column: "ExternalId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReadingCaptures_SessionId",
                table: "ReadingCaptures",
                column: "SessionId");

            migrationBuilder.CreateIndex(
                name: "IX_ReadingCommandReceipts_ClientId_IdempotencyKey",
                table: "ReadingCommandReceipts",
                columns: new[] { "ClientId", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReadingImportReceipts_SourceFingerprint",
                table: "ReadingImportReceipts",
                column: "SourceFingerprint",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReadingModeDecisions_SessionId",
                table: "ReadingModeDecisions",
                column: "SessionId");

            migrationBuilder.CreateIndex(
                name: "IX_ReadingModeDecisions_WeeklyReviewId",
                table: "ReadingModeDecisions",
                column: "WeeklyReviewId");

            migrationBuilder.CreateIndex(
                name: "IX_ReadingNotifications_AckedAt",
                table: "ReadingNotifications",
                column: "AckedAt");

            migrationBuilder.CreateIndex(
                name: "IX_ReadingProgrammes_SingletonSlot",
                table: "ReadingProgrammes",
                column: "SingletonSlot",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReadingSessions_BookAssignmentId",
                table: "ReadingSessions",
                column: "BookAssignmentId");

            migrationBuilder.CreateIndex(
                name: "IX_ReadingSessions_BookId",
                table: "ReadingSessions",
                column: "BookId");

            migrationBuilder.CreateIndex(
                name: "IX_ReadingSessions_OpenSlot",
                table: "ReadingSessions",
                column: "OpenSlot",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReadingSessions_Status_Mode",
                table: "ReadingSessions",
                columns: new[] { "Status", "Mode" });

            migrationBuilder.CreateIndex(
                name: "IX_ReadingWeeklyReviews_WeekKey_Mode",
                table: "ReadingWeeklyReviews",
                columns: new[] { "WeekKey", "Mode" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ReadingCaptures");

            migrationBuilder.DropTable(
                name: "ReadingCommandReceipts");

            migrationBuilder.DropTable(
                name: "ReadingImportReceipts");

            migrationBuilder.DropTable(
                name: "ReadingModeDecisions");

            migrationBuilder.DropTable(
                name: "ReadingNotifications");

            migrationBuilder.DropTable(
                name: "ReadingProgrammes");

            migrationBuilder.DropTable(
                name: "ReadingSessions");

            migrationBuilder.DropTable(
                name: "ReadingWeeklyReviews");

            migrationBuilder.DropTable(
                name: "ReadingBookAssignments");
        }
    }
}
