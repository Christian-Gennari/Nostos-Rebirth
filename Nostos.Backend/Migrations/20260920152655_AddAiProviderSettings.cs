using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nostos.Backend.Migrations
{
    /// <inheritdoc />
    public partial class AddAiProviderSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AiProviderSettings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    LlmEnabled = table.Column<bool>(type: "INTEGER", nullable: true),
                    LlmBaseUrl = table.Column<string>(type: "TEXT", nullable: true),
                    LlmModel = table.Column<string>(type: "TEXT", nullable: true),
                    LlmApiKeyEncrypted = table.Column<string>(type: "TEXT", nullable: true),
                    SttEnabled = table.Column<bool>(type: "INTEGER", nullable: true),
                    SttBaseUrl = table.Column<string>(type: "TEXT", nullable: true),
                    SttModel = table.Column<string>(type: "TEXT", nullable: true),
                    SttApiKeyEncrypted = table.Column<string>(type: "TEXT", nullable: true),
                    UpdatedAtUtc = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AiProviderSettings", x => x.Id);
                    table.CheckConstraint("CK_AiProviderSettings_SingletonId", "Id = 1");
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AiProviderSettings");
        }
    }
}
