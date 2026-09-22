using System.Globalization;

namespace Nostos.Backend.Tests.Measurement;

/// <summary>
/// Static accessor for measurement harness runtime environment variables and execution parameters.
/// </summary>
public static class MeasurementEnvironment
{
    private static readonly Lazy<string> CachedRepoRoot = new(ResolveRepoRoot);
    private static readonly string DefaultRunId = DateTime.UtcNow.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);

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
    public static bool HasLiveCredential => ApiKeys.Count > 0;

    /// <summary>True when running in offline fake/scripted mode.</summary>
    public static bool IsFake => Environment.GetEnvironmentVariable("NOSTOS_MEASUREMENT_FAKE") == "1";

    /// <summary>True when skipping turn execution to regenerate summaries only.</summary>
    public static bool IsSummaryOnly => Environment.GetEnvironmentVariable("NOSTOS_MEASUREMENT_SUMMARY_ONLY") == "1";

    /// <summary>Configured model identifier.</summary>
    public static string Model =>
        Environment.GetEnvironmentVariable("NOSTOS_MEASUREMENT_MODEL") is { Length: > 0 } model
            ? model
            : "gemini-3.8-flash";

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
