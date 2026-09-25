using Nostos.Backend.Providers.Contracts;

namespace Nostos.Backend.Providers.Discovery;

/// <summary>One source's contribution to an aggregate discovery request.</summary>
public sealed record ProviderDiscoverySourceStatus(
    string ProviderId,
    string DisplayName,
    bool Succeeded,
    string? Notice = null,
    string? ErrorCode = null);

/// <summary>Provider-neutral result of searching every eligible source.</summary>
public sealed record ProviderDiscoveryResult(
    IReadOnlyList<ProviderItem> Items,
    bool HasMore,
    IReadOnlyList<ProviderDiscoverySourceStatus> Sources);

/// <summary>
/// Searches provider capabilities rather than provider identities, then combines
/// each source's own ranked results without inventing a cross-provider score.
/// </summary>
public sealed class ProviderDiscoveryService
{
    private readonly IProviderRegistry _registry;
    private readonly ILogger<ProviderDiscoveryService> _logger;

    public ProviderDiscoveryService(
        IProviderRegistry registry,
        ILogger<ProviderDiscoveryService> logger)
    {
        _registry = registry;
        _logger = logger;
    }

    public async Task<ProviderDiscoveryResult> SearchAsync(
        string query,
        ProviderMediaKind? kind,
        int limit,
        CancellationToken ct)
    {
        var eligible = _registry.All
            .Where(registration => IsEligible(registration, kind))
            .OrderBy(registration => registration.Id, StringComparer.Ordinal)
            .ToList();

        var tasks = eligible
            .Select(registration => SearchOneAsync(registration, query, kind, limit, ct))
            .ToArray();

        var results = await Task.WhenAll(tasks);

        var successfulPages = results
            .Where(result => result.Page is not null)
            .Select(result => result.Page!)
            .ToList();

        var candidateCount = successfulPages.Sum(page => page.Items.Count);
        var merged = RoundRobin(successfulPages.Select(page => page.Items).ToList(), limit);

        return new ProviderDiscoveryResult(
            Items: merged,
            HasMore: results.Any(result => result.Page?.HasMore == true) || candidateCount > merged.Count,
            Sources: results.Select(result => result.Status).ToList());
    }

    private async Task<SearchOutcome> SearchOneAsync(
        ProviderRegistration registration,
        string query,
        ProviderMediaKind? kind,
        int limit,
        CancellationToken ct)
    {
        try
        {
            var page = await registration.Search!.SearchAsync(
                new ProviderSearchQuery(query, limit, Offset: 0, Kind: kind),
                ct);

            return new SearchOutcome(
                page,
                new ProviderDiscoverySourceStatus(
                    registration.Id,
                    registration.Provider.DisplayName,
                    Succeeded: true,
                    Notice: page.Notice));
        }
        catch (OperationCanceledException)
        {
            // Cancellation is a request-level control signal, never a provider
            // failure to hide inside an otherwise successful response.
            throw;
        }
        catch (ProviderException ex)
        {
            return new SearchOutcome(
                null,
                new ProviderDiscoverySourceStatus(
                    registration.Id,
                    registration.Provider.DisplayName,
                    Succeeded: false,
                    ErrorCode: ex.Code));
        }
        catch (Exception ex)
        {
            _logger.LogError(
                ex,
                "Unexpected provider discovery failure for {ProviderId}",
                registration.Id);

            return new SearchOutcome(
                null,
                new ProviderDiscoverySourceStatus(
                    registration.Id,
                    registration.Provider.DisplayName,
                    Succeeded: false,
                    ErrorCode: "provider_search_failed"));
        }
    }

    private static bool IsEligible(
        ProviderRegistration registration,
        ProviderMediaKind? kind)
    {
        var capabilities = registration.Provider.Capabilities;
        if (registration.Search is null || !capabilities.HasFlag(ProviderCapabilities.Search))
            return false;

        return kind switch
        {
            ProviderMediaKind.Ebook =>
                capabilities.HasFlag(ProviderCapabilities.EbookAcquisition),
            ProviderMediaKind.Audiobook =>
                capabilities.HasFlag(ProviderCapabilities.AudiobookAcquisition),
            null =>
                capabilities.HasFlag(ProviderCapabilities.EbookAcquisition)
                || capabilities.HasFlag(ProviderCapabilities.AudiobookAcquisition),
            _ => false,
        };
    }

    private static IReadOnlyList<ProviderItem> RoundRobin(
        IReadOnlyList<IReadOnlyList<ProviderItem>> sources,
        int limit)
    {
        var merged = new List<ProviderItem>(limit);
        var index = 0;

        while (merged.Count < limit)
        {
            var added = false;

            foreach (var items in sources)
            {
                if (index >= items.Count)
                    continue;

                merged.Add(items[index]);
                added = true;

                if (merged.Count == limit)
                    break;
            }

            if (!added)
                break;

            index++;
        }

        return merged;
    }

    private sealed record SearchOutcome(
        ProviderSearchPage? Page,
        ProviderDiscoverySourceStatus Status);
}
