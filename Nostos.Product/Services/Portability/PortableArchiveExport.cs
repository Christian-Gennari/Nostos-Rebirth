namespace Nostos.Backend.Services.Portability;

/// <summary>
/// Host seam for portable archive export.
///
/// The common endpoint owns the route and wire contract. A host may decorate
/// export with account-lifecycle semantics (for example a deletion grace
/// period) without moving or duplicating the product endpoint.
/// </summary>
public interface IPortableArchiveExporter
{
    Task<IResult> ExportAsync(HttpContext context, CancellationToken cancellationToken = default);
}

public sealed class DefaultPortableArchiveExporter(
    IPortableArchiveService portability) : IPortableArchiveExporter
{
    public async Task<IResult> ExportAsync(
        HttpContext context,
        CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        context.Response.ContentType = "application/vnd.nostos.portable+zip";
        context.Response.Headers.ContentDisposition =
            $"attachment; filename=\"nostos-export-{now:yyyyMMdd-HHmmss}.nostos\"";

        await portability.ExportAsync(context.Response.Body, cancellationToken);
        return Results.Empty;
    }
}
