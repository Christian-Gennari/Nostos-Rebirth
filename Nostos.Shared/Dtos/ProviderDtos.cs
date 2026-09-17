using System;
using System.Collections.Generic;

namespace Nostos.Shared.Dtos;

// --- EXTERNAL CONTENT PROVIDERS (issue #166) ---
// The wire shape of the provider/acquisition boundary. Deliberately its own
// small vocabulary rather than a reuse of the library DTOs: these describe
// something that is NOT yet a Nostos book, and keeping them separate is what
// stops provider concepts from spreading into the library contract.
//
// No provider-specific field appears here (no GutenbergId, no LibriVoxId) — a
// provider normalizes its catalogue into exactly these shapes.

/// <summary>One selectable source in the "add from a source" surface.</summary>
public sealed record ProviderSummaryDto(
    string Id,
    string DisplayName,
    IReadOnlyList<string> Capabilities,
    /// <summary>The source's own rights wording, shown as-is. Never a Nostos claim.</summary>
    string? RightsNotice);

public sealed record ProviderAssetDto(
    string Id,
    /// <summary>"ebook" or "audiobook".</summary>
    string Kind,
    string Label,
    string? SourceFormat,
    long? SizeBytes,
    bool IsPreferred);

public sealed record ProviderItemDto(
    string ProviderId,
    string ExternalId,
    string Title,
    string? Subtitle,
    string? Author,
    string? Description,
    string? Language,
    string? Publisher,
    string? PublishedDate,
    string? Categories,
    string? Narrator,
    string? Duration,
    int? PageCount,
    IReadOnlyList<ProviderAssetDto> Assets,
    /// <summary>Nostos-relative URL that proxies the artwork, or null when the source has none.</summary>
    string? CoverUrl,
    string? SourceUrl,
    string? RightsStatement,
    /// <summary>Source parts/tracks, e.g. the number of LibriVox sections.</summary>
    int? PartCount);

public sealed record ProviderSearchResultDto(
    IReadOnlyList<ProviderItemDto> Items,
    bool HasMore,
    /// <summary>Provider-supplied note about a thin result set (e.g. a catalogue that only matches whole titles).</summary>
    string? Notice);

/// <summary>
/// Start an import. Note there is no URL field: a client names a provider, an
/// item and optionally an asset, and the server resolves the rest.
/// </summary>
public sealed record ProviderAcquireRequestDto(
    string ExternalId,
    string? AssetId = null,
    IReadOnlyList<Guid>? CollectionIds = null,
    bool IncludeCover = true);

public sealed record ProviderAcquisitionDto(
    string JobId,
    /// <summary>queued | running | succeeded | failed | cancelled</summary>
    string State,
    string Stage,
    int Percent,
    string? Detail,
    string ProviderId,
    string ExternalId,
    string? AssetId,
    Guid? BookId,
    string? ErrorCode,
    string? Message,
    DateTime CreatedAt,
    DateTime UpdatedAt);
