import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EMPTY, Subject } from 'rxjs';

import { ReadingTrainingStore } from './reading-training.store';
import { ReadingTrainingService } from '../core/services/reading-training.service';
import {
  ReadingAckNotificationResult,
  ReadingAssignmentStatus,
  ReadingBookAssignment,
  ReadingCapture,
  ReadingCaptureType,
  ReadingChangeBookModeData,
  ReadingChangeBookModeRequest,
  ReadingCommandResult,
  ReadingConstraint,
  ReadingDashboard,
  ReadingMode,
  ReadingNotification,
  ReadingProgramme,
  ReadingRemoveBookAssignmentData,
  ReadingRemoveBookAssignmentRequest,
  ReadingSession,
  ReadingSessionStatus,
  ReadingTargets,
  ReadingWeeklyReview,
} from '../core/dtos/reading-training.dtos';

describe('ReadingTrainingStore', () => {
  let store: ReadingTrainingStore;
  let httpMock: HttpTestingController;

  const base = '/api/reading';
  const clientId = 'test-client';
  const idempotencyKey = 'key-1';
  const sessionId = '11111111-1111-1111-1111-111111111111';
  const emptySessionId = '00000000-0000-0000-0000-000000000000';

  function sessionCommandUrl(suffix: string): string {
    return `${base}/sessions/${store.openSession()?.id ?? emptySessionId}/${suffix}`;
  }
  const assignmentId = '22222222-2222-2222-2222-222222222222';
  const deepAssignmentId = '77777777-7777-7777-7777-777777777777';
  const bookId = '33333333-3333-3333-3333-333333333333';
  const captureId = '44444444-4444-4444-4444-444444444444';
  const noteId = '55555555-5555-5555-5555-555555555555';

  const targets: ReadingTargets = {
    enduranceTargetMinutes: 40,
    deepTargetMinutes: 30,
    recoveryTargetMinutes: 20,
    enduranceEstablishedMinutes: 40,
    deepEstablishedMinutes: 30,
    recoveryEstablishedMinutes: 20,
  };

  const programme: ReadingProgramme = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    timezoneId: 'Europe/Stockholm',
    stateVersion: '17',
    targets,
    deloadActive: false,
  };

  const session: ReadingSession = {
    id: sessionId,
    bookAssignmentId: assignmentId,
    bookId,
    bookTitle: 'Meditations',
    mode: ReadingMode.Endurance,
    status: ReadingSessionStatus.Active,
    targetMinutes: 40,
    plannedTargetMinutes: 40,
    constraint: ReadingConstraint.None,
    progressionEligible: true,
    countsAsFailure: false,
    accumulatedSeconds: 900,
    measuredSeconds: 900,
    reportedMinutes: null,
    effort: 0,
    focus: 0,
    rating: null,
    ratingsSkipped: false,
    plannedAt: '2026-08-09T08:00:00+02:00',
    startedAt: '2026-08-09T08:05:00+02:00',
    lastStartedAt: '2026-08-09T08:05:00+02:00',
    pausedAt: null,
    completedAt: null,
  };

  const pausedSession: ReadingSession = {
    ...session,
    status: ReadingSessionStatus.Paused,
    measuredSeconds: 1200,
    accumulatedSeconds: 1200,
    pausedAt: '2026-08-09T08:25:00+02:00',
  };

  const assignment: ReadingBookAssignment = {
    id: assignmentId,
    bookId,
    bookTitle: 'Meditations',
    bookAuthor: 'Marcus Aurelius',
    mode: ReadingMode.Endurance,
    status: ReadingAssignmentStatus.Active,
    queueOrder: 0,
    isDefault: true,
    createdAt: '2026-08-09T08:00:00+02:00',
    startedAt: '2026-08-09T08:00:00+02:00',
    completedAt: null,
  };

  const queuedAssignment: ReadingBookAssignment = {
    ...assignment,
    id: '88888888-8888-8888-8888-888888888888',
    bookTitle: 'Letters from a Stoic',
    queueOrder: 1,
    isDefault: false,
  };

  const completedAssignment: ReadingBookAssignment = {
    ...assignment,
    id: '99999999-9999-9999-9999-999999999999',
    status: ReadingAssignmentStatus.Completed,
    queueOrder: 2,
    isDefault: false,
    completedAt: '2026-08-09T09:00:00+02:00',
  };

  const deepAssignment: ReadingBookAssignment = {
    id: deepAssignmentId,
    bookId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    bookTitle: 'Being and Time',
    bookAuthor: 'Heidegger',
    mode: ReadingMode.Deep,
    status: ReadingAssignmentStatus.Active,
    queueOrder: 0,
    isDefault: true,
    createdAt: '2026-08-09T08:00:00+02:00',
    startedAt: null,
    completedAt: null,
  };

  const capture: ReadingCapture = {
    id: captureId,
    text: 'A stoic thought.',
    type: ReadingCaptureType.Thought,
    bookId,
    sessionId,
    externalId: null,
    resolved: false,
    promotedNoteId: null,
    createdAt: '2026-08-09T08:10:00+02:00',
  };

  const review: ReadingWeeklyReview = {
    weekKey: '2026-W33',
    isoYear: 2026,
    isoWeek: 33,
    committed: true,
    committedAt: '2026-08-09T09:00:00+02:00',
    totalVolumeMinutes: 240,
    previousWeekVolumeMinutes: 220,
    modes: [
      {
        mode: ReadingMode.Endurance,
        targetBeforeMinutes: 40,
        targetAfterMinutes: 45,
        decisionKind: 'increase',
        reason: 'qualifying-attempts',
        qualifyingCount: 3,
        completionRate: 1,
        medianEffort: 6,
        medianFocus: 7,
        nextConsecutiveIncreases: 1,
      },
    ],
    stateVersion: '18',
  };

  function dashboard(overrides: Partial<ReadingDashboard> = {}): ReadingDashboard {
    return {
      programme,
      books: [assignment, queuedAssignment, completedAssignment, deepAssignment],
      openSession: session,
      currentWeek: null,
      ...overrides,
    };
  }

  function envelope<T>(data: T, overrides: Partial<ReadingCommandResult<T>> = {}): ReadingCommandResult<T> {
    return { reply: 'ok', stateVersion: '17', duplicate: false, data, ...overrides };
  }

  const noticeId1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
  const noticeId2 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
  const leaseUntil = '2026-08-09T19:00:00+02:00';

  function notice(id: string, overrides: Partial<ReadingNotification> = {}): ReadingNotification {
    return {
      notificationId: id,
      payload: {
        notificationId: id,
        sessionId,
        bookId,
        mode: ReadingMode.Deep,
        plannedTargetMinutes: 10,
        effectiveElapsedSeconds: 605,
        message: 'Reading target reached.',
      },
      leaseUntil,
      ...overrides,
    };
  }

  function matchLeases() {
    return httpMock.match((request) => request.url === `${base}/notifications/lease`);
  }

  function expectLease() {
    return httpMock.expectOne((request) => request.url === `${base}/notifications/lease`);
  }

  /** Flushes every outstanding notification lease request with `rows`. */
  function flushLease(rows: ReadingNotification[] = []): void {
    for (const req of matchLeases()) req.flush(rows);
  }

  beforeEach(() => {
    // Vitest fake timers also fake Date, so `Date.now()` is deterministic and
    // advances with `vi.advanceTimersByTime` — no clock seam needed in the store.
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(ReadingTrainingStore);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    store.disconnect();
    // Fails on stray/unflushed requests (hidden retries, listener leaks, ...).
    httpMock.verify();
    vi.useRealTimers();
  });

  // --- lifecycle ---

  it('connect() loads the dashboard immediately and starts the 30s authoritative refresh', () => {
    store.connect();
    expect(store.connected()).toBe(true);
    expect(store.loading()).toBe(true);
    expect(store.displayedElapsedSeconds()).toBe(0);

    let req = httpMock.expectOne(`${base}/dashboard`);
    req.flush(envelope(dashboard()));
    expect(store.loading()).toBe(false);
    expect(store.dashboard()).toEqual(dashboard());
    flushLease();

    // No refresh before 30s have elapsed.
    vi.advanceTimersByTime(29_999);
    expect(httpMock.match(`${base}/dashboard`)).toHaveLength(0);
    expect(matchLeases()).toHaveLength(0);

    vi.advanceTimersByTime(1);
    req = httpMock.expectOne(`${base}/dashboard`);
    req.flush(envelope(dashboard({ openSession: { ...session, measuredSeconds: 1000 } })));
    expect(store.openSession()?.measuredSeconds).toBe(1000);
    expectLease().flush([]);
  });

  it('refreshes on window focus, on window online, and on visibility becoming visible (not hidden)', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();

    window.dispatchEvent(new Event('focus'));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expectLease().flush([]);

    window.dispatchEvent(new Event('online'));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expectLease().flush([]);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(httpMock.match(`${base}/dashboard`)).toHaveLength(0);
    expect(matchLeases()).toHaveLength(0);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expectLease().flush([]);
  });

  it('connect() is idempotent: repeated calls do not duplicate requests, timers, or listeners', () => {
    store.connect();
    store.connect();
    store.connect();
    expect(store.connected()).toBe(true);

    // Exactly one immediate load.
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();

    // Exactly one 30s refresh (a duplicated timer would produce two requests).
    vi.advanceTimersByTime(30_000);
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expectLease().flush([]);

    // Exactly one focus listener (a duplicated listener would produce two requests).
    window.dispatchEvent(new Event('focus'));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expectLease().flush([]);
  });

  it('disconnect() stops timers and removes listeners; no later refresh fires', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();
    store.disconnect();
    expect(store.connected()).toBe(false);

    vi.advanceTimersByTime(120_000);
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(httpMock.match(`${base}/dashboard`)).toHaveLength(0);
    expect(matchLeases()).toHaveLength(0);
    expect(store.dashboard()).toEqual(dashboard());
  });

  it('reconnecting after disconnect reloads the dashboard and restarts the lifecycle', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();
    store.disconnect();

    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();
    vi.advanceTimersByTime(30_000);
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expectLease().flush([]);
  });

  // --- dashboard selectors and refresh convergence ---

  it('exposes derived selectors from the dashboard snapshot', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();

    expect(store.programme()).toEqual(programme);
    expect(store.books()).toEqual([assignment, queuedAssignment, completedAssignment, deepAssignment]);
    expect(store.openSession()).toEqual(session);
    expect(store.currentWeek()).toBeNull();
    expect(store.sessionActive()).toBe(true);
    expect(store.sessionPaused()).toBe(false);
    expect(store.sessionAwaitingFeedback()).toBe(false);
    expect(store.sessionPlanned()).toBe(false);

    // Mode-specific queue books exclude completed/archived assignments.
    expect(store.booksForMode(ReadingMode.Endurance)).toEqual([assignment, queuedAssignment]);
    expect(store.enduranceBooks()).toEqual([assignment, queuedAssignment]);
    expect(store.deepBooks()).toEqual([deepAssignment]);
    expect(store.recoveryBooks()).toEqual([]);
    expect(store.defaultBookForMode(ReadingMode.Endurance)).toEqual(assignment);
    expect(store.defaultBookForMode(ReadingMode.Deep)).toEqual(deepAssignment);
    expect(store.defaultBookForMode(ReadingMode.Recovery)).toBeNull();
  });

  it('replaces the snapshot atomically on each successful refresh', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();

    const updated = dashboard({
      openSession: { ...session, status: ReadingSessionStatus.Paused, pausedAt: '2026-08-09T08:25:00+02:00' },
    });
    window.dispatchEvent(new Event('focus'));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(updated));
    expectLease().flush([]);

    expect(store.dashboard()).toEqual(updated);
    expect(store.sessionPaused()).toBe(true);
    expect(store.sessionActive()).toBe(false);
  });

  it('an older overlapping refresh response never overwrites a newer one', () => {
    store.connect();
    flushLease();
    const older = httpMock.expectOne(`${base}/dashboard`);

    store.refresh();
    const newer = httpMock.expectOne(`${base}/dashboard`);

    // Newer response lands first and is applied...
    const updated = dashboard({ openSession: { ...session, measuredSeconds: 1000 } });
    newer.flush(envelope(updated));
    expect(store.dashboard()).toEqual(updated);

    // ...the older response lands afterwards and must be ignored.
    older.flush(envelope(dashboard()));
    expect(store.dashboard()).toEqual(updated);
  });

  // --- stateVersion retention (UI/REST/MCP version identity) ---

  it('stateVersion is null until the first successful envelope and is exposed read-only', () => {
    expect(store.stateVersion()).toBeNull();
    // asReadonly() surfaces the signal without the writable API.
    expect((store.stateVersion as { set?: unknown }).set).toBeUndefined();
  });

  it('a successful dashboard envelope retains its stateVersion; later refreshes replace it', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();
    expect(store.stateVersion()).toBe('17');

    // A later refresh carries a newer version and replaces the retained one.
    window.dispatchEvent(new Event('focus'));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard(), { stateVersion: '18' }));
    expectLease().flush([]);
    expect(store.stateVersion()).toBe('18');
  });

  it('a mutation envelope updates the retained stateVersion even when the follow-up refresh fails', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();
    expect(store.stateVersion()).toBe('17');

    let emitted: ReadingCommandResult<ReadingSession> | undefined;
    store.pauseSession({ clientId, idempotencyKey }).subscribe((r) => (emitted = r));

    // The command envelope carries the version that includes this mutation...
    httpMock.expectOne(sessionCommandUrl('pause')).flush(
      envelope(pausedSession, { reply: 'session paused', stateVersion: '18' })
    );
    // ...and even when the authoritative refresh fails, that version is retained.
    httpMock.expectOne(`${base}/dashboard`).flush(
      { title: 'Unavailable' },
      { status: 503, statusText: 'Service Unavailable' }
    );

    expect(emitted?.data?.status).toBe(ReadingSessionStatus.Paused);
    expect(store.stateVersion()).toBe('18');
    expect(store.dashboard()).toEqual(dashboard()); // last good dashboard preserved
    expect(store.error()).toBe('Unable to load dashboard: Unavailable');
  });

  it('a failed dashboard refresh preserves the last retained stateVersion', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();
    expect(store.stateVersion()).toBe('17');

    window.dispatchEvent(new Event('focus'));
    httpMock.expectOne(`${base}/dashboard`).error(new ProgressEvent('error'));
    expectLease().flush([]);

    expect(store.stateVersion()).toBe('17');
    expect(store.dashboard()).toEqual(dashboard());
  });

  it('a rejected command does not change the retained stateVersion', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();
    expect(store.stateVersion()).toBe('17');

    let error: unknown;
    store.pauseSession({ clientId, idempotencyKey }).subscribe({ error: (e) => (error = e) });
    httpMock.expectOne(sessionCommandUrl('pause')).flush(
      {
        reply: 'Cannot pause: no active session',
        data: { code: 'invalid_transition' },
        stateVersion: '17',
        duplicate: false,
      },
      { status: 409, statusText: 'Conflict' }
    );

    expect(error).toBeInstanceOf(HttpErrorResponse);
    expect(store.stateVersion()).toBe('17'); // rejection bodies never fabricate a version
    expect(store.mutating()).toBe(false);
  });

  // --- inbox and history reads ---

  it('starts with empty inbox and history arrays, exposed read-only', () => {
    expect(store.inbox()).toEqual([]);
    expect(store.history()).toEqual([]);
    // asReadonly() surfaces signals without the writable API.
    expect((store.inbox as { set?: unknown }).set).toBeUndefined();
    expect((store.history as { set?: unknown }).set).toBeUndefined();
  });

  it('loadInbox and loadHistory are cold: no request until subscribed', () => {
    const inbox$ = store.loadInbox();
    const history$ = store.loadHistory();
    expect(httpMock.match(`${base}/inbox`)).toHaveLength(0);
    expect(httpMock.match(`${base}/sessions`)).toHaveLength(0);

    inbox$.subscribe();
    // match() consumes requests, so keep a reference before flushing.
    const inboxReqs = httpMock.match(`${base}/inbox`);
    expect(inboxReqs).toHaveLength(1);
    expect(httpMock.match(`${base}/sessions`)).toHaveLength(0);
    inboxReqs[0].flush(envelope([capture]));
    expect(store.inbox()).toEqual([capture]);

    history$.subscribe();
    const historyReqs = httpMock.match(`${base}/sessions`);
    expect(historyReqs).toHaveLength(1);
    historyReqs[0].flush(envelope([pausedSession]));
    expect(store.history()).toEqual([pausedSession]);
  });

  it('loadInbox applies the exact server result and emits the authoritative inbox', () => {
    let emitted: ReadingCapture[] | undefined;
    store.loadInbox().subscribe((v) => (emitted = v));
    httpMock.expectOne(`${base}/inbox`).flush(envelope([capture]));

    expect(emitted).toEqual([capture]);
    expect(store.inbox()).toEqual([capture]);
    expect(store.error()).toBeNull();
  });

  it('loadHistory applies the exact server result', () => {
    let emitted: ReadingSession[] | undefined;
    store.loadHistory().subscribe((v) => (emitted = v));
    httpMock.expectOne(`${base}/sessions`).flush(envelope([session, pausedSession]));

    expect(emitted).toEqual([session, pausedSession]);
    expect(store.history()).toEqual([session, pausedSession]);
    expect(store.error()).toBeNull();
  });

  it('a null inbox payload preserves the last good inbox (never fabricated)', () => {
    store.loadInbox().subscribe();
    httpMock.expectOne(`${base}/inbox`).flush(envelope([capture]));
    expect(store.inbox()).toEqual([capture]);

    store.loadInbox().subscribe();
    httpMock.expectOne(`${base}/inbox`).flush(envelope(null));
    expect(store.inbox()).toEqual([capture]);
    expect(store.error()).toBeNull();
  });

  it('an older overlapping inbox response never overwrites a newer one', () => {
    store.loadInbox().subscribe(); // seq 1 (older)
    store.loadInbox().subscribe(); // seq 2 (newer)
    const reqs = httpMock.match(`${base}/inbox`);
    expect(reqs).toHaveLength(2);
    const [olderReq, newerReq] = reqs;

    const fresh: ReadingCapture = { ...capture, text: 'A newer stoic thought.' };
    newerReq.flush(envelope([fresh]));
    expect(store.inbox()).toEqual([fresh]);

    olderReq.flush(envelope([capture]));
    expect(store.inbox()).toEqual([fresh]);
  });

  it('an inbox load failure preserves the last good inbox, surfaces a concise error, and never rethrows', () => {
    store.loadInbox().subscribe();
    httpMock.expectOne(`${base}/inbox`).flush(envelope([capture]));

    let completed = false;
    let streamError: unknown;
    store.loadInbox().subscribe({ complete: () => (completed = true), error: (e) => (streamError = e) });
    httpMock.expectOne(`${base}/inbox`).flush(
      { title: 'Unavailable' },
      { status: 503, statusText: 'Service Unavailable' }
    );

    expect(store.inbox()).toEqual([capture]);
    expect(store.error()).toBe('Unable to load inbox: Unavailable');
    expect(completed).toBe(true); // refresh convention: completes without emitting
    expect(streamError).toBeUndefined();
  });

  it('a successful inbox load clears a prior inbox load error', () => {
    store.loadInbox().subscribe();
    httpMock.expectOne(`${base}/inbox`).error(new ProgressEvent('error'));
    expect(store.error()).toBe('Unable to load inbox: network error');

    store.loadInbox().subscribe();
    httpMock.expectOne(`${base}/inbox`).flush(envelope([capture]));
    expect(store.error()).toBeNull();
    expect(store.inbox()).toEqual([capture]);
  });

  it('inbox and history loads are independent resources', () => {
    let inboxEmitted: ReadingCapture[] | undefined;
    let historyEmitted: ReadingSession[] | undefined;
    store.loadInbox().subscribe((v) => (inboxEmitted = v));
    store.loadHistory().subscribe((v) => (historyEmitted = v));

    httpMock.expectOne(`${base}/sessions`).flush(envelope([pausedSession]));
    expect(store.history()).toEqual([pausedSession]);
    expect(historyEmitted).toEqual([pausedSession]);
    expect(store.inbox()).toEqual([]); // untouched by history

    httpMock.expectOne(`${base}/inbox`).flush(envelope([capture]));
    expect(store.inbox()).toEqual([capture]);
    expect(inboxEmitted).toEqual([capture]);
    expect(store.history()).toEqual([pausedSession]); // untouched by inbox
  });

  it('disconnect() keeps loaded inbox/history; no polling or listeners for these reads', () => {
    store.loadInbox().subscribe();
    httpMock.expectOne(`${base}/inbox`).flush(envelope([capture]));
    store.loadHistory().subscribe();
    httpMock.expectOne(`${base}/sessions`).flush(envelope([pausedSession]));

    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();
    store.disconnect();
    expect(store.inbox()).toEqual([capture]);
    expect(store.history()).toEqual([pausedSession]);

    // The 30s timer drives the dashboard refresh only — never inbox/history.
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();
    vi.advanceTimersByTime(30_000);
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expectLease().flush([]);
    expect(httpMock.match(`${base}/inbox`)).toHaveLength(0);
    expect(httpMock.match(`${base}/sessions`)).toHaveLength(0);
  });

  // --- display-only elapsed seconds ---

  it('ticks once per second from the server anchor while the session is Active', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();
    expect(store.displayedElapsedSeconds()).toBe(900);

    vi.advanceTimersByTime(5_000);
    expect(store.displayedElapsedSeconds()).toBe(905);

    vi.advanceTimersByTime(1_000);
    expect(store.displayedElapsedSeconds()).toBe(906);
  });

  it('paused, planned, awaiting-feedback, and completed sessions never tick', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard({ openSession: pausedSession })));
    flushLease();
    expect(store.displayedElapsedSeconds()).toBe(1200);
    vi.advanceTimersByTime(10_000);
    expect(store.displayedElapsedSeconds()).toBe(1200);

    // Planned session: no ticking either.
    const planned = dashboard({ openSession: { ...session, status: ReadingSessionStatus.Planned } });
    store.refresh();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(planned));
    expect(store.displayedElapsedSeconds()).toBe(900);
    vi.advanceTimersByTime(10_000);
    expect(store.displayedElapsedSeconds()).toBe(900);
  });

  it('a server refresh re-anchors the display to the new measuredSeconds', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();
    vi.advanceTimersByTime(10_000);
    expect(store.displayedElapsedSeconds()).toBe(910);

    // 30s authoritative refresh reports server-measured 950 seconds.
    vi.advanceTimersByTime(20_000);
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard({ openSession: { ...session, measuredSeconds: 950 } })));
    expectLease().flush([]);
    expect(store.displayedElapsedSeconds()).toBe(950);

    vi.advanceTimersByTime(3_000);
    expect(store.displayedElapsedSeconds()).toBe(953);
  });

  it('clamps a client clock moving backwards to zero added seconds', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();

    // Move the (fake) client clock backwards relative to the anchor time.
    vi.setSystemTime(Date.now() - 5_000);
    vi.advanceTimersByTime(1_000);
    expect(store.displayedElapsedSeconds()).toBe(900);
  });

  it('freezes displayed time while disconnected and excludes offline wall time on reconnect', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();
    vi.advanceTimersByTime(5_000);
    expect(store.displayedElapsedSeconds()).toBe(905);

    store.disconnect();
    vi.advanceTimersByTime(60_000);
    expect(store.displayedElapsedSeconds()).toBe(905);

    store.connect();
    expect(store.displayedElapsedSeconds()).toBe(905);
    httpMock.expectOne(`${base}/dashboard`).flush(
      envelope(dashboard({ openSession: { ...session, measuredSeconds: 970 } }))
    );
    flushLease();
    expect(store.displayedElapsedSeconds()).toBe(970);
  });

  // --- commands ---

  it('initialize forwards the request unchanged, records the reply, and refreshes after success', () => {
    const request = { clientId, idempotencyKey };
    const result = envelope(programme, { reply: 'programme initialized', stateVersion: '1' });

    let emitted: ReadingCommandResult<ReadingProgramme> | undefined;
    store.initialize(request).subscribe((r) => (emitted = r));
    expect(store.mutating()).toBe(true);

    const cmd = httpMock.expectOne(`${base}/initialize`);
    expect(cmd.request.method).toBe('POST');
    expect(cmd.request.body).toEqual(request);
    expect(cmd.request.body).toBe(request); // forwarded unchanged, no generated keys
    cmd.flush(result);

    // The authoritative dashboard refresh follows a successful command.
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));

    expect(emitted).toBe(result);
    expect(store.lastReply()).toBe('programme initialized');
    expect(store.mutating()).toBe(false);
    expect(store.error()).toBeNull();
    expect(store.dashboard()).toEqual(dashboard());
  });

  it('keeps commands cold until subscription', () => {
    const command$ = store.pauseSession({ clientId, idempotencyKey });
    expect(store.mutating()).toBe(false);
    expect(httpMock.match(sessionCommandUrl('pause'))).toHaveLength(0);

    command$.subscribe();
    expect(store.mutating()).toBe(true);
    httpMock.expectOne(sessionCommandUrl('pause')).flush(envelope(pausedSession));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard({ openSession: pausedSession })));
    expect(store.mutating()).toBe(false);
  });

  it('still emits a committed command result when its follow-up dashboard refresh fails', () => {
    const result = envelope(pausedSession, { reply: 'session paused' });
    let emitted: ReadingCommandResult<ReadingSession> | undefined;
    let streamError: unknown;

    store.pauseSession({ clientId, idempotencyKey }).subscribe({
      next: (value) => (emitted = value),
      error: (error) => (streamError = error),
    });
    httpMock.expectOne(sessionCommandUrl('pause')).flush(result);
    httpMock.expectOne(`${base}/dashboard`).flush(
      { title: 'Unavailable' },
      { status: 503, statusText: 'Service Unavailable' }
    );

    expect(emitted).toBe(result);
    expect(streamError).toBeUndefined();
    expect(store.lastReply()).toBe('session paused');
    expect(store.error()).toBe('Unable to load dashboard: Unavailable');
    expect(store.mutating()).toBe(false);
  });

  it('session commands forward the exact request and refresh only after success', () => {
    const baseCommand = { clientId, idempotencyKey };
    const planRequest = { ...baseCommand, bookAssignmentId: assignmentId, mode: ReadingMode.Endurance, targetMinutes: 40 };
    const rateRequest = { ...baseCommand, idempotencyKey: 'key-2', effort: 6, focus: 7, rating: 4 };

    let planned: ReadingCommandResult<ReadingSession> | undefined;
    let paused: ReadingCommandResult<ReadingSession> | undefined;
    let rated: ReadingCommandResult<ReadingSession> | undefined;

    store.planSession(planRequest).subscribe((r) => (planned = r));
    let req = httpMock.expectOne(`${base}/sessions/plan`);
    expect(req.request.body).toEqual(planRequest);
    req.flush(envelope(session, { reply: 'session planned' }));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));

    store.pauseSession(baseCommand).subscribe((r) => (paused = r));
    req = httpMock.expectOne(sessionCommandUrl('pause'));
    expect(req.request.body).toEqual(baseCommand);
    req.flush(envelope({ ...session, status: ReadingSessionStatus.Paused }));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard({ openSession: pausedSession })));

    store.rateSession(rateRequest).subscribe((r) => (rated = r));
    req = httpMock.expectOne(sessionCommandUrl('rate'));
    expect(req.request.body).toEqual(rateRequest);
    req.flush(envelope({ ...session, effort: 6, focus: 7, rating: 4 }));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));

    expect(planned?.data?.status).toBe(ReadingSessionStatus.Active);
    expect(paused?.data?.status).toBe(ReadingSessionStatus.Paused);
    expect(rated?.data?.rating).toBe(4);
    expect(store.lastReply()).toBe('ok');
    expect(store.mutating()).toBe(false);
  });

  it('capture and resolveCapture forward the exact requests and refresh after success', () => {
    const captureRequest = {
      clientId,
      idempotencyKey,
      text: 'A stoic thought.',
      type: ReadingCaptureType.Thought,
      bookId,
      sessionId,
    };
    const resolveRequest = { clientId, idempotencyKey: 'key-2', keep: true, noteId };

    let created: ReadingCommandResult<ReadingCapture> | undefined;
    let resolved: ReadingCommandResult<ReadingCapture> | undefined;

    store.capture(captureRequest).subscribe((r) => (created = r));
    let req = httpMock.expectOne(`${base}/captures`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(captureRequest);
    req.flush(envelope(capture, { reply: 'capture saved' }));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));

    store.resolveCapture(captureId, resolveRequest).subscribe((r) => (resolved = r));
    req = httpMock.expectOne(`${base}/captures/${captureId}`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual(resolveRequest);
    req.flush(envelope({ ...capture, resolved: true }));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));

    expect(created?.data?.text).toBe('A stoic thought.');
    expect(resolved?.data?.resolved).toBe(true);
    expect(store.mutating()).toBe(false);
  });

  it('commitWeeklyReview forwards year/week and refreshes after success', () => {
    const request = { clientId, idempotencyKey, year: 2026, week: 33 };
    const result = envelope(review, { reply: 'week committed', stateVersion: '18' });

    let emitted: ReadingCommandResult<ReadingWeeklyReview> | undefined;
    store.commitWeeklyReview(request).subscribe((r) => (emitted = r));

    const cmd = httpMock.expectOne(`${base}/reviews/commit`);
    expect(cmd.request.body).toEqual(request);
    cmd.flush(result);
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));

    expect(emitted).toBe(result);
    expect(emitted?.data?.modes[0].decisionKind).toBe('increase');
    expect(store.lastReply()).toBe('week committed');
  });

  it('a rejected command does not refresh or retry and preserves the dashboard', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();
    expect(store.error()).toBeNull();

    let error: unknown;
    store.pauseSession({ clientId, idempotencyKey }).subscribe({ error: (e) => (error = e) });

    const cmd = httpMock.expectOne(sessionCommandUrl('pause'));
    cmd.flush(
      { reply: 'Cannot pause: no active session', data: { code: 'invalid_transition' }, stateVersion: '17', duplicate: false },
      { status: 409, statusText: 'Conflict' }
    );

    expect(error).toBeInstanceOf(HttpErrorResponse);
    expect(httpMock.match(`${base}/dashboard`)).toHaveLength(0); // no refresh after rejection
    expect(matchLeases()).toHaveLength(0);
    expect(store.error()).toBe('Failed to pause session: invalid_transition');
    expect(store.dashboard()).toEqual(dashboard()); // last good dashboard preserved
    expect(store.lastReply()).toBeNull(); // only successful commands record a reply
    expect(store.mutating()).toBe(false);
  });

  it('a network error while refreshing preserves the last good dashboard and exposes a concise error', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();

    window.dispatchEvent(new Event('focus'));
    httpMock.expectOne(`${base}/dashboard`).error(new ProgressEvent('error'));
    expectLease().flush([]);

    expect(store.dashboard()).toEqual(dashboard());
    expect(store.error()).toBe('Unable to load dashboard: network error');
    expect(store.loading()).toBe(false);
  });

  it('not_initialized leaves the dashboard null without fabricating a programme', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(
      { reply: 'not initialized', data: { code: 'not_initialized' }, stateVersion: '0', duplicate: false },
      { status: 409, statusText: 'Conflict' }
    );
    flushLease();

    expect(store.dashboard()).toBeNull();
    expect(store.programme()).toBeNull();
    expect(store.books()).toEqual([]);
    expect(store.openSession()).toBeNull();
    expect(store.displayedElapsedSeconds()).toBe(0);
    expect(store.stateVersion()).toBeNull(); // no successful envelope: no version identity
    expect(store.error()).toBe('Unable to load dashboard: not_initialized');
    expect(store.loading()).toBe(false);
  });

  it('successful inbox and history loads never clear a dashboard not_initialized error', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(
      { reply: 'not initialized', data: { code: 'not_initialized' }, stateVersion: '0', duplicate: false },
      { status: 409, statusText: 'Conflict' }
    );
    flushLease();
    expect(store.error()).toBe('Unable to load dashboard: not_initialized');

    store.loadInbox().subscribe();
    httpMock.expectOne(`${base}/inbox`).flush(envelope([capture]));
    store.loadHistory().subscribe();
    httpMock.expectOne(`${base}/sessions`).flush(envelope([pausedSession]));

    expect(store.inbox()).toEqual([capture]);
    expect(store.history()).toEqual([pausedSession]);
    expect(store.error()).toBe('Unable to load dashboard: not_initialized');
  });

  it('an HTTP-200 semantic error envelope never becomes a dashboard or advances the retained state version', () => {
    store.connect();
    // Real-wire shape (reproduced end-to-end against a fresh backend): the
    // dashboard GET answers 200 with the stable envelope carrying
    // `data: { code: 'not_initialized' }` — not an HttpErrorResponse.
    httpMock.expectOne(`${base}/dashboard`).flush({
      reply: 'not initialized',
      data: { code: 'not_initialized' },
      stateVersion: '0',
      duplicate: false,
    });
    flushLease();

    expect(store.dashboard()).toBeNull();
    expect(store.programme()).toBeNull();
    expect(store.books()).toEqual([]);
    expect(store.openSession()).toBeNull();
    expect(store.displayedElapsedSeconds()).toBe(0);
    expect(store.stateVersion()).toBeNull(); // no successful envelope: no version identity
    expect(store.error()).toBe('Unable to load dashboard: not_initialized');
    expect(store.loading()).toBe(false);
  });

  it('an HTTP-200 semantic error envelope after a good dashboard preserves dashboard and retained version', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();
    expect(store.stateVersion()).toBe('17');

    window.dispatchEvent(new Event('focus'));
    httpMock.expectOne(`${base}/dashboard`).flush({
      reply: 'not initialized',
      data: { code: 'not_initialized' },
      stateVersion: '0',
      duplicate: false,
    });
    expectLease().flush([]);

    expect(store.dashboard()).toEqual(dashboard());
    expect(store.stateVersion()).toBe('17'); // semantic failure never advances the retained version
    expect(store.error()).toBe('Unable to load dashboard: not_initialized');
    expect(store.loading()).toBe(false);
  });

  it('errors clear on the next successful refresh', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).error(new ProgressEvent('error'));
    flushLease();
    expect(store.error()).toBe('Unable to load dashboard: network error');

    window.dispatchEvent(new Event('focus'));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expectLease().flush([]);
    expect(store.error()).toBeNull();
  });

  it('serializes mutations: a concurrent command fails deterministically with mutation_in_progress', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();

    const planRequest = { clientId, idempotencyKey, bookAssignmentId: assignmentId, mode: ReadingMode.Endurance, targetMinutes: 40 };
    let planned: ReadingCommandResult<ReadingSession> | undefined;
    store.planSession(planRequest).subscribe((r) => (planned = r));
    expect(store.mutating()).toBe(true);

    // Second mutation while the first is in flight: deterministic rejection,
    // no HTTP request is issued.
    let concurrentError: unknown;
    store.pauseSession({ clientId, idempotencyKey: 'key-2' }).subscribe({ error: (e) => (concurrentError = e) });
    expect(concurrentError).toBeInstanceOf(Error);
    expect((concurrentError as Error).message).toBe('mutation_in_progress');
    expect(httpMock.match(sessionCommandUrl('pause'))).toHaveLength(0);
    expect(store.error()).toBeNull();

    // The first command still completes normally and refreshes.
    httpMock.expectOne(`${base}/sessions/plan`).flush(envelope(session));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expect(planned?.data).toEqual(session);
    expect(store.mutating()).toBe(false);

    // Once the lock is released, the next mutation runs normally.
    store.pauseSession({ clientId, idempotencyKey: 'key-2' }).subscribe();
    httpMock.expectOne(sessionCommandUrl('pause')).flush(envelope({ ...session, status: ReadingSessionStatus.Paused }));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expect(store.mutating()).toBe(false);
  });

  it('a command HTTP failure releases the mutation lock without refreshing', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();

    let error: unknown;
    store.rateSession({ clientId, idempotencyKey, effort: 6, focus: 7 }).subscribe({ error: (e) => (error = e) });
    expect(store.mutating()).toBe(true);

    httpMock.expectOne(sessionCommandUrl('rate')).error(new ProgressEvent('error'));
    expect(error).toBeInstanceOf(HttpErrorResponse);
    expect(httpMock.match(`${base}/dashboard`)).toHaveLength(0);
    expect(store.error()).toBe('Failed to rate session: network error');
    expect(store.mutating()).toBe(false);
    expect(store.dashboard()).toEqual(dashboard());
  });

  it('releases the lock before emitting a result so a follow-up command starts from the result handler', () => {
    let completeEmitted: ReadingCommandResult<ReadingSession> | undefined;
    let rateEmitted: ReadingCommandResult<ReadingSession> | undefined;
    let rateError: unknown;

    store
      .completeSession({ clientId, idempotencyKey, reportedMinutes: 25 })
      .subscribe({
        next: (result) => {
          completeEmitted = result;
          // The page's onRate flow: the second command must be able to start
          // from the first command's result handler without hitting
          // mutation_in_progress.
          store
            .rateSession({ clientId, idempotencyKey: 'key-2', effort: 6, focus: 7 })
            .subscribe({
              next: (rated) => (rateEmitted = rated),
              error: (e) => (rateError = e),
            });
        },
        error: () => void 0,
      });

    const completeReq = httpMock.expectOne(sessionCommandUrl('complete'));
    expect(completeReq.request.method).toBe('POST');
    completeReq.flush(envelope({ ...session, status: ReadingSessionStatus.AwaitingFeedback }, { reply: 'session completed' }));

    // The lock stays held through the first command's authoritative refresh...
    expect(store.mutating()).toBe(true);
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expect(completeEmitted).toBeDefined();

    // ...then the rate POST is issued from the result handler, no mutation error.
    expect(rateError).toBeUndefined();
    const rateReq = httpMock.expectOne(sessionCommandUrl('rate'));
    expect(rateReq.request.method).toBe('POST');
    expect(rateReq.request.body).toEqual({ clientId, idempotencyKey: 'key-2', effort: 6, focus: 7 });
    expect(store.mutating()).toBe(true); // the second command holds the lock now

    // Refresh-before-result for the second command: still in flight after the
    // POST, so no result yet and the lock is still held.
    rateReq.flush(envelope({ ...session, effort: 6, focus: 7 }, { reply: 'session rated' }));
    expect(rateEmitted).toBeUndefined();
    expect(store.mutating()).toBe(true);

    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expect(rateEmitted).toBeDefined();
    expect(rateEmitted?.data?.effort).toBe(6);
    expect(store.lastReply()).toBe('session rated');
    expect(store.mutating()).toBe(false);
  });

  it('releases the lock before a command error is delivered, so a follow-up command can start from the error handler', () => {
    let followUpEmitted = false;
    let followUpError: unknown;

    store
      .completeSession({ clientId, idempotencyKey, reportedMinutes: 25 })
      .subscribe({
        error: () => {
          // Store contract: the lock is already released before the error is
          // delivered. The page deliberately sends no follow-up on failure,
          // but the store must not keep rejecting the next mutation.
          store
            .rateSession({ clientId, idempotencyKey: 'key-2', effort: 6, focus: 7 })
            .subscribe({
              next: () => (followUpEmitted = true),
              error: (e) => (followUpError = e),
            });
        },
        next: () => void 0,
      });

    httpMock.expectOne(sessionCommandUrl('complete')).flush(
      { reply: 'Cannot complete: no active session', data: { code: 'invalid_transition' }, stateVersion: '17', duplicate: false },
      { status: 409, statusText: 'Conflict' }
    );

    expect(followUpError).toBeUndefined();
    httpMock.expectOne(sessionCommandUrl('rate')).flush(envelope({ ...session, effort: 6, focus: 7 }, { reply: 'session rated' }));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expect(followUpEmitted).toBe(true);
    expect(store.mutating()).toBe(false);
  });

  it('a command factory that throws synchronously still releases the mutation lock', () => {
    const service = TestBed.inject(ReadingTrainingService);
    vi.spyOn(service, 'pauseSession').mockImplementation(() => {
      throw new Error('command factory exploded');
    });

    let error: unknown;
    store.pauseSession({ clientId, idempotencyKey }).subscribe({ error: (e) => (error = e) });
    expect((error as Error).message).toBe('command factory exploded');
    expect(store.error()).toBe('Failed to pause session: command factory exploded');
    expect(store.mutating()).toBe(false);
    expect(httpMock.match(sessionCommandUrl('pause'))).toHaveLength(0);
  });

  it('a command that completes without emitting still releases the mutation lock', () => {
    const service = TestBed.inject(ReadingTrainingService);
    vi.spyOn(service, 'pauseSession').mockReturnValue(EMPTY);

    let completed = false;
    store.pauseSession({ clientId, idempotencyKey }).subscribe({ complete: () => (completed = true) });
    expect(completed).toBe(true);
    expect(store.mutating()).toBe(false);
    expect(httpMock.match(sessionCommandUrl('pause'))).toHaveLength(0);
  });

  // --- optimistic queue mutations: change mode ---

  function changeData(overrides: Partial<ReadingChangeBookModeData> = {}): ReadingChangeBookModeData {
    return {
      assignmentId,
      bookId,
      previousMode: ReadingMode.Endurance,
      mode: ReadingMode.Deep,
      queueOrder: 0,
      defaultSlot: null,
      collisionAbsorbed: false,
      absorbedAssignmentId: null,
      ...overrides,
    };
  }

  function removeData(overrides: Partial<ReadingRemoveBookAssignmentData> = {}): ReadingRemoveBookAssignmentData {
    return {
      assignmentId,
      bookId,
      mode: ReadingMode.Endurance,
      queueOrder: 0,
      ...overrides,
    };
  }

  it('exposes the queue-mutation pending ids read-only and idle initially', () => {
    expect(store.changingModeAssignmentId()).toBeNull();
    expect(store.removingAssignmentId()).toBeNull();
    // asReadonly() surfaces the signals without the writable API.
    expect((store.changingModeAssignmentId as { set?: unknown }).set).toBeUndefined();
    expect((store.removingAssignmentId as { set?: unknown }).set).toBeUndefined();
  });

  it('changeBookMode applies the mode optimistically, preserves order, clears the old default, and reconciles from the envelope', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();
    expect(store.stateVersion()).toBe('17');

    const result = envelope(changeData(), { reply: 'Meditations moved to Deep.', stateVersion: '18' });
    let emitted: ReadingCommandResult<ReadingChangeBookModeData> | undefined;
    store.changeBookMode(assignmentId, ReadingMode.Deep).subscribe((r) => (emitted = r));

    // Optimistic projection applied synchronously on subscribe.
    expect(store.mutating()).toBe(true);
    expect(store.changingModeAssignmentId()).toBe(assignmentId);
    expect(store.books()[0]).toEqual({ ...assignment, mode: ReadingMode.Deep, isDefault: false });
    // Queue order and array order preserved; unrelated rows keep exact identity.
    expect(store.books().map((b) => b.id)).toEqual([
      assignmentId,
      queuedAssignment.id,
      completedAssignment.id,
      deepAssignment.id,
    ]);
    expect(store.books()[1]).toBe(queuedAssignment);
    expect(store.books()[3]).toBe(deepAssignment);

    const req = httpMock.expectOne(`${base}/books/${assignmentId}/mode`);
    expect(req.request.method).toBe('PATCH');
    req.flush(result);

    expect(emitted).toBe(result); // exact envelope forwarded
    expect(store.stateVersion()).toBe('18');
    expect(store.lastReply()).toBe('Meditations moved to Deep.');
    expect(store.mutating()).toBe(false);
    expect(store.changingModeAssignmentId()).toBeNull();
    expect(store.error()).toBeNull();
    // Reconcile: server mode + order, defaultSlot null → not the mode default.
    expect(store.books()[0]).toEqual({ ...assignment, mode: ReadingMode.Deep, isDefault: false });
    expect(store.defaultBookForMode(ReadingMode.Deep)?.id).toBe(deepAssignmentId);
    expect(store.defaultBookForMode(ReadingMode.Endurance)).toBeNull();
  });

  it('changeBookMode drops the absorbed collider row and inherits the target default from the server data', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();

    const result = envelope(
      changeData({ defaultSlot: 'deep', collisionAbsorbed: true, absorbedAssignmentId: deepAssignmentId }),
      { reply: 'Meditations moved to Deep. Duplicate queue entry removed.', stateVersion: '18' }
    );
    store.changeBookMode(assignmentId, ReadingMode.Deep).subscribe();
    httpMock.expectOne(`${base}/books/${assignmentId}/mode`).flush(result);

    const books = store.books();
    expect(books.some((b) => b.id === deepAssignmentId)).toBe(false); // collider removed
    expect(books.map((b) => b.id)).toEqual([assignmentId, queuedAssignment.id, completedAssignment.id]);
    const moved = books.find((b) => b.id === assignmentId);
    expect(moved?.mode).toBe(ReadingMode.Deep);
    expect(moved?.isDefault).toBe(true); // inherited the absorbed collider's default
    expect(moved?.queueOrder).toBe(0);
    expect(store.defaultBookForMode(ReadingMode.Deep)?.id).toBe(assignmentId);
  });

  it('changeBookMode creates clientId and a fresh idempotencyKey per command, PATCHing only the mode', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();

    store.changeBookMode(assignmentId, ReadingMode.Deep).subscribe();
    let req = httpMock.expectOne(`${base}/books/${assignmentId}/mode`);
    expect(req.request.method).toBe('PATCH');
    const body = req.request.body as ReadingChangeBookModeRequest;
    expect(body.mode).toBe(ReadingMode.Deep);
    expect(typeof body.clientId).toBe('string');
    expect(body.clientId.length).toBeGreaterThan(0);
    expect(typeof body.idempotencyKey).toBe('string');
    expect(body.idempotencyKey.length).toBeGreaterThan(0);
    // The assignment id lives in the URL; the body never carries it.
    expect(body).not.toHaveProperty('assignmentId');
    const firstKey = body.idempotencyKey;
    req.flush(envelope(changeData(), { stateVersion: '18' }));
    expect(store.mutating()).toBe(false);

    // The next command gets a fresh idempotency key.
    store.changeBookMode(assignmentId, ReadingMode.Recovery).subscribe();
    req = httpMock.expectOne(`${base}/books/${assignmentId}/mode`);
    const secondKey = (req.request.body as ReadingChangeBookModeRequest).idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
    req.flush(envelope(changeData({ mode: ReadingMode.Recovery }), { stateVersion: '19' }));
    expect(store.stateVersion()).toBe('19');
  });

  it('changeBookMode ignores a same-mode selection without issuing a request', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();

    let emitted = false;
    let completed = false;
    store.changeBookMode(assignmentId, ReadingMode.Endurance).subscribe({
      next: () => (emitted = true),
      complete: () => (completed = true),
    });

    expect(emitted).toBe(false);
    expect(completed).toBe(true); // no-op: completes without emitting
    expect(httpMock.match(`${base}/books/${assignmentId}/mode`)).toHaveLength(0);
    expect(store.mutating()).toBe(false);
    expect(store.changingModeAssignmentId()).toBeNull();
    expect(store.dashboard()).toEqual(dashboard()); // untouched
    expect(store.error()).toBeNull();
  });

  it('changeBookMode restores the full snapshot on an HTTP failure and surfaces the error', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();
    const original = dashboard();

    let error: unknown;
    store.changeBookMode(assignmentId, ReadingMode.Deep).subscribe({ error: (e) => (error = e) });
    expect(store.books()[0].mode).toBe(ReadingMode.Deep); // optimistic while in flight

    httpMock.expectOne(`${base}/books/${assignmentId}/mode`).flush(
      { title: 'Unavailable' },
      { status: 503, statusText: 'Service Unavailable' }
    );

    expect(error).toBeInstanceOf(HttpErrorResponse);
    expect(store.books()).toEqual(original.books); // exact snapshot restored
    expect(store.dashboard()).toEqual(original);
    expect(store.error()).toBe('Failed to change book mode: Unavailable');
    expect(store.mutating()).toBe(false);
    expect(store.changingModeAssignmentId()).toBeNull();
    expect(store.stateVersion()).toBe('17'); // failure never advances the version
    expect(httpMock.match(`${base}/dashboard`)).toHaveLength(0); // no refresh after failure
  });

  it('changeBookMode restores the full snapshot on a semantic rejection and surfaces its code', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();
    const original = dashboard();

    let error: unknown;
    store.changeBookMode(assignmentId, ReadingMode.Deep).subscribe({ error: (e) => (error = e) });

    httpMock.expectOne(`${base}/books/${assignmentId}/mode`).flush(
      {
        reply: 'Meditations has sessions and cannot be changed.',
        data: { code: 'assignment_has_sessions' },
        stateVersion: '17',
        duplicate: false,
      },
      { status: 409, statusText: 'Conflict' }
    );

    expect(error).toBeInstanceOf(HttpErrorResponse);
    expect(store.books()).toEqual(original.books);
    expect(store.error()).toBe('Failed to change book mode: assignment_has_sessions');
    expect(store.mutating()).toBe(false);
    expect(store.changingModeAssignmentId()).toBeNull();
    expect(store.stateVersion()).toBe('17');
  });

  it('changeBookMode serializes with other mutations: a concurrent command fails with mutation_in_progress', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();

    store.changeBookMode(assignmentId, ReadingMode.Deep).subscribe();
    expect(store.mutating()).toBe(true);

    let concurrentError: unknown;
    store.removeBookAssignment(queuedAssignment.id).subscribe({ error: (e) => (concurrentError = e) });
    expect(concurrentError).toBeInstanceOf(Error);
    expect((concurrentError as Error).message).toBe('mutation_in_progress');
    expect(httpMock.match(`${base}/books/${queuedAssignment.id}`)).toHaveLength(0);
    expect(store.error()).toBeNull();

    // The first command still completes normally.
    httpMock.expectOne(`${base}/books/${assignmentId}/mode`).flush(envelope(changeData(), { stateVersion: '18' }));
    expect(store.mutating()).toBe(false);
    expect(store.changingModeAssignmentId()).toBeNull();
  });

  it('changeBookMode releases the pending id on early unsubscription', () => {
    const service = TestBed.inject(ReadingTrainingService);
    const subject = new Subject<ReadingCommandResult<ReadingChangeBookModeData>>();
    vi.spyOn(service, 'changeBookMode').mockReturnValue(subject);

    const sub = store.changeBookMode(assignmentId, ReadingMode.Deep).subscribe();
    expect(store.changingModeAssignmentId()).toBe(assignmentId);
    expect(store.mutating()).toBe(true);

    sub.unsubscribe();
    expect(store.changingModeAssignmentId()).toBeNull();
    expect(store.mutating()).toBe(false);

    // A late result must not resurrect pending state or advance the version.
    subject.next(envelope(changeData(), { stateVersion: '18' }));
    subject.complete();
    expect(store.changingModeAssignmentId()).toBeNull();
    expect(store.stateVersion()).toBeNull();
  });

  // --- optimistic queue mutations: remove ---

  it('removeBookAssignment removes the row optimistically without renumbering', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();

    const result = envelope(removeData(), { reply: 'Meditations removed from the queue.', stateVersion: '18' });
    let emitted: ReadingCommandResult<ReadingRemoveBookAssignmentData> | undefined;
    store.removeBookAssignment(assignmentId).subscribe((r) => (emitted = r));

    expect(store.mutating()).toBe(true);
    expect(store.removingAssignmentId()).toBe(assignmentId);
    // Row removed immediately; survivors keep their exact orders (no renumbering).
    expect(store.books().map((b) => b.id)).toEqual([
      queuedAssignment.id,
      completedAssignment.id,
      deepAssignment.id,
    ]);
    expect(store.books()[0]).toBe(queuedAssignment);
    expect(queuedAssignment.queueOrder).toBe(1);

    const req = httpMock.expectOne(`${base}/books/${assignmentId}`);
    expect(req.request.method).toBe('DELETE');
    const body = req.request.body as ReadingRemoveBookAssignmentRequest;
    expect(typeof body.clientId).toBe('string');
    expect(body.clientId.length).toBeGreaterThan(0);
    expect(typeof body.idempotencyKey).toBe('string');
    expect(body.idempotencyKey.length).toBeGreaterThan(0);
    req.flush(result);

    expect(emitted).toBe(result); // exact envelope forwarded
    expect(store.stateVersion()).toBe('18');
    expect(store.lastReply()).toBe('Meditations removed from the queue.');
    expect(store.mutating()).toBe(false);
    expect(store.removingAssignmentId()).toBeNull();
    expect(store.error()).toBeNull();
  });

  it('removeBookAssignment restores the snapshot on an HTTP failure and clears pending state', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();
    const original = dashboard();

    let error: unknown;
    store.removeBookAssignment(assignmentId).subscribe({ error: (e) => (error = e) });
    expect(store.books().some((b) => b.id === assignmentId)).toBe(false); // optimistic

    httpMock.expectOne(`${base}/books/${assignmentId}`).error(new ProgressEvent('error'));

    expect(error).toBeInstanceOf(HttpErrorResponse);
    expect(store.books()).toEqual(original.books); // exact snapshot restored
    expect(store.error()).toBe('Failed to remove book assignment: network error');
    expect(store.mutating()).toBe(false);
    expect(store.removingAssignmentId()).toBeNull();
    expect(store.stateVersion()).toBe('17');
  });

  it('removeBookAssignment restores the snapshot on a semantic rejection and surfaces its code', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();
    const original = dashboard();

    let error: unknown;
    store.removeBookAssignment(assignmentId).subscribe({ error: (e) => (error = e) });

    httpMock.expectOne(`${base}/books/${assignmentId}`).flush(
      {
        reply: 'Meditations has sessions and cannot be removed.',
        data: { code: 'assignment_has_sessions' },
        stateVersion: '17',
        duplicate: false,
      },
      { status: 409, statusText: 'Conflict' }
    );

    expect(error).toBeInstanceOf(HttpErrorResponse);
    expect(store.books()).toEqual(original.books);
    expect(store.error()).toBe('Failed to remove book assignment: assignment_has_sessions');
    expect(store.mutating()).toBe(false);
    expect(store.removingAssignmentId()).toBeNull();
    expect(store.stateVersion()).toBe('17');
  });

  it('removeBookAssignment reconciles a duplicate replay envelope as success', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    flushLease();

    const result = envelope(removeData(), {
      reply: 'Meditations removed from the queue.',
      stateVersion: '18',
      duplicate: true,
    });
    let emitted: ReadingCommandResult<ReadingRemoveBookAssignmentData> | undefined;
    store.removeBookAssignment(assignmentId).subscribe((r) => (emitted = r));
    httpMock.expectOne(`${base}/books/${assignmentId}`).flush(result);

    expect(emitted?.duplicate).toBe(true);
    expect(store.stateVersion()).toBe('18');
    expect(store.books().some((b) => b.id === assignmentId)).toBe(false); // row stays removed
    expect(store.error()).toBeNull();
    expect(store.mutating()).toBe(false);
    expect(store.removingAssignmentId()).toBeNull();
  });

  // --- pending notifications (lease) ---

  it('starts with empty pendingNotices and idle notification flags, exposed read-only', () => {
    expect(store.pendingNotices()).toEqual([]);
    expect(store.notificationsLoading()).toBe(false);
    expect(store.acknowledgingNotificationId()).toBeNull();
    expect(store.notificationsBusy()).toBe(false);
    // asReadonly() surfaces signals without the writable API.
    expect((store.pendingNotices as { set?: unknown }).set).toBeUndefined();
    expect((store.notificationsLoading as { set?: unknown }).set).toBeUndefined();
    expect((store.acknowledgingNotificationId as { set?: unknown }).set).toBeUndefined();
  });

  it('loadNotifications is cold and leases with the default maxCount/leaseSeconds', () => {
    const lease$ = store.loadNotifications();
    expect(matchLeases()).toHaveLength(0);
    expect(store.notificationsLoading()).toBe(false);

    let emitted: ReadingNotification[] | undefined;
    lease$.subscribe((v) => (emitted = v));
    expect(store.notificationsLoading()).toBe(true);

    const req = expectLease();
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('maxCount')).toBe('10');
    expect(req.request.params.get('leaseSeconds')).toBe('60');
    req.flush([notice(noticeId1)]);

    expect(emitted).toEqual([notice(noticeId1)]);
    expect(store.pendingNotices()).toEqual([notice(noticeId1)]);
    expect(store.notificationsLoading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('loadNotifications forwards explicit maxCount/leaseSeconds unchanged', () => {
    store.loadNotifications(5, 120).subscribe();
    const req = expectLease();
    expect(req.request.params.get('maxCount')).toBe('5');
    expect(req.request.params.get('leaseSeconds')).toBe('120');
    req.flush([]);
    expect(store.pendingNotices()).toEqual([]);
  });

  it('merges newly leased rows into displayed unacknowledged rows by id, keeping exact objects and order', () => {
    store.loadNotifications().subscribe();
    const first = notice(noticeId1);
    expectLease().flush([first]);
    expect(store.pendingNotices()).toEqual([first]);

    // The server re-issues the same id (fresh object) plus one new row.
    const reshown = notice(noticeId1, { leaseUntil: '2026-08-09T19:30:00+02:00' });
    const fresh = notice(noticeId2);
    store.loadNotifications().subscribe();
    expectLease().flush([reshown, fresh]);

    const displayed = store.pendingNotices();
    expect(displayed).toHaveLength(2);
    // The exact displayed object is preserved for the existing id...
    expect(displayed[0]).toBe(first);
    // ...and the new row is appended in server order after the current rows.
    expect(displayed[1]).toBe(fresh);
  });

  it('an empty periodic lease result preserves currently displayed notices', () => {
    store.loadNotifications().subscribe();
    expectLease().flush([notice(noticeId1)]);
    expect(store.pendingNotices()).toHaveLength(1);

    store.loadNotifications().subscribe();
    expectLease().flush([]);
    expect(store.pendingNotices()).toEqual([notice(noticeId1)]); // never hidden before ack
    expect(store.notificationsLoading()).toBe(false);
  });

  it('an older overlapping lease response never overwrites a newer one', () => {
    store.loadNotifications().subscribe(); // seq 1 (older)
    store.loadNotifications().subscribe(); // seq 2 (newer)
    const reqs = matchLeases();
    expect(reqs).toHaveLength(2);
    const [olderReq, newerReq] = reqs;

    newerReq.flush([notice(noticeId2)]);
    expect(store.pendingNotices()).toEqual([notice(noticeId2)]);

    olderReq.flush([notice(noticeId1)]);
    expect(store.pendingNotices()).toEqual([notice(noticeId2)]);
  });

  it('a lease failure preserves displayed notices, surfaces a concise error, and never rethrows', () => {
    store.loadNotifications().subscribe();
    expectLease().flush([notice(noticeId1)]);

    let completed = false;
    let streamError: unknown;
    store.loadNotifications().subscribe({ complete: () => (completed = true), error: (e) => (streamError = e) });
    expectLease().flush(
      { title: 'Unavailable' },
      { status: 503, statusText: 'Service Unavailable' }
    );

    expect(store.pendingNotices()).toEqual([notice(noticeId1)]);
    expect(store.error()).toBe('Unable to load reading notices: Unavailable');
    expect(completed).toBe(true); // refresh convention: completes without emitting
    expect(streamError).toBeUndefined();
    expect(store.notificationsLoading()).toBe(false);
  });

  it('a successful lease clears a prior lease error', () => {
    store.loadNotifications().subscribe();
    expectLease().error(new ProgressEvent('error'));
    expect(store.error()).toBe('Unable to load reading notices: network error');

    store.loadNotifications().subscribe();
    expectLease().flush([notice(noticeId1)]);
    expect(store.error()).toBeNull();
    expect(store.pendingNotices()).toEqual([notice(noticeId1)]);
  });

  it('connect() leases notices immediately alongside the dashboard and then every 30s', () => {
    store.connect();
    expect(store.notificationsLoading()).toBe(true);

    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    const first = expectLease();
    expect(first.request.params.get('maxCount')).toBe('10');
    expect(first.request.params.get('leaseSeconds')).toBe('60');
    first.flush([notice(noticeId1)]);
    expect(store.pendingNotices()).toEqual([notice(noticeId1)]);
    expect(store.notificationsLoading()).toBe(false);

    vi.advanceTimersByTime(29_999);
    expect(matchLeases()).toHaveLength(0);

    vi.advanceTimersByTime(1);
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expectLease().flush([notice(noticeId2)]);
    expect(store.pendingNotices()).toEqual([notice(noticeId1), notice(noticeId2)]);
  });

  it('never issues overlapping notification leases', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    // The immediate lease is still in flight. `match()` consumes it, so keep
    // the request reference while checking that no second lease is created.
    const leases = matchLeases();
    expect(leases).toHaveLength(1);
    const inFlightLease = leases[0];

    // Focus and a 30s tick must not stack a second lease on top of it.
    window.dispatchEvent(new Event('focus'));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    vi.advanceTimersByTime(30_000);
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expect(matchLeases()).toHaveLength(0);

    // Once the in-flight lease lands, the next tick leases again.
    inFlightLease.flush([notice(noticeId1)]);
    vi.advanceTimersByTime(30_000);
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expectLease().flush([notice(noticeId2)]);
    expect(store.pendingNotices()).toEqual([notice(noticeId1), notice(noticeId2)]);
  });

  it('disconnect() stops notices timers/listeners but preserves displayed notices', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expectLease().flush([notice(noticeId1)]);
    expect(store.pendingNotices()).toEqual([notice(noticeId1)]);

    store.disconnect();
    vi.advanceTimersByTime(120_000);
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(httpMock.match(`${base}/dashboard`)).toHaveLength(0);
    expect(matchLeases()).toHaveLength(0);
    expect(store.pendingNotices()).toEqual([notice(noticeId1)]); // preserved
  });

  it('reconnecting after disconnect re-leases notices and restarts the notices lifecycle', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expectLease().flush([notice(noticeId1)]);
    store.disconnect();

    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expectLease().flush([notice(noticeId2)]);
    expect(store.pendingNotices()).toEqual([notice(noticeId1), notice(noticeId2)]);

    vi.advanceTimersByTime(30_000);
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expectLease().flush([]);
    expect(store.pendingNotices()).toEqual([notice(noticeId1), notice(noticeId2)]);
  });

  // --- notification acknowledgement ---

  it('acknowledgeNotification is cold and posts the exact id with no body or idempotency key', () => {
    store.loadNotifications().subscribe();
    expectLease().flush([notice(noticeId1)]);
    expect(store.pendingNotices()).toHaveLength(1);

    const ack$ = store.acknowledgeNotification(noticeId1);
    expect(httpMock.match(`${base}/notifications/${noticeId1}/ack`)).toHaveLength(0);
    expect(store.acknowledgingNotificationId()).toBeNull();

    let emitted: ReadingAckNotificationResult | undefined;
    ack$.subscribe((r) => (emitted = r));
    expect(store.acknowledgingNotificationId()).toBe(noticeId1);
    expect(store.notificationsBusy()).toBe(true);

    const req = httpMock.expectOne(`${base}/notifications/${noticeId1}/ack`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBeNull();
    expect(req.request.params.keys()).toHaveLength(0);
    req.flush({ notificationId: noticeId1, acknowledged: true });

    expect(emitted).toEqual({ notificationId: noticeId1, acknowledged: true });
    expect(store.pendingNotices()).toEqual([]); // removed only after confirmed success
    expect(store.acknowledgingNotificationId()).toBeNull();
    expect(store.notificationsBusy()).toBe(false);
  });

  it('removes only the acknowledged notice, leaving other rows in place', () => {
    store.loadNotifications().subscribe();
    expectLease().flush([notice(noticeId1), notice(noticeId2)]);

    store.acknowledgeNotification(noticeId1).subscribe();
    httpMock.expectOne(`${base}/notifications/${noticeId1}/ack`).flush({ notificationId: noticeId1, acknowledged: true });

    expect(store.pendingNotices()).toEqual([notice(noticeId2)]);
  });

  it('an acknowledged:false response preserves the notice', () => {
    store.loadNotifications().subscribe();
    expectLease().flush([notice(noticeId1)]);

    store.acknowledgeNotification(noticeId1).subscribe();
    httpMock.expectOne(`${base}/notifications/${noticeId1}/ack`).flush({ notificationId: noticeId1, acknowledged: false });

    expect(store.pendingNotices()).toEqual([notice(noticeId1)]); // preserved
    expect(store.acknowledgingNotificationId()).toBeNull();
  });

  it('an ack response for a different notificationId preserves the notice', () => {
    store.loadNotifications().subscribe();
    expectLease().flush([notice(noticeId1)]);

    store.acknowledgeNotification(noticeId1).subscribe();
    httpMock.expectOne(`${base}/notifications/${noticeId1}/ack`).flush({ notificationId: 'other-id', acknowledged: true });

    expect(store.pendingNotices()).toEqual([notice(noticeId1)]); // mismatch: preserved
  });

  it('an ack HTTP failure preserves the notice, surfaces a concise error, and releases the lock', () => {
    store.loadNotifications().subscribe();
    expectLease().flush([notice(noticeId1)]);

    let error: unknown;
    store.acknowledgeNotification(noticeId1).subscribe({ error: (e) => (error = e) });
    expect(store.acknowledgingNotificationId()).toBe(noticeId1);

    httpMock.expectOne(`${base}/notifications/${noticeId1}/ack`).flush(
      { title: 'Unavailable' },
      { status: 503, statusText: 'Service Unavailable' }
    );

    expect(error).toBeInstanceOf(HttpErrorResponse);
    expect(store.pendingNotices()).toEqual([notice(noticeId1)]); // preserved
    expect(store.error()).toBe('Failed to acknowledge reading notice: Unavailable');
    expect(store.acknowledgingNotificationId()).toBeNull();

    // Lock released: the next ack runs normally.
    store.acknowledgeNotification(noticeId1).subscribe();
    httpMock.expectOne(`${base}/notifications/${noticeId1}/ack`).flush({ notificationId: noticeId1, acknowledged: true });
    expect(store.pendingNotices()).toEqual([]);
  });

  it('prevents duplicate concurrent acks and fails deterministically without an HTTP request', () => {
    store.loadNotifications().subscribe();
    expectLease().flush([notice(noticeId1)]);

    store.acknowledgeNotification(noticeId1).subscribe();
    expect(store.acknowledgingNotificationId()).toBe(noticeId1);

    let concurrentError: unknown;
    store.acknowledgeNotification(noticeId1).subscribe({ error: (e) => (concurrentError = e) });
    expect(concurrentError).toBeInstanceOf(Error);
    expect((concurrentError as Error).message).toBe('notification_ack_in_progress');
    const ackRequests = httpMock.match(`${base}/notifications/${noticeId1}/ack`);
    expect(ackRequests).toHaveLength(1);
    expect(store.error()).toBeNull();

    ackRequests[0].flush({ notificationId: noticeId1, acknowledged: true });
    expect(store.pendingNotices()).toEqual([]);
    expect(store.acknowledgingNotificationId()).toBeNull();
  });

  it('acknowledgements are independent of the domain mutation lock', () => {
    store.loadNotifications().subscribe();
    expectLease().flush([notice(noticeId1)]);

    // A domain command in flight never blocks an acknowledgement...
    store.pauseSession({ clientId, idempotencyKey }).subscribe();
    expect(store.mutating()).toBe(true);

    let ackError: unknown;
    store.acknowledgeNotification(noticeId1).subscribe({ error: (e) => (ackError = e) });
    expect(ackError).toBeUndefined();
    expect(store.acknowledgingNotificationId()).toBe(noticeId1);
    httpMock.expectOne(`${base}/notifications/${noticeId1}/ack`).flush({ notificationId: noticeId1, acknowledged: true });
    expect(store.pendingNotices()).toEqual([]);
    httpMock.expectOne(sessionCommandUrl('pause')).flush(envelope({ ...session, status: ReadingSessionStatus.Paused }));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));

    // ...and an in-flight acknowledgement never blocks a domain command.
    store.loadNotifications().subscribe();
    expectLease().flush([notice(noticeId2)]);
    store.acknowledgeNotification(noticeId2).subscribe();
    expect(store.acknowledgingNotificationId()).toBe(noticeId2);

    let commandError: unknown;
    store.cancelSession({ clientId, idempotencyKey: 'key-2' }).subscribe({ error: (e) => (commandError = e) });
    expect(commandError).toBeUndefined();
    expect(store.mutating()).toBe(true);
    httpMock.expectOne(sessionCommandUrl('open')).flush(envelope({ ...session, status: ReadingSessionStatus.Planned }));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    httpMock.expectOne(`${base}/notifications/${noticeId2}/ack`).flush({ notificationId: noticeId2, acknowledged: true });

    expect(store.mutating()).toBe(false);
    expect(store.acknowledgingNotificationId()).toBeNull();
  });

  it('an ack that throws synchronously still releases the ack lock', () => {
    const service = TestBed.inject(ReadingTrainingService);
    vi.spyOn(service, 'acknowledgeNotification').mockImplementation(() => {
      throw new Error('ack factory exploded');
    });

    let error: unknown;
    store.acknowledgeNotification(noticeId1).subscribe({ error: (e) => (error = e) });
    expect((error as Error).message).toBe('ack factory exploded');
    expect(store.error()).toBe('Failed to acknowledge reading notice: ack factory exploded');
    expect(store.acknowledgingNotificationId()).toBeNull();
  });

  it('an ack that completes without emitting still releases the ack lock', () => {
    const service = TestBed.inject(ReadingTrainingService);
    vi.spyOn(service, 'acknowledgeNotification').mockReturnValue(EMPTY);

    let completed = false;
    store.acknowledgeNotification(noticeId1).subscribe({ complete: () => (completed = true) });
    expect(completed).toBe(true);
    expect(store.acknowledgingNotificationId()).toBeNull();
  });

  it('early unsubscription releases the ack lock', () => {
    const service = TestBed.inject(ReadingTrainingService);
    const ackSubject = new Subject<ReadingAckNotificationResult>();
    vi.spyOn(service, 'acknowledgeNotification').mockReturnValue(ackSubject);

    const sub = store.acknowledgeNotification(noticeId1).subscribe();
    expect(store.acknowledgingNotificationId()).toBe(noticeId1);

    sub.unsubscribe();
    expect(store.acknowledgingNotificationId()).toBeNull();

    // A late result must not resurrect the lock or remove anything.
    ackSubject.next({ notificationId: noticeId1, acknowledged: true });
    ackSubject.complete();
    expect(store.acknowledgingNotificationId()).toBeNull();
    expect(store.pendingNotices()).toEqual([]);
  });
});
