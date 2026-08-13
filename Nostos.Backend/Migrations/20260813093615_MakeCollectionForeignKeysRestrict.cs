using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nostos.Backend.Migrations
{
    /// <inheritdoc />
    public partial class MakeCollectionForeignKeysRestrict : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Books_Collections_CollectionId",
                table: "Books");

            migrationBuilder.DropForeignKey(
                name: "FK_Collections_Collections_ParentId",
                table: "Collections");

            migrationBuilder.AddForeignKey(
                name: "FK_Books_Collections_CollectionId",
                table: "Books",
                column: "CollectionId",
                principalTable: "Collections",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Collections_Collections_ParentId",
                table: "Collections",
                column: "ParentId",
                principalTable: "Collections",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Books_Collections_CollectionId",
                table: "Books");

            migrationBuilder.DropForeignKey(
                name: "FK_Collections_Collections_ParentId",
                table: "Collections");

            migrationBuilder.AddForeignKey(
                name: "FK_Books_Collections_CollectionId",
                table: "Books",
                column: "CollectionId",
                principalTable: "Collections",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_Collections_Collections_ParentId",
                table: "Collections",
                column: "ParentId",
                principalTable: "Collections",
                principalColumn: "Id");
        }
    }
}
