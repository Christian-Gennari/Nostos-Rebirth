import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import {
  EMPTY,
  Observable,
  Subscription,
  catchError,
  defaultIfEmpty,
  defer,
  filter,
  finalize,
  interval,
  map,
  switchMap,
  take,
  tap,
  throwError,
} from 'rxjs';

import {
  ReadingAddBookAssignmentRequest,
  ReadingAssignmentStatus,
  ReadingBookAssignment,
  ReadingCapture,
  ReadingCaptureRequest,
  ReadingCommandRequest,
  ReadingCommandResult,
  ReadingCommitWeeklyReviewRequest,
  ReadingCompleteBookRequest,
  ReadingCompleteSessionRequest,
  ReadingDashboard,
  ReadingMode,
  ReadingPlanSessionRequest,
  ReadingProgramme,
  ReadingPromoteCaptureRequest,
  ReadingRateSessionRequest,
  ReadingReorderQueueRequest,
  ReadingResolveCaptureRequest,
  ReadingSession,
  ReadingSessionCommandRequest,
  ReadingSessionStatus,
  ReadingSetDefaultBookRequest,
  ReadingSkipRatingsRequest,
  ReadingStartNewSessionRequest,
  ReadingStartSessionRequest,
  ReadingWeekSummary,
  ReadingWeeklyReview,
} from '../core/dtos/reading-training.dtos';
import { ReadingTrainingService } from '../core/services/reading-training.service';

/** Authoritative dashboard refresh cadence while connected. */
const REFRESH_INTERVAL_MS = 30_000;
/** Display-clock cadence; drives the local ticking of `displayedElapsedSeconds`. */
const CLOCK_TICK_MS = 1_000;

/**
 * Command error raised deterministically when a mutation is attempted while
 * another mutation (command + its authoritative refresh) is still in flight.
 */
const MUTATION_IN_PROGRESS = 'mutation_in_progress';

/**
 * Authoritative Angular signal store for Reading Training.
 *
 * The server owns all domain state; this store renders the latest dashboard
 * snapshot and issues commands verbatim:
 *  - every command forwards the caller-supplied typed request unchanged (the
 *    caller owns `clientId`/`idempotencyKey` — this store never generates
 *    them), records the backend reply, and refreshes the dashboard from the
 *    server after the command succeeds;
 *  - it never applies optimistic updates, never infers transitions, and never
 *    retries commands;
 *  - commands are serialized one at a time; a concurrent command fails
 *    deterministically with `mutation_in_progress`;
 *  - overlapping dashboard refreshes converge via a monotonic sequence, so an
 *    older in-flight response can never overwrite a newer one.
 *
 * `displayedElapsedSeconds` is display-only: it is anchored to the server's
 * `openSession.measuredSeconds` at every dashboard response and only ticks
 * locally while the session is Active and the store is connected. It is never
 * sent to the server and never used as evidence.
 */
@Injectable({ providedIn: 'root' })
export class ReadingTrainingStore {
  private readonly service = inject(ReadingTrainingService);
  private readonly destroyRef = inject(DestroyRef);

  // --- private writable state (exposed read-only below) ---

  private readonly dashboardState = signal<ReadingDashboard | null>(null);
  private readonly loadingState = signal(false);
  private readonly mutatingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private readonly lastReplyState = signal<string | null>(null);
  private readonly connectedState = signal(false);

  /** Authoritative server inbox (unresolved Question/Bookmark captures). */
  private readonly inboxState = signal<ReadingCapture[]>([]);
  /** Authoritative server session history, newest-first per the backend. */
  private readonly historyState = signal<ReadingSession[]>([]);

  /** Display-only anchor: server `measuredSeconds` at the last dashboard response. */
  private readonly displayAnchor = signal<{ measuredSeconds: number; clientTime: number } | null>(null);

  /** Incremented once per second while connected; invalidates the display computed. */
  private readonly clockTick = signal(0);

  /** Monotonic refresh sequence: stale responses (older than the latest issued refresh) are dropped. */
  private refreshSeq = 0;

  /** Monotonic inbox fetch sequence: stale responses are dropped per resource. */
  private inboxSeq = 0;

  /** Monotonic history fetch sequence: stale responses are dropped per resource. */
  private historySeq = 0;

  private refreshTimer: Subscription | null = null;
  private clockTimer: Subscription | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.disconnect());
  }

  // --- public read-only state ---

  readonly dashboard = this.dashboardState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly mutating = this.mutatingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly lastReply = this.lastReplyState.asReadonly();
  readonly connected = this.connectedState.asReadonly();
  readonly inbox = this.inboxState.asReadonly();
  readonly history = this.historyState.asReadonly();

  // --- derived selectors (pure projections of the authoritative snapshot) ---

  readonly programme = computed<ReadingProgramme | null>(() => this.dashboard()?.programme ?? null);
  readonly books = computed<ReadingBookAssignment[]>(() => this.dashboard()?.books ?? []);
  readonly openSession = computed<ReadingSession | null>(() => this.dashboard()?.openSession ?? null);
  readonly currentWeek = computed<ReadingWeekSummary | null>(() => this.dashboard()?.currentWeek ?? null);

  /** Books currently in a mode's queue (Active or Queued), in dashboard order. */
  readonly enduranceBooks = computed(() => this.booksForMode(ReadingMode.Endurance));
  readonly deepBooks = computed(() => this.booksForMode(ReadingMode.Deep));
  readonly recoveryBooks = computed(() => this.booksForMode(ReadingMode.Recovery));

  readonly sessionActive = computed(() => this.openSession()?.status === ReadingSessionStatus.Active);
  readonly sessionPaused = computed(() => this.openSession()?.status === ReadingSessionStatus.Paused);
  readonly sessionAwaitingFeedback = computed(() => this.openSession()?.status === ReadingSessionStatus.AwaitingFeedback);
  readonly sessionPlanned = computed(() => this.openSession()?.status === ReadingSessionStatus.Planned);

  /**
   * Display-only elapsed seconds for the open session.
   *
   * Anchored to the server's `measuredSeconds` at the last dashboard response;
   * while the session is Active and the store is connected, this adds
   * `max(0, floor((now - anchorClientTime) / 1000))` so the value ticks locally
   * once per second. Paused/planned/awaiting/completed sessions never tick.
   * Never sent to the server; never used as evidence.
   */
  readonly displayedElapsedSeconds = computed(() => {
    const anchor = this.displayAnchor();
    if (!anchor) return 0;
    // Register a dependency on the per-second clock so the computed re-evaluates
    // while the 1s clock timer runs (connected only).
    void this.clockTick();
    const session = this.openSession();
    if (!this.connected() || session?.status !== ReadingSessionStatus.Active) {
      return anchor.measuredSeconds;
    }
    const elapsedMs = Date.now() - anchor.clientTime;
    return anchor.measuredSeconds + Math.max(0, Math.floor(elapsedMs / 1000));
  });

  // --- lifecycle ---

  /**
   * Route lifecycle: loads the dashboard immediately, starts the 1s display
   * clock and the 30s authoritative refresh, and registers focus/online/
   * visibilitychange listeners. Idempotent — repeated calls while connected
   * are no-ops and never duplicate timers or listeners.
   */
  connect(): void {
    if (this.connected()) return;
    // Time spent while this route was disconnected is never added locally.
    // The immediate authoritative refresh below supplies any real elapsed time.
    const session = this.openSession();
    const frozenSeconds = this.displayAnchor()?.measuredSeconds;
    this.displayAnchor.set(
      session
        ? { measuredSeconds: frozenSeconds ?? session.measuredSeconds, clientTime: Date.now() }
        : null
    );
    this.connectedState.set(true);
    this.refresh();
    this.refreshTimer = interval(REFRESH_INTERVAL_MS).subscribe(() => this.refresh());
    this.clockTimer = interval(CLOCK_TICK_MS).subscribe(() => this.clockTick.update((v) => v + 1));
    window.addEventListener('focus', this.onWindowFocus);
    window.addEventListener('online', this.onWindowOnline);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  /**
   * Route lifecycle: stops timers and removes listeners. Idempotent and safe
   * to call when already disconnected; the last dashboard snapshot is kept.
   */
  disconnect(): void {
    if (!this.connected()) return;
    // Freeze the last visible value without carrying disconnected wall time
    // into a later reconnect. The next server response reanchors it again.
    const session = this.openSession();
    if (session) {
      this.displayAnchor.set({ measuredSeconds: this.displayedElapsedSeconds(), clientTime: Date.now() });
    }
    this.connectedState.set(false);
    this.refreshTimer?.unsubscribe();
    this.refreshTimer = null;
    this.clockTimer?.unsubscribe();
    this.clockTimer = null;
    window.removeEventListener('focus', this.onWindowFocus);
    window.removeEventListener('online', this.onWindowOnline);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  /**
   * Fetches the authoritative dashboard and atomically replaces the snapshot
   * (re-anchoring the display). Overlapping refreshes converge: only the
   * response of the most recently issued refresh is applied. Errors preserve
   * the last good dashboard and expose a concise actionable message.
   */
  refresh(): void {
    this.loadDashboard().subscribe();
  }

  private readonly onWindowFocus = (): void => {
    if (this.connected()) this.refresh();
  };

  private readonly onWindowOnline = (): void => {
    if (this.connected()) this.refresh();
  };

  private readonly onVisibilityChange = (): void => {
    // Refresh only when the document becomes visible again.
    if (document.visibilityState === 'visible' && this.connected()) this.refresh();
  };

  // --- read-only resources (inbox / history) ---

  /**
   * Fetches the server inbox (unresolved Question/Bookmark captures) and
   * applies `result.data` only when non-null; a null payload or a failure
   * preserves the last good inbox, so the arrays are never fabricated.
   *
   * Cold: no request is issued until the returned observable is subscribed.
   * Overlapping fetches converge via a per-resource monotonic sequence (like
   * the dashboard refresh), so an older in-flight response can never
   * overwrite a newer one. GET failures never rethrow — they follow the
   * refresh convention: the last good data is preserved, `error` is set via
   * describeError, and the stream completes without emitting. Emits the
   * authoritative inbox after it is applied.
   */
  loadInbox(): Observable<ReadingCapture[]> {
    return defer(() => {
      const seq = ++this.inboxSeq;
      return this.service.getInbox().pipe(
        filter((result) => seq === this.inboxSeq),
        take(1),
        catchError((err: unknown) => {
          if (seq !== this.inboxSeq) return EMPTY;
          this.errorState.set(describeError('Unable to load inbox', err));
          return EMPTY;
        }),
        map((result) => {
          this.applyInbox(result);
          return this.inboxState();
        })
      );
    });
  }

  /**
   * Fetches the server session history and applies `result.data` only when
   * non-null; a null payload or a failure preserves the last good history.
   * Same coldness, stale-response protection, error convention, and emission
   * contract as {@link loadInbox} — inbox and history converge independently.
   */
  loadHistory(): Observable<ReadingSession[]> {
    return defer(() => {
      const seq = ++this.historySeq;
      return this.service.getHistory().pipe(
        filter((result) => seq === this.historySeq),
        take(1),
        catchError((err: unknown) => {
          if (seq !== this.historySeq) return EMPTY;
          this.errorState.set(describeError('Unable to load history', err));
          return EMPTY;
        }),
        map((result) => {
          this.applyHistory(result);
          return this.historyState();
        })
      );
    });
  }

  private applyInbox(result: ReadingCommandResult<ReadingCapture[]>): void {
    const data = result.data;
    if (!data) {
      // No payload (e.g. not initialized): keep the last good inbox.
      return;
    }
    this.inboxState.set(data);
    this.errorState.set(null);
  }

  private applyHistory(result: ReadingCommandResult<ReadingSession[]>): void {
    const data = result.data;
    if (!data) {
      // No payload (e.g. not initialized): keep the last good history.
      return;
    }
    this.historyState.set(data);
    this.errorState.set(null);
  }

  // --- commands (forward verbatim; refresh from the server after success) ---

  initialize(request: ReadingCommandRequest): Observable<ReadingCommandResult<ReadingProgramme>> {
    return this.runCommand('initialize programme', () => this.service.initialize(request));
  }

  addBook(request: ReadingAddBookAssignmentRequest): Observable<ReadingCommandResult<ReadingBookAssignment>> {
    return this.runCommand('add book', () => this.service.addBook(request));
  }

  setDefaultBook(request: ReadingSetDefaultBookRequest): Observable<ReadingCommandResult<ReadingBookAssignment>> {
    return this.runCommand('set default book', () => this.service.setDefaultBook(request));
  }

  completeBook(request: ReadingCompleteBookRequest): Observable<ReadingCommandResult<ReadingBookAssignment>> {
    return this.runCommand('complete book', () => this.service.completeBook(request));
  }

  reorderQueue(request: ReadingReorderQueueRequest): Observable<ReadingCommandResult<ReadingBookAssignment[]>> {
    return this.runCommand('reorder queue', () => this.service.reorderQueue(request));
  }

  planSession(request: ReadingPlanSessionRequest): Observable<ReadingCommandResult<ReadingSession>> {
    return this.runCommand('plan session', () => this.service.planSession(request));
  }

  startSession(request: ReadingStartSessionRequest): Observable<ReadingCommandResult<ReadingSession>> {
    return this.runCommand('start session', () => this.service.startSession(request));
  }

  startNewSession(request: ReadingStartNewSessionRequest): Observable<ReadingCommandResult<ReadingSession>> {
    return this.runCommand('start new session', () => this.service.startNewSession(request));
  }

  pauseSession(request: ReadingSessionCommandRequest): Observable<ReadingCommandResult<ReadingSession>> {
    return this.runCommand('pause session', () => this.service.pauseSession(request));
  }

  resumeSession(request: ReadingSessionCommandRequest): Observable<ReadingCommandResult<ReadingSession>> {
    return this.runCommand('resume session', () => this.service.resumeSession(request));
  }

  completeSession(request: ReadingCompleteSessionRequest): Observable<ReadingCommandResult<ReadingSession>> {
    return this.runCommand('complete session', () => this.service.completeSession(request));
  }

  rateSession(request: ReadingRateSessionRequest): Observable<ReadingCommandResult<ReadingSession>> {
    return this.runCommand('rate session', () => this.service.rateSession(request));
  }

  skipRatings(request: ReadingSkipRatingsRequest): Observable<ReadingCommandResult<ReadingSession>> {
    return this.runCommand('skip ratings', () => this.service.skipRatings(request));
  }

  cancelSession(request: ReadingSessionCommandRequest): Observable<ReadingCommandResult<ReadingSession>> {
    return this.runCommand('cancel session', () => this.service.cancelSession(request));
  }

  capture(request: ReadingCaptureRequest): Observable<ReadingCommandResult<ReadingCapture>> {
    return this.runCommand('capture', () => this.service.capture(request));
  }

  resolveCapture(
    captureId: string,
    request: ReadingResolveCaptureRequest
  ): Observable<ReadingCommandResult<ReadingCapture>> {
    return this.runCommand('resolve capture', () => this.service.resolveCapture(captureId, request));
  }

  promoteCapture(
    captureId: string,
    request: ReadingPromoteCaptureRequest
  ): Observable<ReadingCommandResult<ReadingCapture>> {
    return this.runCommand('promote capture', () => this.service.promoteCapture(captureId, request));
  }

  commitWeeklyReview(request: ReadingCommitWeeklyReviewRequest): Observable<ReadingCommandResult<ReadingWeeklyReview>> {
    return this.runCommand('commit weekly review', () => this.service.commitWeeklyReview(request));
  }

  // --- internals ---

  /**
   * Serialized command pipeline: one mutation at a time. The lock is held from
   * command dispatch until the authoritative refresh that follows a successful
   * command completes — then it is released exactly once, immediately before
   * the command result is delivered downstream (so a caller can start a
   * follow-up command from its result handler, e.g. rating a just-completed
   * session) and before a command error is rethrown. The per-subscription
   * `release()` closure is idempotent: the first command's later completion
   * can never clear a lock a subsequent command has already acquired.
   *
   * Emits the original `ReadingCommandResult<T>` so callers can use command
   * data (e.g. dialog flow); command failures rethrow the original error
   * without refreshing or retrying. Synchronous throws from the command
   * factory, empty completions, and early unsubscription all release the lock
   * through the same guarded finalizer.
   */
  private runCommand<T>(
    actionLabel: string,
    invoke: () => Observable<ReadingCommandResult<T>>
  ): Observable<ReadingCommandResult<T>> {
    return defer(() => {
      if (this.mutating()) {
        return throwError(() => new Error(MUTATION_IN_PROGRESS));
      }
      this.mutatingState.set(true);
      this.errorState.set(null);
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        this.mutatingState.set(false);
      };
      // The inner defer turns a synchronous throw from invoke() into a stream
      // error so the lock is still released and reported consistently.
      return defer(() => invoke()).pipe(
        switchMap((result) => {
          this.lastReplyState.set(result.reply);
          return this.loadDashboard().pipe(
            defaultIfEmpty(undefined),
            map(() => {
              // Refresh-before-result: the result only leaves after the
              // authoritative refresh finished; the lock drops just before it
              // reaches the caller.
              release();
              return result;
            })
          );
        }),
        catchError((err: unknown) => {
          release();
          this.errorState.set(describeError(`Failed to ${actionLabel}`, err));
          return throwError(() => err);
        }),
        finalize(() => release())
      );
    });
  }

  /**
   * One dashboard fetch carrying a monotonic sequence number. Only the
   * response of the most recently issued fetch is applied; older responses
   * (success or error) are dropped so they cannot overwrite newer state.
   */
  private loadDashboard(): Observable<void> {
    const seq = ++this.refreshSeq;
    this.loadingState.set(true);
    return this.service.getDashboard().pipe(
      filter((result) => seq === this.refreshSeq),
      take(1),
      catchError((err: unknown) => {
        if (seq !== this.refreshSeq) return EMPTY;
        this.errorState.set(describeError('Unable to load dashboard', err));
        return EMPTY;
      }),
      tap((result) => this.applyDashboard(result)),
      map(() => undefined),
      finalize(() => {
        if (seq === this.refreshSeq) this.loadingState.set(false);
      })
    );
  }

  private applyDashboard(result: ReadingCommandResult<ReadingDashboard>): void {
    const data = result.data;
    if (!data) {
      // No snapshot (e.g. not initialized): keep the last good dashboard and
      // never fabricate a programme.
      return;
    }
    this.dashboardState.set(data);
    this.errorState.set(null);
    const session = data.openSession;
    this.displayAnchor.set(session ? { measuredSeconds: session.measuredSeconds, clientTime: Date.now() } : null);
  }

  /** Mode-specific queue books (Active or Queued) in dashboard order. */
  booksForMode(mode: ReadingMode): ReadingBookAssignment[] {
    return this.books().filter(
      (b) =>
        b.mode === mode && (b.status === ReadingAssignmentStatus.Active || b.status === ReadingAssignmentStatus.Queued)
    );
  }

  /** The default active assignment for a mode, or null when none is set. */
  defaultBookForMode(mode: ReadingMode): ReadingBookAssignment | null {
    return this.books().find((b) => b.mode === mode && b.status === ReadingAssignmentStatus.Active && b.isDefault) ?? null;
  }
}

/**
 * Extracts a concise, actionable code/message from backend error bodies:
 * command envelopes (`{ data: { code } }`), Problem Details (`detail`/`title`),
 * HTTP status, or network failure.
 */
function extractErrorCode(err: unknown): string | null {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { data?: { code?: unknown } | null; detail?: unknown; title?: unknown } | null;
    if (body && typeof body === 'object') {
      if (typeof body.data?.code === 'string' && body.data.code) return body.data.code;
      if (typeof body.detail === 'string' && body.detail) return body.detail;
      if (typeof body.title === 'string' && body.title) return body.title;
    }
    if (err.status === 0) return 'network error';
    return null;
  }
  if (err instanceof Error && err.message) return err.message;
  return null;
}

function describeError(action: string, err: unknown): string {
  const code = extractErrorCode(err);
  if (code) return `${action}: ${code}`;
  if (err instanceof HttpErrorResponse && err.status > 0) return `${action}: HTTP ${err.status}`;
  return `${action}: unknown error`;
}
