namespace Nostos.Backend.Providers.Acquisition;

/// <summary>
/// Host boundary for acquisition scratch placement.
///
/// Product acquisition needs a writable working directory, but must not know
/// whether durable book storage is a local filesystem, object storage, or
/// another host adapter. SelfHosted can keep staging beside its books volume;
/// hosted composition can use bounded instance-local scratch.
/// </summary>
public interface IAcquisitionWorkingRootProvider
{
    string ResolveWorkingRoot(string contentRootPath, AcquisitionOptions options);
}

/// <summary>
/// Provider-neutral fallback used by hosts without a local books filesystem.
/// </summary>
public sealed class DefaultAcquisitionWorkingRootProvider : IAcquisitionWorkingRootProvider
{
    public string ResolveWorkingRoot(string contentRootPath, AcquisitionOptions options) =>
        AcquisitionOptions.ResolveWorkingRoot(
            contentRootPath,
            localBooksRoot: null,
            options);
}
