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
  ReadingAckNotificationResult,
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
  ReadingNotification,
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
  isReadingError,
} from '../core/dtos/reading-training.dtos';
import { ReadingTrainingService } from '../core/services/reading-training.service';

const EMPTY_SESSION_ID = '00000000-0000-0000-0000-000000000000';

/** Authoritative dashboard refresh cadence while connected. */
const REFRESH_INTERVAL_MS = 30_000;
/** Notification lease cadence while connected (matches the backend scan/lease). */
const NOTICES_REFRESH_INTERVAL_MS = 30_000;
/** Display-clock cadence; drives the local ticking of `displayedElapsedSeconds`. */
const CLOCK_TICK_MS = 1_000;

/**
 * Command error raised deterministically when a mutation is attempted while
 * another mutation (command + its authoritative refresh) is still in flight.
 */
const MUTATION_IN_PROGRESS = 'mutation_in_progress';

/**
 * Raised deterministically when an acknowledgement is attempted while another
 * acknowledgement is still in flight.
 */
const NOTIFICATION_ACK_IN_PROGRESS = 'notification_ack_in_progress';

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
  private readonly stateVersionState = signal<string | null>(null);

  /** Authoritative server inbox (unresolved Question/Bookmark captures). */
  private readonly inboxState = signal<ReadingCapture[]>([]);
  /** Authoritative server session history, newest-first per the backend. */
  private readonly historyState = signal<ReadingSession[]>([]);

  /**
   * UI lease state for pending reading notices. This is display state only —
   * the server owns the notification outbox; rows appear here because this
   * client holds their lease, and disappear only after a confirmed ack.
   */
  private readonly pendingNoticesState = signal<ReadingNotification[]>([]);
  /** True while any notification lease request is in flight. */
  private readonly notificationsLoadingState = signal(false);
  /** The notification id whose ack is currently in flight, or null. */
  private readonly acknowledgingNotificationIdState = signal<string | null>(null);

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

  /** Monotonic notice lease sequence: stale lease responses are dropped. */
  private noticesSeq = 0;

  private refreshTimer: Subscription | null = null;
  private clockTimer: Subscription | null = null;

  /** Periodic notification lease; kept separate from the dashboard timer. */
  private noticesTimer: Subscription | null = null;
  /** The in-flight notification lease subscription, if any. */
  private noticesLeaseSubscription: Subscription | null = null;
  /** True while a notification lease request is outstanding (no overlap). */
  private noticesLeaseInFlight = false;

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

  /**
   * Authoritative server state version, retained from the `stateVersion` of
   * the last successful dashboard or mutation envelope (the same value REST
   * and MCP report, so the UI shares their version identity). Null until the
   * first successful envelope; failures and rejected commands never change
   * it. Surfaced non-visually as `data-state-version` on the page root —
   * never rendered as visible text.
   */
  readonly stateVersion = this.stateVersionState.asReadonly();
  readonly inbox = this.inboxState.asReadonly();
  readonly history = this.historyState.asReadonly();
  readonly pendingNotices = this.pendingNoticesState.asReadonly();
  readonly notificationsLoading = this.notificationsLoadingState.asReadonly();
  readonly acknowledgingNotificationId = this.acknowledgingNotificationIdState.asReadonly();

  /** True while any notification lease or acknowledgement is in flight. */
  readonly notificationsBusy = computed(
    () => this.notificationsLoading() || this.acknowledgingNotificationId() !== null
  );

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
   * clock and the 30s authoritative refresh, leases pending reading notices
   * immediately and then every 30s, and registers focus/online/visibilitychange
   * listeners that refresh both. Idempotent — repeated calls while connected
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
    this.refreshNotices();
    this.refreshTimer = interval(REFRESH_INTERVAL_MS).subscribe(() => this.refresh());
    this.noticesTimer = interval(NOTICES_REFRESH_INTERVAL_MS).subscribe(() => this.refreshNotices());
    this.clockTimer = interval(CLOCK_TICK_MS).subscribe(() => this.clockTick.update((v) => v + 1));
    window.addEventListener('focus', this.onWindowFocus);
    window.addEventListener('online', this.onWindowOnline);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  /**
   * Route lifecycle: stops timers and removes listeners. Idempotent and safe
   * to call when already disconnected; the last dashboard snapshot and the
   * displayed notices are kept.
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
    this.noticesTimer?.unsubscribe();
    this.noticesTimer = null;
    this.clockTimer?.unsubscribe();
    this.clockTimer = null;
    this.noticesLeaseSubscription?.unsubscribe();
    this.noticesLeaseSubscription = null;
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
    if (!this.connected()) return;
    this.refresh();
    this.refreshNotices();
  };

  private readonly onWindowOnline = (): void => {
    if (!this.connected()) return;
    this.refresh();
    this.refreshNotices();
  };

  private readonly onVisibilityChange = (): void => {
    // Refresh only when the document becomes visible again.
    if (document.visibilityState === 'visible' && this.connected()) {
      this.refresh();
      this.refreshNotices();
    }
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
    this.clearResourceError('Unable to load inbox:');
  }

  private applyHistory(result: ReadingCommandResult<ReadingSession[]>): void {
    const data = result.data;
    if (!data) {
      // No payload (e.g. not initialized): keep the last good history.
      return;
    }
    this.historyState.set(data);
    this.clearResourceError('Unable to load history:');
  }

  /** Clear a successful resource's own error without hiding another resource's failure. */
  private clearResourceError(prefix: string): void {
    if (this.errorState()?.startsWith(prefix)) this.errorState.set(null);
  }

  // --- pending reading notices (UI lease state, not command envelopes) ---

  /**
   * Leases pending reading notices from the server (GET notifications/lease,
   * exact `maxCount`/`leaseSeconds` forwarded verbatim) and merges the rows
   * into the currently displayed unacknowledged notices.
   *
   * Merging, not replacing: a periodic empty result means "no *new* notices"
   * — currently displayed notices stay leased and visible until the server
   * confirms their ack. Existing rows keep their exact object and relative
   * display order; newly leased rows are appended in server order.
   *
   * Cold: no request is issued until the returned observable is subscribed.
   * Overlapping leases converge via a monotonic sequence, so an older
   * in-flight response can never overwrite a newer one. Failures follow the
   * refresh convention: the displayed notices are preserved, a concise error
   * is surfaced, and the stream completes without emitting or retrying.
   * Emits the authoritative displayed list after it is applied.
   */
  loadNotifications(maxCount = 10, leaseSeconds = 60): Observable<ReadingNotification[]> {
    return defer(() => {
      const seq = ++this.noticesSeq;
      this.notificationsLoadingState.set(true);
      return this.service.leaseNotifications(maxCount, leaseSeconds).pipe(
        filter((rows) => seq === this.noticesSeq),
        take(1),
        catchError((err: unknown) => {
          if (seq !== this.noticesSeq) return EMPTY;
          this.errorState.set(describeError('Unable to load reading notices', err));
          return EMPTY;
        }),
        map((rows) => {
          this.applyLeasedNotices(rows);
          return this.pendingNoticesState();
        }),
        finalize(() => {
          if (seq === this.noticesSeq) this.notificationsLoadingState.set(false);
        })
      );
    });
  }

  private applyLeasedNotices(rows: ReadingNotification[]): void {
    if (!rows || rows.length === 0) {
      // Never hide still-visible leased notices on an empty periodic result.
      this.clearNotificationError();
      return;
    }
    const current = this.pendingNoticesState();
    const merged = [...current];
    const known = new Set(current.map((n) => n.notificationId));
    for (const row of rows) {
      if (known.has(row.notificationId)) continue;
      merged.push(row);
      known.add(row.notificationId);
    }
    this.pendingNoticesState.set(merged);
    this.clearNotificationError();
  }

  /** Clear only errors produced by the notification lease/ack resource. */
  private clearNotificationError(): void {
    const error = this.errorState();
    if (
      error?.startsWith('Unable to load reading notices:') ||
      error?.startsWith('Failed to acknowledge reading notice:')
    ) {
      this.errorState.set(null);
    }
  }

  /**
   * Acknowledges one pending notice via the service (POST
   * notifications/{id}/ack with no body and no idempotency key — the ack
   * endpoint is inherently idempotent). The notice is removed from the
   * display only after the server confirms `{ acknowledged: true,
   * notificationId }` for the exact id; a `false`/mismatched/unknown response
   * preserves it. Failures preserve the notice, surface a concise error
   * through the existing error convention, and never retry.
   *
   * Cold, and single-flight: a concurrent acknowledgement fails
   * deterministically with `notification_ack_in_progress` without issuing a
   * request; `acknowledgingNotificationId` exposes the busy id. The lock
   * releases on every terminal path (success, error, early unsubscription).
   * This is UI lease state and is independent of the domain `mutating`
   * command lock — it neither reuses nor generates command idempotency.
   */
  acknowledgeNotification(notificationId: string): Observable<ReadingAckNotificationResult> {
    return defer(() => {
      if (this.acknowledgingNotificationId() !== null) {
        return throwError(() => new Error(NOTIFICATION_ACK_IN_PROGRESS));
      }
      this.acknowledgingNotificationIdState.set(notificationId);
      this.clearNotificationError();
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        this.acknowledgingNotificationIdState.set(null);
      };
      // The inner defer turns a synchronous throw from the service into a
      // stream error so the lock is still released and reported consistently.
      return defer(() => this.service.acknowledgeNotification(notificationId)).pipe(
        map((result) => {
          if (result.acknowledged === true && result.notificationId === notificationId) {
            this.removePendingNotice(notificationId);
          }
          return result;
        }),
        catchError((err: unknown) => {
          release();
          this.errorState.set(describeError('Failed to acknowledge reading notice', err));
          return throwError(() => err);
        }),
        finalize(() => release())
      );
    });
  }

  private removePendingNotice(notificationId: string): void {
    this.pendingNoticesState.set(
      this.pendingNoticesState().filter((notice) => notice.notificationId !== notificationId)
    );
  }

  /**
   * One notification lease at a time: while a lease is outstanding, further
   * triggers (timer ticks, focus/online/visibility events) are skipped so
   * requests never overlap. The in-flight flag clears on every terminal
   * path, including disconnect's unsubscription.
   */
  private refreshNotices(): void {
    if (this.noticesLeaseInFlight) return;
    this.noticesLeaseInFlight = true;
    this.noticesLeaseSubscription = this.loadNotifications()
      .pipe(
        finalize(() => {
          this.noticesLeaseInFlight = false;
          this.noticesLeaseSubscription = null;
        })
      )
      .subscribe({ error: () => void 0 });
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
    return this.runCommand('pause session', () =>
      this.service.pauseSession(request, this.openSession()?.id ?? EMPTY_SESSION_ID)
    );
  }

  resumeSession(request: ReadingSessionCommandRequest): Observable<ReadingCommandResult<ReadingSession>> {
    return this.runCommand('resume session', () =>
      this.service.resumeSession(request, this.openSession()?.id ?? EMPTY_SESSION_ID)
    );
  }

  completeSession(request: ReadingCompleteSessionRequest): Observable<ReadingCommandResult<ReadingSession>> {
    return this.runCommand('complete session', () =>
      this.service.completeSession(request, this.openSession()?.id ?? EMPTY_SESSION_ID)
    );
  }

  rateSession(request: ReadingRateSessionRequest): Observable<ReadingCommandResult<ReadingSession>> {
    return this.runCommand('rate session', () =>
      this.service.rateSession(request, this.openSession()?.id ?? EMPTY_SESSION_ID)
    );
  }

  skipRatings(request: ReadingSkipRatingsRequest): Observable<ReadingCommandResult<ReadingSession>> {
    return this.runCommand('skip ratings', () =>
      this.service.skipRatings(request, this.openSession()?.id ?? EMPTY_SESSION_ID)
    );
  }

  cancelSession(request: ReadingSessionCommandRequest): Observable<ReadingCommandResult<ReadingSession>> {
    return this.runCommand('cancel session', () =>
      this.service.cancelSession(request, this.openSession()?.id ?? EMPTY_SESSION_ID)
    );
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
          // Retain the version this mutation's envelope reports; the
          // authoritative refresh below replaces it with the newest version
          // when it succeeds, and this one survives when it fails.
          this.stateVersionState.set(result.stateVersion);
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
    if (isReadingError(data)) {
      // HTTP-200 semantic error envelope (e.g. `not_initialized`): the
      // server reports a domain rejection without a dashboard payload.
      // Surface the code, keep the last good dashboard, and never advance
      // the retained state version.
      this.errorState.set(describeError('Unable to load dashboard', data));
      return;
    }
    if (!data) {
      // No snapshot (e.g. not initialized): keep the last good dashboard and
      // never fabricate a programme.
      return;
    }
    this.dashboardState.set(data);
    this.stateVersionState.set(result.stateVersion);
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
 * an HTTP-200 semantic error payload (`{ code }`), HTTP status, or network
 * failure.
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
  // Semantic error payload delivered in an HTTP-200 envelope (no HTTP failure).
  if (isReadingError(err)) return err.code;
  if (err instanceof Error && err.message) return err.message;
  return null;
}

function describeError(action: string, err: unknown): string {
  const code = extractErrorCode(err);
  if (code) return `${action}: ${code}`;
  if (err instanceof HttpErrorResponse && err.status > 0) return `${action}: HTTP ${err.status}`;
  return `${action}: unknown error`;
}
