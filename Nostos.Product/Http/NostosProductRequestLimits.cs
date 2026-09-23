namespace Nostos.Product.Http;

/// <summary>
/// Product-level request limits that protect parsing/storage work regardless of
/// which host applies additional abuse/rate-limit policy around the endpoint.
/// </summary>
public static class NostosProductRequestLimits
{
    public const long MaxCoverUploadBytes = 25L * 1024 * 1024;
    public const long MaxCoverRequestBytes = 26L * 1024 * 1024;
}
