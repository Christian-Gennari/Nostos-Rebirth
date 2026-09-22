using Xunit;

namespace Nostos.Backend.Tests.Measurement;

/// <summary>
/// Fact attribute for measurement runs. Skips tests unless a live Gemini API key is configured
/// via NOSTOS_MEASUREMENT_GEMINI_API_KEY or offline fake mode is active (NOSTOS_MEASUREMENT_FAKE=1).
/// </summary>
public sealed class MeasurementFactAttribute : FactAttribute
{
    public override string? Skip
    {
        get
        {
            if (MeasurementEnvironment.IsFake || MeasurementEnvironment.IsLiveRun)
            {
                return null;
            }

            return "Skipped: set NOSTOS_MEASUREMENT_FAKE=1 for offline mode, or "
                 + "NOSTOS_MEASUREMENT_GEMINI_API_KEY plus NOSTOS_MEASUREMENT_ENABLED=1 for a live run "
                 + "(the explicit flag keeps an accidental run from spending provider money). "
                 + "See docs/cloud/ask-nostos-execution-budget-spike.md.";
        }
        set => base.Skip = value;
    }
}
