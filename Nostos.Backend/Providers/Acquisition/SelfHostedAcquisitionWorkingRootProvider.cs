using Nostos.Backend.Services;

namespace Nostos.Backend.Providers.Acquisition;

/// <summary>
/// SelfHosted keeps large acquisition staging beside the local books volume so
/// final adoption is normally a same-volume rename rather than a second copy.
/// </summary>
public sealed class SelfHostedAcquisitionWorkingRootProvider(
    IFileStorageService storage) : IAcquisitionWorkingRootProvider
{
    public string ResolveWorkingRoot(string contentRootPath, AcquisitionOptions options) =>
        AcquisitionOptions.ResolveWorkingRoot(
            contentRootPath,
            storage.StorageRoot,
            options);
}
