// Reading Training contracts for the Angular frontend.
//
// Mirrors Nostos.Shared/Dtos/ReadingTrainingDtos.cs + Nostos.Shared/Enums
// over the HTTP wire. ASP.NET Core's System.Text.Json emits camelCase property
// names, numeric enum values, and ISO-8601 strings for DateTime fields, so:
//   - every property below is camelCase (not the C# PascalCase name),
//   - enums are numeric literals matching the backend enum values,
//   - timestamps are `string` (non-nullable) or `string | null` (nullable),
//   - GUIDs are `string`.
//
// The stable command envelope `ReadingCommandResult<T>` wraps every mutating
// command response (`reply`, `data`, `stateVersion`, `duplicate`); the
// notification lease/ack endpoints are NOT command envelopes and use their own
// response shapes below.

// --- ENUMS (numeric, matches Nostos.Shared/Enums) ---

export enum ReadingMode {
  Endurance = 0,
  Deep = 1,
  Recovery = 2,
}

export enum ReadingConstraint {
  None = 0,
  TimeConstrained = 1,
  FatigueConstrained = 2,
}

export enum ReadingAssignmentStatus {
  Active = 0,
  Queued = 1,
  Completed = 2,
  Archived = 3,
}

export enum ReadingSessionStatus {
  Idle = 0,
  Planned = 1,
  Active = 2,
  Paused = 3,
  AwaitingFeedback = 4,
  Completed = 5,
  Cancelled = 6,
}

export enum ReadingCaptureType {
  Thought = 0,
  Question = 1,
  Bookmark = 2,
}

// --- STABLE RESPONSE ENVELOPE ---
// Every mutating command returns this semantic result, whether invoked
// through REST, MCP, or the UI. `data` is null when the command has no
// payload (e.g. status with no active session).
export interface ReadingCommandResult<T> {
  reply: string;
  data: T | null;
  stateVersion: string;
  duplicate: boolean;
}

export interface ReadingError {
  code: string;
}

/**
 * Narrowing guard for the semantic error payload the backend places in a
 * command envelope's `data` slot (`{ code }`, e.g. `not_initialized`). No
 * successful response DTO carries a `code` field, so any non-null payload
 * with a non-empty string `code` is a semantic error — even inside an
 * HTTP-200 envelope, which the transport layer cannot otherwise distinguish
 * from a successful payload.
 */
export function isReadingError(value: unknown): value is ReadingError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string' &&
    (value as { code?: unknown }).code !== ''
  );
}

// --- BASE REQUEST ---
export interface ReadingCommandRequest {
  clientId: string;
  idempotencyKey: string;
}

// Sessions' pause/resume/cancel take exactly the base command fields.
export type ReadingSessionCommandRequest = ReadingCommandRequest;

// --- SESSION COMMANDS ---
export interface ReadingPlanSessionRequest extends ReadingCommandRequest {
  bookAssignmentId: string;
  mode: ReadingMode;
  targetMinutes: number;
  constraint?: ReadingConstraint;
}

export interface ReadingStartSessionRequest extends ReadingCommandRequest {
  sessionId?: string;
}

export interface ReadingStartNewSessionRequest extends ReadingCommandRequest {
  bookAssignmentId?: string;
  mode?: ReadingMode;
}

export interface ReadingCompleteSessionRequest extends ReadingCommandRequest {
  reportedMinutes?: number;
}

export interface ReadingRateSessionRequest extends ReadingCommandRequest {
  effort: number;
  focus: number;
  rating?: number;
}

export interface ReadingSkipRatingsRequest extends ReadingCommandRequest {}

// --- BOOK ASSIGNMENT / QUEUE ---
export interface ReadingAddBookAssignmentRequest extends ReadingCommandRequest {
  bookId: string;
  mode: ReadingMode;
  makeDefault?: boolean;
}

export interface ReadingSetDefaultBookRequest extends ReadingCommandRequest {
  bookAssignmentId: string;
  mode: ReadingMode;
}

export interface ReadingCompleteBookRequest extends ReadingCommandRequest {
  bookAssignmentId: string;
}

export interface ReadingReorderQueueRequest extends ReadingCommandRequest {
  assignmentIds: string[];
}

/** PATCH /api/reading/books/{assignmentId}/mode — the assignment id lives in the URL. */
export interface ReadingChangeBookModeRequest extends ReadingCommandRequest {
  mode: ReadingMode;
}

/** DELETE /api/reading/books/{assignmentId} — the assignment id lives in the URL. */
export interface ReadingRemoveBookAssignmentRequest extends ReadingCommandRequest {}

/** Server data for a successful mode change (absorbed collider optional). */
export interface ReadingChangeBookModeData {
  assignmentId: string;
  bookId: string;
  previousMode: ReadingMode;
  mode: ReadingMode;
  queueOrder: number;
  /** The mode's default-slot sentinel when the assignment becomes the mode default, else null. */
  defaultSlot: string | null;
  collisionAbsorbed: boolean;
  absorbedAssignmentId: string | null;
}

/** Server data for a successful queue removal. */
export interface ReadingRemoveBookAssignmentData {
  assignmentId: string;
  bookId: string;
  mode: ReadingMode;
  queueOrder: number;
}

// --- CAPTURE / INBOX ---
export interface ReadingCaptureRequest extends ReadingCommandRequest {
  text: string;
  type: ReadingCaptureType;
  bookId?: string;
  sessionId?: string;
  externalId?: string;
}

export interface ReadingResolveCaptureRequest extends ReadingCommandRequest {
  keep: boolean;
  noteId?: string;
}

export interface ReadingPromoteCaptureRequest extends ReadingCommandRequest {
  noteId: string;
}

// --- WEEKLY REVIEW ---
export interface ReadingCommitWeeklyReviewRequest extends ReadingCommandRequest {
  year: number;
  week: number;
}

// --- RESPONSE DTOs ---

export interface ReadingTargets {
  enduranceTargetMinutes: number;
  deepTargetMinutes: number;
  recoveryTargetMinutes: number;
  enduranceEstablishedMinutes: number;
  deepEstablishedMinutes: number;
  recoveryEstablishedMinutes: number;
}

export interface ReadingProgramme {
  id: string;
  timezoneId: string;
  stateVersion: string;
  targets: ReadingTargets;
  deloadActive: boolean;
}

export interface ReadingBookAssignment {
  id: string;
  bookId: string;
  bookTitle: string | null;
  bookAuthor: string | null;
  mode: ReadingMode;
  status: ReadingAssignmentStatus;
  queueOrder: number;
  isDefault: boolean;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ReadingSession {
  id: string;
  bookAssignmentId: string;
  bookId: string;
  bookTitle: string | null;
  mode: ReadingMode;
  status: ReadingSessionStatus;
  targetMinutes: number;
  plannedTargetMinutes: number;
  constraint: ReadingConstraint;
  progressionEligible: boolean;
  countsAsFailure: boolean;
  accumulatedSeconds: number;
  measuredSeconds: number;
  reportedMinutes: number | null;
  effort: number;
  focus: number;
  rating: number | null;
  ratingsSkipped: boolean;
  plannedAt: string;
  startedAt: string | null;
  lastStartedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
}

export interface ReadingWeekSummary {
  weekKey: string;
  completedSessions: number;
  qualifyingSessions: number;
  volumeMinutes: number;
  completionThreshold: number;
  reviewCommitted: boolean;
}

export interface ReadingModeReview {
  mode: ReadingMode;
  targetBeforeMinutes: number;
  targetAfterMinutes: number;
  // Decision kind is a backend string, not an enum: lowercase
  // "increase" | "hold" | "deload" | "consolidate".
  decisionKind: string;
  reason: string;
  qualifyingCount: number;
  completionRate: number;
  medianEffort: number | null;
  medianFocus: number | null;
  nextConsecutiveIncreases: number;
}

export interface ReadingWeeklyReview {
  weekKey: string;
  isoYear: number;
  isoWeek: number;
  committed: boolean;
  committedAt: string | null;
  totalVolumeMinutes: number;
  previousWeekVolumeMinutes: number;
  modes: ReadingModeReview[];
  stateVersion: string;
}

export interface ReadingCapture {
  id: string;
  text: string;
  type: ReadingCaptureType;
  bookId: string;
  sessionId: string | null;
  externalId: string | null;
  resolved: boolean;
  promotedNoteId: string | null;
  createdAt: string;
}

export interface ReadingDashboard {
  programme: ReadingProgramme;
  books: ReadingBookAssignment[];
  openSession: ReadingSession | null;
  currentWeek: ReadingWeekSummary | null;
}

// --- NOTIFICATION OUTBOX (lease/ack are NOT command envelopes) ---

export interface TargetReachedNotificationPayload {
  notificationId: string;
  sessionId: string;
  bookId: string;
  mode: ReadingMode;
  plannedTargetMinutes: number;
  effectiveElapsedSeconds: number;
  message: string;
}

// One row handed to a delivery worker: the typed payload plus the lease.
export interface ReadingNotification {
  notificationId: string;
  payload: TargetReachedNotificationPayload;
  leaseUntil: string;
}

// Idempotent ack response: 200 with `{ notificationId, acknowledged: true }`.
export interface ReadingAckNotificationResult {
  notificationId: string;
  acknowledged: boolean;
}
