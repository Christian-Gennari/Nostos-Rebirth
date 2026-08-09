using System;
using System.Collections.Generic;
using Nostos.Shared.Enums;

namespace Nostos.Shared.Dtos;

// --- STABLE RESPONSE ENVELOPE ---
// Every mutating command accepts a client id and idempotency key and returns
// this same semantic result, whether invoked through REST, MCP, or the UI.
public sealed record ReadingCommandResultDto(
    string Reply,
    object? Data,
    string StateVersion,
    bool Duplicate = false
);

// --- BASE REQUEST ---
public record ReadingCommandRequest(string ClientId, string IdempotencyKey);

// --- PRESCRIPTION / PLAN ---
public record ReadingPlanSessionRequest(
    string ClientId,
    string IdempotencyKey,
    Guid BookAssignmentId,
    ReadingMode Mode,
    int TargetMinutes,
    ReadingConstraint Constraint = ReadingConstraint.None
);

public record ReadingPrescriptionRequest(
    string ClientId,
    string IdempotencyKey,
    Guid? BookAssignmentId,
    ReadingMode? Mode,
    int? AvailableMinutes,
    ReadingConstraint Constraint = ReadingConstraint.None
);

// --- SESSION COMMANDS ---
public record ReadingStartSessionRequest(
    string ClientId,
    string IdempotencyKey,
    Guid? SessionId = null
);

public record ReadingStartNewSessionRequest(
    string ClientId,
    string IdempotencyKey,
    Guid? BookAssignmentId = null,
    ReadingMode? Mode = null
);

public record ReadingSessionCommandRequest(string ClientId, string IdempotencyKey);

public record ReadingCompleteSessionRequest(
    string ClientId,
    string IdempotencyKey,
    int? ReportedMinutes = null
);

public record ReadingRateSessionRequest(
    string ClientId,
    string IdempotencyKey,
    int Effort,
    int Focus,
    int? Rating = null
);

public record ReadingSkipRatingsRequest(string ClientId, string IdempotencyKey);

// --- BOOK ASSIGNMENT / QUEUE ---
public record ReadingAddBookAssignmentRequest(
    string ClientId,
    string IdempotencyKey,
    Guid BookId,
    ReadingMode Mode,
    bool MakeDefault = false
);

public record ReadingSetDefaultBookRequest(
    string ClientId,
    string IdempotencyKey,
    Guid BookAssignmentId,
    ReadingMode Mode
);

public record ReadingCompleteBookRequest(
    string ClientId,
    string IdempotencyKey,
    Guid BookAssignmentId
);

public record ReadingReorderQueueRequest(
    string ClientId,
    string IdempotencyKey,
    IReadOnlyList<Guid> AssignmentIds
);

// --- CAPTURE / INBOX ---
public record ReadingCaptureRequest(
    string ClientId,
    string IdempotencyKey,
    string Text,
    ReadingCaptureType Type,
    Guid? BookId = null,
    Guid? SessionId = null,
    string? ExternalId = null
);

public record ReadingResolveCaptureRequest(
    string ClientId,
    string IdempotencyKey,
    bool Keep,
    Guid? NoteId = null
);

public record ReadingPromoteCaptureRequest(
    string ClientId,
    string IdempotencyKey,
    Guid NoteId
);

// --- WEEKLY REVIEW ---
public record ReadingCommitWeeklyReviewRequest(
    string ClientId,
    string IdempotencyKey,
    string? WeekKey = null
);

// --- NOTIFICATION OUTBOX ---
public record ReadingAckNotificationRequest(string ClientId, string IdempotencyKey);

// --- GATEWAY (Hermes/Telegram connector) ---
public record ReadingGatewayDispatchRequest(string ClientId, string IdempotencyKey, string Text);

// --- IMPORT (Hermes data cutover) ---
public record ReadingImportDryRunRequest(
    string ClientId,
    string IdempotencyKey,
    IReadOnlyDictionary<string, string> Files
);

public record ReadingImportRequest(
    string ClientId,
    string IdempotencyKey,
    IReadOnlyDictionary<string, string> Files,
    bool CreateMissingBooks = false
);

// --- RESPONSE DTOs ---

public record ReadingTargetsDto(
    int EnduranceTargetMinutes,
    int DeepTargetMinutes,
    int RecoveryTargetMinutes,
    int EnduranceEstablishedMinutes,
    int DeepEstablishedMinutes,
    int RecoveryEstablishedMinutes
);

public record ReadingProgrammeDto(
    Guid Id,
    string TimezoneId,
    string StateVersion,
    ReadingTargetsDto Targets,
    bool DeloadActive
);

public record ReadingBookAssignmentDto(
    Guid Id,
    Guid BookId,
    string? BookTitle,
    string? BookAuthor,
    ReadingMode Mode,
    ReadingAssignmentStatus Status,
    int QueueOrder,
    bool IsDefault,
    DateTime CreatedAt,
    DateTime? StartedAt,
    DateTime? CompletedAt
);

public record ReadingSessionDto(
    Guid Id,
    Guid BookAssignmentId,
    Guid BookId,
    string? BookTitle,
    ReadingMode Mode,
    ReadingSessionStatus Status,
    int TargetMinutes,
    ReadingConstraint Constraint,
    int AccumulatedSeconds,
    int MeasuredSeconds,
    int? ReportedMinutes,
    int Effort,
    int Focus,
    int? Rating,
    bool RatingsSkipped,
    DateTime PlannedAt,
    DateTime? StartedAt,
    DateTime? PausedAt,
    DateTime? CompletedAt
);

public record ReadingWeekSummaryDto(
    string WeekKey,
    int CompletedSessions,
    int QualifyingSessions,
    int CompletionThreshold,
    bool ReviewCommitted
);

public record ReadingReviewDecisionDto(
    string WeekKey,
    ReadingMode Mode,
    int TargetBeforeMinutes,
    int TargetAfterMinutes,
    string DecisionKind,
    string Reason
);

public record ReadingCaptureDto(
    Guid Id,
    string Text,
    ReadingCaptureType Type,
    Guid BookId,
    Guid? SessionId,
    string? ExternalId,
    bool Resolved,
    Guid? PromotedNoteId,
    DateTime CreatedAt
);

public record ReadingNotificationDto(
    Guid Id,
    string Kind,
    string PayloadJson,
    DateTime CreatedAt,
    DateTime? LeaseUntil,
    DateTime? AckedAt
);

public record ReadingImportReceiptDto(
    Guid Id,
    string SourceFingerprint,
    string ResultJson,
    DateTime CreatedAt
);

public record ReadingDashboardDto(
    ReadingProgrammeDto Programme,
    IReadOnlyList<ReadingBookAssignmentDto> Books,
    ReadingSessionDto? OpenSession,
    ReadingWeekSummaryDto? CurrentWeek
);
