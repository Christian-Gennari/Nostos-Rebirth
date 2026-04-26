using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nostos.Backend.Migrations
{
    public partial class RemoveGoogleDriveFields : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "RemoteId",
                table: "BackupRecords");

            migrationBuilder.Sql(
                "UPDATE BackupRecords SET Provider = 'Local' WHERE Provider = 'GoogleDrive'");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "RemoteId",
                table: "BackupRecords",
                type: "TEXT",
                nullable: true);
        }
    }
}