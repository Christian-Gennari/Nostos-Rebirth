using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nostos.Backend.Migrations
{
    /// <summary>
    /// Drops the legacy single-value <c>Books.CollectionId</c>. Membership now
    /// lives only in <c>BookCollections</c>, which is what makes a book being in
    /// more than one collection representable at all.
    ///
    /// This migration is DESTRUCTIVE, so it refuses to run if any book would lose
    /// a collection: the guard below aborts the transaction when the legacy
    /// column names a collection that has no matching membership row. Run the
    /// previous migration (<c>AddBookCollections</c>, which backfills) first.
    /// </summary>
    public partial class DropLegacyBookCollectionId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Invariant guard, before anything is dropped.
            //
            // SQLite cannot RAISE from a plain statement (RAISE is trigger-only),
            // so this uses the standard abort idiom: a table whose CHECK
            // constraint is violated exactly when the invariant is broken. The
            // INSERT...SELECT inserts nothing when there is no violation, and the
            // migration aborts with a readable error when there is.
            //
            // The check is deliberately one-directional (legacy -> membership),
            // because the reverse does not hold by design once a book has been
            // filed under several collections: CollectionId mirrors the FIRST
            // member, so extra membership rows are expected and correct.
            migrationBuilder.Sql(
                """
                CREATE TABLE "_coll_migration_guard" (
                    violation INTEGER NOT NULL CHECK (violation = 0)
                );

                INSERT INTO "_coll_migration_guard" (violation)
                SELECT 1
                WHERE EXISTS (
                    SELECT 1 FROM "Books" b
                    WHERE b."CollectionId" IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM "BookCollections" bc
                          WHERE bc."BookId" = b."Id"
                            AND bc."CollectionId" = b."CollectionId"
                      )
                );

                DROP TABLE "_coll_migration_guard";
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_Books_Collections_CollectionId",
                table: "Books");

            migrationBuilder.DropIndex(
                name: "IX_Books_CollectionId",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "CollectionId",
                table: "Books");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "CollectionId",
                table: "Books",
                type: "TEXT",
                nullable: true);

            // Re-create the index before the backfill so the UPDATE below can use
            // it. On rollback the membership rows still exist in full, so the
            // column is restored as "the first membership" rather than left null —
            // a bare AddColumn would silently lose every book's collection.
            migrationBuilder.CreateIndex(
                name: "IX_Books_CollectionId",
                table: "Books",
                column: "CollectionId");

            migrationBuilder.Sql(
                """
                UPDATE "Books"
                SET "CollectionId" = (
                    SELECT bc."CollectionId" FROM "BookCollections" bc
                    WHERE bc."BookId" = "Books"."Id"
                    ORDER BY bc."CollectionId"
                    LIMIT 1);
                """);

            migrationBuilder.AddForeignKey(
                name: "FK_Books_Collections_CollectionId",
                table: "Books",
                column: "CollectionId",
                principalTable: "Collections",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }
    }
}
