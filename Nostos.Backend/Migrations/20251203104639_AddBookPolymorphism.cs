using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nostos.Backend.Migrations
{
    /// <inheritdoc />
    public partial class AddBookPolymorphism : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Asin",
                table: "Books",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BookType",
                table: "Books",
                type: "TEXT",
                maxLength: 13,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Duration",
                table: "Books",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Edition",
                table: "Books",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PhysicalBookModel_Isbn",
                table: "Books",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PhysicalBookModel_PageCount",
                table: "Books",
                type: "INTEGER",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Asin",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "BookType",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "Duration",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "Edition",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "PhysicalBookModel_Isbn",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "PhysicalBookModel_PageCount",
                table: "Books");
        }
    }
}
