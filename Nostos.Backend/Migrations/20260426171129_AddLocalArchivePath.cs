using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nostos.Backend.Migrations
{
    /// <inheritdoc />
    public partial class AddLocalArchivePath : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "LocalArchivePath",
                table: "BackupRecords",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LocalArchivePath",
                table: "BackupRecords");
        }
    }
}
