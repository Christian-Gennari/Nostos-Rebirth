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
            if (MeasurementEnvironment.HasLiveCredential || MeasurementEnvironment.IsFake)
            {
                return null;
            }

            return "Skipped: NOSTOS_MEASUREMENT_GEMINI_API_KEY is not set and NOSTOS_MEASUREMENT_FAKE is not 1. " +
                   "See docs/cloud/ask-nostos-execution-budget-spike.md.";
        }
        set => base.Skip = value;
    }
}
