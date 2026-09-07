using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Configuration;
using Nostos.Backend.Data;

namespace Nostos.Backend.Services.Library;

/// <summary>
/// Result of one library receipt retention prune.
/// </summary>
public sealed record LibraryReceiptPruneResult(int ExpiredDeleted, int OverCapDeleted, int Remaining);

// Bounded retention for library command receipts (issue #51). Library-only
// by design: LibraryCommandReceipt rows are pruned here because some
// effect-idempotent after their receipt disappears. Library commands
// converge safely through normalized identities and not-found/no-op
// behavior, so one uniform age+count policy is defensible.
//
// The service owns exactly one operation and never runs inside another
// command's transaction. Age pruning uses a pure CreatedAt predicate and
// therefore can never target a receipt inserted concurrently; cap pruning
// selects/deletes the oldest IDs inside the SAME cleanup transaction. A
// concurrent command may temporarily leave the table one row above the cap
// until the next scan, which is acceptable.
public sealed class LibraryReceiptRetentionService(
    IDbContextFactory<NostosDbContext> contexts,
    LibraryReceiptRetentionOptions options,
    ILogger<LibraryReceiptRetentionService> logger)
{
    private readonly int _retentionDays = Math.Clamp(
        options.RetentionDays,
        LibraryReceiptRetentionOptions.MinRetentionDays,
        LibraryReceiptRetentionOptions.MaxRetentionDays);
    private readonly int _maximumReceipts = Math.Clamp(
        options.MaximumReceipts,
        LibraryReceiptRetentionOptions.MinMaximumReceipts,
        LibraryReceiptRetentionOptions.MaxMaximumReceipts);

    /// <summary>
    /// Prunes library command receipts: expired rows first (CreatedAt older
    /// than the retention window), then the oldest rows above the count cap.
    /// Both phases run inside one cleanup transaction and the result reports
    /// per-phase deletion counts plus the remaining row count.
    /// </summary>
    public async Task<LibraryReceiptPruneResult> PruneAsync(CancellationToken cancellationToken = default)
    {
        await using var db = await contexts.CreateDbContextAsync(cancellationToken);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        // Phase 1 — expired first. The predicate is purely age-based, so a
        // receipt inserted concurrently (or by an in-flight command) can
        // never be targeted here.
        var cutoff = DateTime.UtcNow.AddDays(-_retentionDays);
        var expiredDeleted = await db.LibraryCommandReceipts
            .Where(r => r.CreatedAt < cutoff)
            .ExecuteDeleteAsync(cancellationToken);

        // Phase 2 — oldest rows above the cap, in the same cleanup
        // transaction. The count is read after phase 1 so expired rows never
        // consume cap budget. CreatedAt then Id makes the selection
        // deterministic for receipts created in the same instant.
        var total = await db.LibraryCommandReceipts.CountAsync(cancellationToken);
        var overCap = total - _maximumReceipts;
        var overCapDeleted = 0;
        if (overCap > 0)
        {
            var oldestIds = await db.LibraryCommandReceipts
                .OrderBy(r => r.CreatedAt)
                .ThenBy(r => r.Id)
                .Take(overCap)
                .Select(r => r.Id)
                .ToListAsync(cancellationToken);

            if (oldestIds.Count > 0)
            {
                overCapDeleted = await db.LibraryCommandReceipts
                    .Where(r => oldestIds.Contains(r.Id))
                    .ExecuteDeleteAsync(cancellationToken);
            }
        }

        await transaction.CommitAsync(cancellationToken);

        var remaining = await db.LibraryCommandReceipts.CountAsync(cancellationToken);
        if (expiredDeleted > 0 || overCapDeleted > 0)
        {
            logger.LogInformation(
                "Library receipt retention pruned {Expired} expired and {OverCap} over-cap receipt(s); {Remaining} remain.",
                expiredDeleted,
                overCapDeleted,
                remaining);
        }

        return new LibraryReceiptPruneResult(expiredDeleted, overCapDeleted, remaining);
    }
}
