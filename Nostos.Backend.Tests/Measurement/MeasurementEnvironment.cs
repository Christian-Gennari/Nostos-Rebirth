using System.Globalization;

namespace Nostos.Backend.Tests.Measurement;

/// <summary>
/// Static accessor for measurement harness runtime environment variables and execution parameters.
/// </summary>
public static class MeasurementEnvironment
{
    private static readonly Lazy<string> CachedRepoRoot = new(ResolveRepoRoot);
    private static readonly string DefaultRunId = DateTime.UtcNow.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);

    /// <summary>
    /// True when a live run was explicitly requested. A credential alone is
    /// deliberately NOT enough: without this flag an ordinary test run on a machine
    /// that happens to have a Google key in its environment would spend real money.
    /// </summary>
    public static bool IsLiveRunEnabled =>
        Environment.GetEnvironmentVariable("NOSTOS_MEASUREMENT_ENABLED") == "1";

    /// <summary>True when the harness may call the live provider.</summary>
    public static bool IsLiveRun => !IsFake && HasLiveCredential && IsLiveRunEnabled;

    /// <summary>Configured Gemini API key(s). Never logged or written to disk.</summary>
    public static IReadOnlyList<string> ApiKeys
    {
        get
        {
            var raw = Environment.GetEnvironmentVariable("NOSTOS_MEASUREMENT_GEMINI_API_KEY");
            if (string.IsNullOrWhiteSpace(raw))
            {
                return [];
            }

            return raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Where(key => !string.IsNullOrEmpty(key))
                .ToList();
        }
    }

    /// <summary>True when at least one Gemini API key is configured.</summary>
    public static bool HasLiveCredential =>
        IsNineRouterTransport ? !string.IsNullOrWhiteSpace(NineRouterApiKey) : ApiKeys.Count > 0;

    /// <summary>
    /// Live transport for the measurement: <c>gemini</c> calls the Google AI Studio API
    /// directly, <c>9router</c> goes through the OpenAI-compatible gateway the app itself
    /// talks to today (the production <c>NineRouterLlmProvider</c>). Both serve
    /// gemini-3.8-flash at thinking level low; the gateway adds a constant preamble to
    /// every call, which <see cref="PreambleOffsetTokens"/> records.
    /// </summary>
    public static string LiveTransport =>
        Environment.GetEnvironmentVariable("NOSTOS_MEASUREMENT_PROVIDER") is { Length: > 0 } transport
            ? transport.Trim().ToLowerInvariant()
            : "gemini";

    /// <summary>True when the live transport is the 9Router gateway.</summary>
    public static bool IsNineRouterTransport => LiveTransport is "9router" or "ninerouter";

    /// <summary>9Router base URL for a gateway run (the app's own default is the same route).</summary>
    public static string NineRouterBaseUrl =>
        Environment.GetEnvironmentVariable("NOSTOS_MEASUREMENT_NINE_ROUTER_BASE_URL") is { Length: > 0 } url
            ? url
            : "http://localhost:20128/v1";

    /// <summary>9Router model id: the Antigravity Gemini 3.8 Flash route pinned to thinking level low.</summary>
    public static string NineRouterModel =>
        Environment.GetEnvironmentVariable("NOSTOS_MEASUREMENT_NINE_ROUTER_MODEL") is { Length: > 0 } model
            ? model
            : "ag/gemini-3.8-flash-low";

    /// <summary>9Router API key. Never logged or written to disk.</summary>
    public static string NineRouterApiKey =>
        Environment.GetEnvironmentVariable("NOSTOS_MEASUREMENT_NINE_ROUTER_KEY") ?? string.Empty;

    /// <summary>
    /// Measured constant token overhead the gateway adds to every upstream call
    /// (0 when measuring the direct API). Recorded rows stay raw; summaries and the
    /// spike document subtract it to state the direct-API equivalent.
    /// </summary>
    public static int PreambleOffsetTokens =>
        int.TryParse(Environment.GetEnvironmentVariable("NOSTOS_MEASUREMENT_PREAMBLE_OFFSET"), out var offset) && offset > 0
            ? offset
            : 0;

    /// <summary>True when running in offline fake/scripted mode.</summary>
    public static bool IsFake => Environment.GetEnvironmentVariable("NOSTOS_MEASUREMENT_FAKE") == "1";

    /// <summary>True when skipping turn execution to regenerate summaries only.</summary>
    public static bool IsSummaryOnly => Environment.GetEnvironmentVariable("NOSTOS_MEASUREMENT_SUMMARY_ONLY") == "1";

    /// <summary>Configured model identifier.</summary>
    public static string Model =>
        Environment.GetEnvironmentVariable("NOSTOS_MEASUREMENT_MODEL") is { Length: > 0 } model
            ? model
            : "gemini-3.8-flash";

    /// <summary>The model id this run's transport actually serves (the gateway route, or the direct API id).</summary>
    public static string EffectiveModel => IsNineRouterTransport ? NineRouterModel : Model;

    /// <summary>Configured thinking level.</summary>
    public static string ThinkingLevel =>
        Environment.GetEnvironmentVariable("NOSTOS_MEASUREMENT_THINKING_LEVEL") is { Length: > 0 } level
            ? level
            : "low";

    /// <summary>Configured repetitions per scenario.</summary>
    public static int Repetitions =>
        int.TryParse(Environment.GetEnvironmentVariable("NOSTOS_MEASUREMENT_REPS"), out var reps) && reps > 0
            ? reps
            : 20;

    /// <summary>Configured 1-based scenario numbers to run.</summary>
    public static IReadOnlyList<int> ScenarioSelection
    {
        get
        {
            var raw = Environment.GetEnvironmentVariable("NOSTOS_MEASUREMENT_SCENARIOS");
            if (string.IsNullOrWhiteSpace(raw))
            {
                return [1, 2, 3, 4, 5, 6, 7, 8, 9];
            }

            return raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(int.Parse)
                .ToList();
        }
    }

    /// <summary>Run identifier used for directory naming.</summary>
    public static string RunId =>
        Environment.GetEnvironmentVariable("NOSTOS_MEASUREMENT_RUN_ID") is { Length: > 0 } runId
            ? runId
            : DefaultRunId;

    /// <summary>Output root directory.</summary>
    public static string OutputRoot =>
        Environment.GetEnvironmentVariable("NOSTOS_MEASUREMENT_OUT") is { Length: > 0 } outDir
            ? outDir
            : Path.Combine(CachedRepoRoot.Value, "measurement-out");

    /// <summary>Specific run directory.</summary>
    public static string RunDirectory => Path.Combine(OutputRoot, RunId);

    /// <summary>Max attempts per turn when the provider fails.</summary>
    public static int MaxAttempts =>
        int.TryParse(Environment.GetEnvironmentVariable("NOSTOS_MEASUREMENT_MAX_ATTEMPTS"), out var attempts) && attempts > 0
            ? attempts
            : 3;

    private static string ResolveRepoRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current != null)
        {
            if (File.Exists(Path.Combine(current.FullName, "Nostos.sln")))
            {
                return current.FullName;
            }

            current = current.Parent;
        }

        throw new InvalidOperationException("Could not locate repository root containing Nostos.sln.");
    }
}
