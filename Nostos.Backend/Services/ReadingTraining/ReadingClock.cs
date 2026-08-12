namespace Nostos.Backend.Services.ReadingTraining;

// Injected UTC clock. Domain decisions never call DateTime.UtcNow directly so
// tests can drive time deterministically with a mutable fake clock.
public interface IReadingClock
{
    DateTime UtcNow { get; }
}

// Production clock: the real UTC wall clock.
public sealed class SystemReadingClock : IReadingClock
{
    public DateTime UtcNow => DateTime.UtcNow;
}
