using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nostos.Backend.Cloud.Migrations.Postgres
{
    /// <inheritdoc />
    public partial class InitialCloudBaseline : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AiProviderSettings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    LlmEnabled = table.Column<bool>(type: "boolean", nullable: true),
                    LlmBaseUrl = table.Column<string>(type: "text", nullable: true),
                    LlmModel = table.Column<string>(type: "text", nullable: true),
                    LlmApiKeyEncrypted = table.Column<string>(type: "text", nullable: true),
                    SttEnabled = table.Column<bool>(type: "boolean", nullable: true),
                    SttBaseUrl = table.Column<string>(type: "text", nullable: true),
                    SttModel = table.Column<string>(type: "text", nullable: true),
                    SttApiKeyEncrypted = table.Column<string>(type: "text", nullable: true),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AiProviderSettings", x => x.Id);
                    table.CheckConstraint("CK_AiProviderSettings_SingletonId", "\"Id\" = 1");
                });

            migrationBuilder.CreateTable(
                name: "AssistantSettings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CaptureProcessingMode = table.Column<string>(type: "text", nullable: true),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AssistantSettings", x => x.Id);
                    table.CheckConstraint("CK_AssistantSettings_SingletonId", "\"Id\" = 1");
                });

            migrationBuilder.CreateTable(
                name: "BackupRecords",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SizeBytes = table.Column<long>(type: "bigint", nullable: false),
                    Provider = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    LocalArchivePath = table.Column<string>(type: "text", nullable: true),
                    ManifestJson = table.Column<string>(type: "text", nullable: true),
                    ErrorMessage = table.Column<string>(type: "text", nullable: true),
                    IncludeBookFiles = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BackupRecords", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Collections",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    ParentId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Collections", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Collections_Collections_ParentId",
                        column: x => x.ParentId,
                        principalTable: "Collections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Concepts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Concept = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Concepts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "LibraryCommandReceipts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    IdempotencyKey = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    CommandKind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ResponseJson = table.Column<string>(type: "character varying(131072)", maxLength: 131072, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LibraryCommandReceipts", x => x.Id);
                    table.CheckConstraint("CK_LibraryCommandReceipts_Bounds", "length(\"ClientId\") <= 64 AND length(\"IdempotencyKey\") <= 128 AND length(\"CommandKind\") <= 32 AND length(\"ResponseJson\") <= 131072");
                });

            migrationBuilder.CreateTable(
                name: "LibraryStates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SingletonSlot = table.Column<int>(type: "integer", nullable: false),
                    StateVersion = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LibraryStates", x => x.Id);
                    table.CheckConstraint("CK_LibraryStates_SingletonSlot", "\"SingletonSlot\" = 1");
                });

            migrationBuilder.CreateTable(
                name: "NoteCommandReceipts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    IdempotencyKey = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Command = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ResultJson = table.Column<string>(type: "character varying(131072)", maxLength: 131072, nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NoteCommandReceipts", x => x.Id);
                    table.CheckConstraint("CK_NoteCommandReceipts_Bounds", "length(\"ClientId\") <= 64 AND length(\"IdempotencyKey\") <= 128 AND length(\"Command\") <= 32 AND length(\"ResultJson\") <= 131072");
                });

            migrationBuilder.CreateTable(
                name: "Works",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Title = table.Column<string>(type: "text", nullable: false),
                    Author = table.Column<string>(type: "text", nullable: true),
                    NormalizedTitle = table.Column<string>(type: "text", nullable: false),
                    NormalizedAuthor = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Works", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Writings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Type = table.Column<int>(type: "integer", nullable: false),
                    Content = table.Column<string>(type: "text", nullable: true),
                    ParentId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Writings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Writings_Writings_ParentId",
                        column: x => x.ParentId,
                        principalTable: "Writings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Books",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    StatusMessage = table.Column<string>(type: "text", nullable: true),
                    Title = table.Column<string>(type: "text", nullable: false),
                    Author = table.Column<string>(type: "text", nullable: true),
                    Metadata_Subtitle = table.Column<string>(type: "text", nullable: true),
                    Metadata_Description = table.Column<string>(type: "text", nullable: true),
                    Metadata_Editor = table.Column<string>(type: "text", nullable: true),
                    Metadata_Translator = table.Column<string>(type: "text", nullable: true),
                    Metadata_Publisher = table.Column<string>(type: "text", nullable: true),
                    Metadata_PlaceOfPublication = table.Column<string>(type: "text", nullable: true),
                    Metadata_PublishedDate = table.Column<string>(type: "text", nullable: true),
                    Metadata_Language = table.Column<string>(type: "text", nullable: true),
                    Metadata_Categories = table.Column<string>(type: "text", nullable: true),
                    Metadata_Edition = table.Column<string>(type: "text", nullable: true),
                    Metadata_Series = table.Column<string>(type: "text", nullable: true),
                    Metadata_VolumeNumber = table.Column<string>(type: "text", nullable: true),
                    Progress_LastLocation = table.Column<string>(type: "text", nullable: true),
                    Progress_ProgressPercent = table.Column<int>(type: "integer", nullable: false),
                    Progress_Rating = table.Column<int>(type: "integer", nullable: false),
                    Progress_IsFavorite = table.Column<bool>(type: "boolean", nullable: false),
                    Progress_PersonalReview = table.Column<string>(type: "text", nullable: true),
                    Progress_LastReadAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Progress_FinishedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    FileDetails_HasFile = table.Column<bool>(type: "boolean", nullable: false),
                    FileDetails_FileName = table.Column<string>(type: "text", nullable: true),
                    FileDetails_CoverFileName = table.Column<string>(type: "text", nullable: true),
                    FileDetails_ChaptersJson = table.Column<string>(type: "text", nullable: true),
                    FileDetails_LocationsJson = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NormalizedIsbn = table.Column<string>(type: "text", nullable: true),
                    NormalizedAsin = table.Column<string>(type: "text", nullable: true),
                    WorkId = table.Column<Guid>(type: "uuid", nullable: false),
                    BookType = table.Column<string>(type: "character varying(13)", maxLength: 13, nullable: false),
                    Asin = table.Column<string>(type: "text", nullable: true),
                    Duration = table.Column<string>(type: "text", nullable: true),
                    Narrator = table.Column<string>(type: "text", nullable: true),
                    Isbn = table.Column<string>(type: "text", nullable: true),
                    PageCount = table.Column<int>(type: "integer", nullable: true),
                    PhysicalBookModel_Isbn = table.Column<string>(type: "text", nullable: true),
                    PhysicalBookModel_PageCount = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Books", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Books_Works_WorkId",
                        column: x => x.WorkId,
                        principalTable: "Works",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BookAcquisitions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BookId = table.Column<Guid>(type: "uuid", nullable: false),
                    ProviderId = table.Column<string>(type: "text", nullable: false),
                    ProviderDisplayName = table.Column<string>(type: "text", nullable: false),
                    ExternalId = table.Column<string>(type: "text", nullable: false),
                    AssetId = table.Column<string>(type: "text", nullable: false),
                    AssetFormat = table.Column<string>(type: "text", nullable: true),
                    ImportedExtension = table.Column<string>(type: "text", nullable: true),
                    SourceUrl = table.Column<string>(type: "text", nullable: true),
                    RightsStatement = table.Column<string>(type: "text", nullable: true),
                    AcquiredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BookAcquisitions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BookAcquisitions_Books_BookId",
                        column: x => x.BookId,
                        principalTable: "Books",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BookCollections",
                columns: table => new
                {
                    BookId = table.Column<Guid>(type: "uuid", nullable: false),
                    CollectionId = table.Column<Guid>(type: "uuid", nullable: false),
                    AddedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
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

            migrationBuilder.CreateTable(
                name: "Notes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Content = table.Column<string>(type: "text", nullable: false),
                    CfiRange = table.Column<string>(type: "text", nullable: true),
                    SelectedText = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    BookId = table.Column<Guid>(type: "uuid", nullable: false),
                    RawContent = table.Column<string>(type: "text", nullable: true),
                    CaptureSource = table.Column<string>(type: "text", nullable: false, defaultValue: "text"),
                    ProcessingMode = table.Column<string>(type: "text", nullable: false, defaultValue: "verbatim"),
                    SourceAnchorKind = table.Column<string>(type: "text", nullable: false, defaultValue: "unknown"),
                    SourceAnchorValue = table.Column<string>(type: "text", nullable: true),
                    AnchorVerified = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Notes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Notes_Books_BookId",
                        column: x => x.BookId,
                        principalTable: "Books",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "NoteConcepts",
                columns: table => new
                {
                    NoteId = table.Column<Guid>(type: "uuid", nullable: false),
                    ConceptId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NoteConcepts", x => new { x.NoteId, x.ConceptId });
                    table.ForeignKey(
                        name: "FK_NoteConcepts_Concepts_ConceptId",
                        column: x => x.ConceptId,
                        principalTable: "Concepts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_NoteConcepts_Notes_NoteId",
                        column: x => x.NoteId,
                        principalTable: "Notes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BookAcquisitions_BookId",
                table: "BookAcquisitions",
                column: "BookId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BookAcquisitions_ProviderId_ExternalId_AssetId",
                table: "BookAcquisitions",
                columns: new[] { "ProviderId", "ExternalId", "AssetId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BookCollections_CollectionId",
                table: "BookCollections",
                column: "CollectionId");

            migrationBuilder.CreateIndex(
                name: "IX_Books_Author",
                table: "Books",
                column: "Author");

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
                name: "IX_Books_Title",
                table: "Books",
                column: "Title");

            migrationBuilder.CreateIndex(
                name: "IX_Books_WorkId",
                table: "Books",
                column: "WorkId");

            migrationBuilder.CreateIndex(
                name: "IX_Collections_ParentId",
                table: "Collections",
                column: "ParentId");

            migrationBuilder.CreateIndex(
                name: "IX_Concepts_Concept",
                table: "Concepts",
                column: "Concept",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_LibraryCommandReceipts_ClientId_IdempotencyKey",
                table: "LibraryCommandReceipts",
                columns: new[] { "ClientId", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_LibraryCommandReceipts_CreatedAt",
                table: "LibraryCommandReceipts",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_LibraryStates_SingletonSlot",
                table: "LibraryStates",
                column: "SingletonSlot",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_NoteCommandReceipts_ClientId_IdempotencyKey",
                table: "NoteCommandReceipts",
                columns: new[] { "ClientId", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_NoteCommandReceipts_CreatedAtUtc",
                table: "NoteCommandReceipts",
                column: "CreatedAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_NoteConcepts_ConceptId",
                table: "NoteConcepts",
                column: "ConceptId");

            migrationBuilder.CreateIndex(
                name: "IX_Notes_BookId",
                table: "Notes",
                column: "BookId");

            migrationBuilder.CreateIndex(
                name: "IX_Works_NormalizedAuthor",
                table: "Works",
                column: "NormalizedAuthor");

            migrationBuilder.CreateIndex(
                name: "IX_Works_NormalizedTitle",
                table: "Works",
                column: "NormalizedTitle");

            migrationBuilder.CreateIndex(
                name: "IX_Writings_ParentId",
                table: "Writings",
                column: "ParentId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AiProviderSettings");

            migrationBuilder.DropTable(
                name: "AssistantSettings");

            migrationBuilder.DropTable(
                name: "BackupRecords");

            migrationBuilder.DropTable(
                name: "BookAcquisitions");

            migrationBuilder.DropTable(
                name: "BookCollections");

            migrationBuilder.DropTable(
                name: "LibraryCommandReceipts");

            migrationBuilder.DropTable(
                name: "LibraryStates");

            migrationBuilder.DropTable(
                name: "NoteCommandReceipts");

            migrationBuilder.DropTable(
                name: "NoteConcepts");

            migrationBuilder.DropTable(
                name: "Writings");

            migrationBuilder.DropTable(
                name: "Collections");

            migrationBuilder.DropTable(
                name: "Concepts");

            migrationBuilder.DropTable(
                name: "Notes");

            migrationBuilder.DropTable(
                name: "Books");

            migrationBuilder.DropTable(
                name: "Works");
        }
    }
}
