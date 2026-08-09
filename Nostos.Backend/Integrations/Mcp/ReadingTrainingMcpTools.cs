using System.ComponentModel;
using ModelContextProtocol.Server;
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Integrations.Mcp;

/// <summary>
/// Read-only Reading Training tools (Task 9B1). Every tool forwards to the
/// deterministic <see cref="IReadingTrainingService"/>, which is the sole
/// authority for the SQLite-backed reading state: no EF context, filesystem,
/// or Hermes runtime is touched here, and no tool mutates state. Sub-envelope
/// tools (week, books) extract their payload verbatim from the server's
/// dashboard envelope, preserving reply/stateVersion/error semantics exactly;
/// they never recompute policy or infer client-side.
/// </summary>
[McpServerToolType]
public sealed class ReadingTrainingMcpTools
{
    private readonly IReadingTrainingService _service;

    public ReadingTrainingMcpTools(IReadingTrainingService service)
    {
        _service = service;
    }

    [McpServerTool(Name = "reading_get_dashboard", ReadOnly = true)]
    [Description("Gets the full Reading Training dashboard from the server: programme targets, book queue, open session, and current-week summary.")]
    public Task<ReadingCommandResultDto> GetDashboardAsync(CancellationToken ct) =>
        _service.GetDashboardAsync(ct);

    [McpServerTool(Name = "reading_get_status", ReadOnly = true)]
    [Description("Gets the current Reading Training session status from the server (open session, or none).")]
    public Task<ReadingCommandResultDto> GetStatusAsync(CancellationToken ct) =>
        _service.GetStatusAsync(ct);

    [McpServerTool(Name = "reading_get_week", ReadOnly = true)]
    [Description("Gets the server-authoritative summary of the current ISO week from the Reading Training dashboard.")]
    public async Task<ReadingCommandResultDto> GetCurrentWeekAsync(CancellationToken ct)
    {
        var dashboard = await _service.GetDashboardAsync(ct);
        return dashboard.Data is ReadingDashboardDto dto
            ? dashboard with { Data = dto.CurrentWeek }
            : dashboard;
    }

    [McpServerTool(Name = "reading_list_history", ReadOnly = true)]
    [Description("Lists completed and cancelled Reading Training sessions from the server.")]
    public Task<ReadingCommandResultDto> ListHistoryAsync(CancellationToken ct) =>
        _service.GetHistoryAsync(ct);

    [McpServerTool(Name = "reading_list_books", ReadOnly = true)]
    [Description("Lists the server-authoritative Reading Training book queue from the dashboard.")]
    public async Task<ReadingCommandResultDto> ListBooksAsync(CancellationToken ct)
    {
        var dashboard = await _service.GetDashboardAsync(ct);
        return dashboard.Data is ReadingDashboardDto dto
            ? dashboard with { Data = dto.Books }
            : dashboard;
    }

    [McpServerTool(Name = "reading_list_inbox", ReadOnly = true)]
    [Description("Lists unresolved Reading Training inbox captures from the server.")]
    public Task<ReadingCommandResultDto> ListInboxAsync(CancellationToken ct) =>
        _service.ListInboxAsync(ct);

    [McpServerTool(Name = "reading_preview_review", ReadOnly = true)]
    [Description("Previews the weekly review for the given ISO year and week without committing it.")]
    public Task<ReadingCommandResultDto> PreviewWeeklyReviewAsync(
        [Description("ISO-8601 week-numbering year of the week to preview.")] int year,
        [Description("ISO-8601 week number of the year (1-53).")] int week,
        CancellationToken ct) =>
        _service.PreviewWeeklyReviewAsync(new ReadingWeeklyReviewRequest(year, week), ct);
}
