using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nostos.Backend.Migrations
{
    /// <inheritdoc />
    public partial class RefactorBookModel : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "VolumeNumber",
                table: "Books",
                newName: "Metadata_VolumeNumber"
            );

            migrationBuilder.RenameColumn(
                name: "Translator",
                table: "Books",
                newName: "Metadata_Translator"
            );

            migrationBuilder.RenameColumn(
                name: "Subtitle",
                table: "Books",
                newName: "Metadata_Subtitle"
            );

            migrationBuilder.RenameColumn(
                name: "Series",
                table: "Books",
                newName: "Metadata_Series"
            );

            migrationBuilder.RenameColumn(
                name: "Rating",
                table: "Books",
                newName: "Progress_Rating"
            );

            migrationBuilder.RenameColumn(
                name: "Publisher",
                table: "Books",
                newName: "Metadata_Publisher"
            );

            migrationBuilder.RenameColumn(
                name: "PublishedDate",
                table: "Books",
                newName: "Metadata_PublishedDate"
            );

            migrationBuilder.RenameColumn(
                name: "ProgressPercent",
                table: "Books",
                newName: "Progress_ProgressPercent"
            );

            migrationBuilder.RenameColumn(
                name: "PlaceOfPublication",
                table: "Books",
                newName: "Metadata_PlaceOfPublication"
            );

            migrationBuilder.RenameColumn(
                name: "PersonalReview",
                table: "Books",
                newName: "Progress_PersonalReview"
            );

            migrationBuilder.RenameColumn(
                name: "LastReadAt",
                table: "Books",
                newName: "Progress_LastReadAt"
            );

            migrationBuilder.RenameColumn(
                name: "LastLocation",
                table: "Books",
                newName: "Progress_LastLocation"
            );

            migrationBuilder.RenameColumn(
                name: "Language",
                table: "Books",
                newName: "Metadata_Language"
            );

            migrationBuilder.RenameColumn(
                name: "IsFavorite",
                table: "Books",
                newName: "Progress_IsFavorite"
            );

            migrationBuilder.RenameColumn(
                name: "HasFile",
                table: "Books",
                newName: "FileDetails_HasFile"
            );

            migrationBuilder.RenameColumn(
                name: "FinishedAt",
                table: "Books",
                newName: "Progress_FinishedAt"
            );

            migrationBuilder.RenameColumn(
                name: "FileName",
                table: "Books",
                newName: "FileDetails_FileName"
            );

            migrationBuilder.RenameColumn(
                name: "Editor",
                table: "Books",
                newName: "Metadata_Editor"
            );

            migrationBuilder.RenameColumn(
                name: "Edition",
                table: "Books",
                newName: "Metadata_Edition"
            );

            migrationBuilder.RenameColumn(
                name: "Description",
                table: "Books",
                newName: "Metadata_Description"
            );

            migrationBuilder.RenameColumn(
                name: "CoverFileName",
                table: "Books",
                newName: "FileDetails_CoverFileName"
            );

            migrationBuilder.RenameColumn(
                name: "ChaptersJson",
                table: "Books",
                newName: "FileDetails_ChaptersJson"
            );

            migrationBuilder.RenameColumn(
                name: "Categories",
                table: "Books",
                newName: "Metadata_Categories"
            );
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "Progress_Rating",
                table: "Books",
                newName: "Rating"
            );

            migrationBuilder.RenameColumn(
                name: "Progress_ProgressPercent",
                table: "Books",
                newName: "ProgressPercent"
            );

            migrationBuilder.RenameColumn(
                name: "Progress_PersonalReview",
                table: "Books",
                newName: "PersonalReview"
            );

            migrationBuilder.RenameColumn(
                name: "Progress_LastReadAt",
                table: "Books",
                newName: "LastReadAt"
            );

            migrationBuilder.RenameColumn(
                name: "Progress_LastLocation",
                table: "Books",
                newName: "LastLocation"
            );

            migrationBuilder.RenameColumn(
                name: "Progress_IsFavorite",
                table: "Books",
                newName: "IsFavorite"
            );

            migrationBuilder.RenameColumn(
                name: "Progress_FinishedAt",
                table: "Books",
                newName: "FinishedAt"
            );

            migrationBuilder.RenameColumn(
                name: "Metadata_VolumeNumber",
                table: "Books",
                newName: "VolumeNumber"
            );

            migrationBuilder.RenameColumn(
                name: "Metadata_Translator",
                table: "Books",
                newName: "Translator"
            );

            migrationBuilder.RenameColumn(
                name: "Metadata_Subtitle",
                table: "Books",
                newName: "Subtitle"
            );

            migrationBuilder.RenameColumn(
                name: "Metadata_Series",
                table: "Books",
                newName: "Series"
            );

            migrationBuilder.RenameColumn(
                name: "Metadata_Publisher",
                table: "Books",
                newName: "Publisher"
            );

            migrationBuilder.RenameColumn(
                name: "Metadata_PublishedDate",
                table: "Books",
                newName: "PublishedDate"
            );

            migrationBuilder.RenameColumn(
                name: "Metadata_PlaceOfPublication",
                table: "Books",
                newName: "PlaceOfPublication"
            );

            migrationBuilder.RenameColumn(
                name: "Metadata_Language",
                table: "Books",
                newName: "Language"
            );

            migrationBuilder.RenameColumn(
                name: "Metadata_Editor",
                table: "Books",
                newName: "Editor"
            );

            migrationBuilder.RenameColumn(
                name: "Metadata_Edition",
                table: "Books",
                newName: "Edition"
            );

            migrationBuilder.RenameColumn(
                name: "Metadata_Description",
                table: "Books",
                newName: "Description"
            );

            migrationBuilder.RenameColumn(
                name: "Metadata_Categories",
                table: "Books",
                newName: "Categories"
            );

            migrationBuilder.RenameColumn(
                name: "FileDetails_HasFile",
                table: "Books",
                newName: "HasFile"
            );

            migrationBuilder.RenameColumn(
                name: "FileDetails_FileName",
                table: "Books",
                newName: "FileName"
            );

            migrationBuilder.RenameColumn(
                name: "FileDetails_CoverFileName",
                table: "Books",
                newName: "CoverFileName"
            );

            migrationBuilder.RenameColumn(
                name: "FileDetails_ChaptersJson",
                table: "Books",
                newName: "ChaptersJson"
            );
        }
    }
}
