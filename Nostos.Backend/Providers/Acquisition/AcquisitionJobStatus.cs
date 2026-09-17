using System.Collections.Concurrent;
using System.Threading.Channels;
using Microsoft.Extensions.Options;

namespace Nostos.Backend.Providers.Acquisition;

public enum AcquisitionJobState
{
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

/// <summary>
/// What the UI polls while an import runs. Every field the client needs is
/// here, so progress never requires the caller to hold the acquisition open.
/// </summary>
public sealed record AcquisitionJobStatus(
    string JobId,
    AcquisitionJobState State,
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
    DateTime UpdatedAt)
{
    public bool IsFinished => State is AcquisitionJobState.Succeeded
        or AcquisitionJobState.Failed
        or AcquisitionJobState.Cancelled;
}

/// <summary>
/// Runs acquisitions in the background so a long one can report progress.
///
/// A whole audiobook — dozens of tracks plus a multi-hour encode — takes far
/// longer than any sensible HTTP request, and a synchronous endpoint could only
/// ever answer by timing out with no information. Starting a job and polling its
/// status keeps the transport bounded while the work carries on.
/// </summary>
public interface IAcquisitionJobManager
{
    /// <summary>
    /// Queues an acquisition and returns immediately. Throws when the job store
    /// is saturated rather than silently queueing unbounded work.
    /// </summary>
    AcquisitionJobStatus Start(AcquisitionRequest request);

    AcquisitionJobStatus? Get(string jobId);

    /// <summary>Cancels a queued or running job. False when there is nothing to cancel.</summary>
    bool Cancel(string jobId);
}
