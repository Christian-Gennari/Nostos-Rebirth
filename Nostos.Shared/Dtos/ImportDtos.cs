using System;
using System.Collections.Generic;

namespace Nostos.Shared.Dtos;

// --- BACKGROUND IMPORT PROGRESS (issue #189) ---
// A dedicated feed for work in flight, deliberately NOT the library query.
// The library answers "what do I own, sorted and filtered how I asked"; this
// answers "what is being imported right now", which must be visible no matter
// how the library is currently sorted or filtered — an import is not a search
// result and must not disappear because the user filtered to Favourites.
//
// Its own vocabulary rather than a reuse of ProviderAcquisitionDto, because an
// entry here can be either a live job OR a book row whose import a server
// restart interrupted (see the reconciliation worker). The former has no book
// yet in the general case; the latter has no job at all.

/// <summary>
/// One row of the "Imports in Progress" surface. Identified by <see cref="Id"/>,
/// which is the acquisition job id for a live job and the book id for an entry
/// recovered from a previous process's interrupted import.
/// </summary>
public sealed record ImportActivityDto(
    /// <summary>Stable id for this entry: the job id, or the book id when reconciled.</summary>
    string Id,
    /// <summary>"job" (a job in this process) or "reconciled" (an interrupted import).</summary>
    string Source,
    /// <summary>queued | running | succeeded | failed | cancelled</summary>
    string State,
    /// <summary>resolving | downloading | transcoding | importing | done | failed …</summary>
    string Stage,
    /// <summary>
    /// 0-100, already capped at 99 unless the state is terminal Succeeded. The
    /// cap is applied server-side so no client can read "100%" and offer a file
    /// that has not landed yet.
    /// </summary>
    int Percent,
    string? Detail,
    string? ProviderId,
    string? ExternalId,
    string? AssetId,
    Guid? BookId,
    /// <summary>The book row's title, from the moment the user confirmed the import.</summary>
    string? Title,
    string? Author,
    /// <summary>Nostos-relative cover URL for the book row, or null when it has none yet.</summary>
    string? CoverUrl,
    string? ErrorCode,
    string? Message,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    /// <summary>False when the source cannot be re-imported from this entry (no provider/external id).</summary>
    bool CanRetry);
