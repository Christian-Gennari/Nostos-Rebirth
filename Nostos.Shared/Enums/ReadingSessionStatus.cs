namespace Nostos.Shared.Enums;

public enum ReadingSessionStatus
{
    Idle = 0,
    Planned = 1,
    Active = 2,
    Paused = 3,
    AwaitingFeedback = 4,
    Completed = 5,
    Cancelled = 6,
}
