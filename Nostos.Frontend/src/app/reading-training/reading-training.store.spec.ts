import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EMPTY } from 'rxjs';

import { ReadingTrainingStore } from './reading-training.store';
import { ReadingTrainingService } from '../core/services/reading-training.service';
import {
  ReadingAssignmentStatus,
  ReadingBookAssignment,
  ReadingCapture,
  ReadingCaptureType,
  ReadingCommandResult,
  ReadingConstraint,
  ReadingDashboard,
  ReadingMode,
  ReadingProgramme,
  ReadingSession,
  ReadingSessionStatus,
  ReadingTargets,
  ReadingWeeklyReview,
} from '../core/dtos/reading-training.dtos';

describe('ReadingTrainingStore', () => {
  let store: ReadingTrainingStore;
  let httpMock: HttpTestingController;

  const base = '/api/reading-training';
  const clientId = 'test-client';
  const idempotencyKey = 'key-1';
  const sessionId = '11111111-1111-1111-1111-111111111111';
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

    // No refresh before 30s have elapsed.
    vi.advanceTimersByTime(29_999);
    expect(httpMock.match(`${base}/dashboard`)).toHaveLength(0);

    vi.advanceTimersByTime(1);
    req = httpMock.expectOne(`${base}/dashboard`);
    req.flush(envelope(dashboard({ openSession: { ...session, measuredSeconds: 1000 } })));
    expect(store.openSession()?.measuredSeconds).toBe(1000);
  });

  it('refreshes on window focus, on window online, and on visibility becoming visible (not hidden)', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));

    window.dispatchEvent(new Event('focus'));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));

    window.dispatchEvent(new Event('online'));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(httpMock.match(`${base}/dashboard`)).toHaveLength(0);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
  });

  it('connect() is idempotent: repeated calls do not duplicate requests, timers, or listeners', () => {
    store.connect();
    store.connect();
    store.connect();
    expect(store.connected()).toBe(true);

    // Exactly one immediate load.
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));

    // Exactly one 30s refresh (a duplicated timer would produce two requests).
    vi.advanceTimersByTime(30_000);
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));

    // Exactly one focus listener (a duplicated listener would produce two requests).
    window.dispatchEvent(new Event('focus'));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
  });

  it('disconnect() stops timers and removes listeners; no later refresh fires', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    store.disconnect();
    expect(store.connected()).toBe(false);

    vi.advanceTimersByTime(120_000);
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(httpMock.match(`${base}/dashboard`)).toHaveLength(0);
    expect(store.dashboard()).toEqual(dashboard());
  });

  it('reconnecting after disconnect reloads the dashboard and restarts the lifecycle', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    store.disconnect();

    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    vi.advanceTimersByTime(30_000);
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
  });

  // --- dashboard selectors and refresh convergence ---

  it('exposes derived selectors from the dashboard snapshot', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));

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

    const updated = dashboard({
      openSession: { ...session, status: ReadingSessionStatus.Paused, pausedAt: '2026-08-09T08:25:00+02:00' },
    });
    window.dispatchEvent(new Event('focus'));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(updated));

    expect(store.dashboard()).toEqual(updated);
    expect(store.sessionPaused()).toBe(true);
    expect(store.sessionActive()).toBe(false);
  });

  it('an older overlapping refresh response never overwrites a newer one', () => {
    store.connect();
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
    expect(httpMock.match(`${base}/history`)).toHaveLength(0);

    inbox$.subscribe();
    // match() consumes requests, so keep a reference before flushing.
    const inboxReqs = httpMock.match(`${base}/inbox`);
    expect(inboxReqs).toHaveLength(1);
    expect(httpMock.match(`${base}/history`)).toHaveLength(0);
    inboxReqs[0].flush(envelope([capture]));
    expect(store.inbox()).toEqual([capture]);

    history$.subscribe();
    const historyReqs = httpMock.match(`${base}/history`);
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
    httpMock.expectOne(`${base}/history`).flush(envelope([session, pausedSession]));

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

    httpMock.expectOne(`${base}/history`).flush(envelope([pausedSession]));
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
    httpMock.expectOne(`${base}/history`).flush(envelope([pausedSession]));

    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    store.disconnect();
    expect(store.inbox()).toEqual([capture]);
    expect(store.history()).toEqual([pausedSession]);

    // The 30s timer drives the dashboard refresh only — never inbox/history.
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    vi.advanceTimersByTime(30_000);
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expect(httpMock.match(`${base}/inbox`)).toHaveLength(0);
    expect(httpMock.match(`${base}/history`)).toHaveLength(0);
  });

  // --- display-only elapsed seconds ---

  it('ticks once per second from the server anchor while the session is Active', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expect(store.displayedElapsedSeconds()).toBe(900);

    vi.advanceTimersByTime(5_000);
    expect(store.displayedElapsedSeconds()).toBe(905);

    vi.advanceTimersByTime(1_000);
    expect(store.displayedElapsedSeconds()).toBe(906);
  });

  it('paused, planned, awaiting-feedback, and completed sessions never tick', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard({ openSession: pausedSession })));
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
    vi.advanceTimersByTime(10_000);
    expect(store.displayedElapsedSeconds()).toBe(910);

    // 30s authoritative refresh reports server-measured 950 seconds.
    vi.advanceTimersByTime(20_000);
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard({ openSession: { ...session, measuredSeconds: 950 } })));
    expect(store.displayedElapsedSeconds()).toBe(950);

    vi.advanceTimersByTime(3_000);
    expect(store.displayedElapsedSeconds()).toBe(953);
  });

  it('clamps a client clock moving backwards to zero added seconds', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));

    // Move the (fake) client clock backwards relative to the anchor time.
    vi.setSystemTime(Date.now() - 5_000);
    vi.advanceTimersByTime(1_000);
    expect(store.displayedElapsedSeconds()).toBe(900);
  });

  it('freezes displayed time while disconnected and excludes offline wall time on reconnect', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
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
    expect(httpMock.match(`${base}/sessions/pause`)).toHaveLength(0);

    command$.subscribe();
    expect(store.mutating()).toBe(true);
    httpMock.expectOne(`${base}/sessions/pause`).flush(envelope(pausedSession));
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
    httpMock.expectOne(`${base}/sessions/pause`).flush(result);
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
    req = httpMock.expectOne(`${base}/sessions/pause`);
    expect(req.request.body).toEqual(baseCommand);
    req.flush(envelope({ ...session, status: ReadingSessionStatus.Paused }));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard({ openSession: pausedSession })));

    store.rateSession(rateRequest).subscribe((r) => (rated = r));
    req = httpMock.expectOne(`${base}/sessions/rate`);
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
    req = httpMock.expectOne(`${base}/captures/${captureId}/resolve`);
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

    const cmd = httpMock.expectOne(`${base}/weekly-reviews/commit`);
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
    expect(store.error()).toBeNull();

    let error: unknown;
    store.pauseSession({ clientId, idempotencyKey }).subscribe({ error: (e) => (error = e) });

    const cmd = httpMock.expectOne(`${base}/sessions/pause`);
    cmd.flush(
      { reply: 'Cannot pause: no active session', data: { code: 'invalid_transition' }, stateVersion: '17', duplicate: false },
      { status: 409, statusText: 'Conflict' }
    );

    expect(error).toBeInstanceOf(HttpErrorResponse);
    expect(httpMock.match(`${base}/dashboard`)).toHaveLength(0); // no refresh after rejection
    expect(store.error()).toBe('Failed to pause session: invalid_transition');
    expect(store.dashboard()).toEqual(dashboard()); // last good dashboard preserved
    expect(store.lastReply()).toBeNull(); // only successful commands record a reply
    expect(store.mutating()).toBe(false);
  });

  it('a network error while refreshing preserves the last good dashboard and exposes a concise error', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));

    window.dispatchEvent(new Event('focus'));
    httpMock.expectOne(`${base}/dashboard`).error(new ProgressEvent('error'));

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

    expect(store.dashboard()).toBeNull();
    expect(store.programme()).toBeNull();
    expect(store.books()).toEqual([]);
    expect(store.openSession()).toBeNull();
    expect(store.displayedElapsedSeconds()).toBe(0);
    expect(store.error()).toBe('Unable to load dashboard: not_initialized');
    expect(store.loading()).toBe(false);
  });

  it('errors clear on the next successful refresh', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).error(new ProgressEvent('error'));
    expect(store.error()).toBe('Unable to load dashboard: network error');

    window.dispatchEvent(new Event('focus'));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expect(store.error()).toBeNull();
  });

  it('serializes mutations: a concurrent command fails deterministically with mutation_in_progress', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));

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
    expect(httpMock.match(`${base}/sessions/pause`)).toHaveLength(0);
    expect(store.error()).toBeNull();

    // The first command still completes normally and refreshes.
    httpMock.expectOne(`${base}/sessions/plan`).flush(envelope(session));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expect(planned?.data).toEqual(session);
    expect(store.mutating()).toBe(false);

    // Once the lock is released, the next mutation runs normally.
    store.pauseSession({ clientId, idempotencyKey: 'key-2' }).subscribe();
    httpMock.expectOne(`${base}/sessions/pause`).flush(envelope({ ...session, status: ReadingSessionStatus.Paused }));
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expect(store.mutating()).toBe(false);
  });

  it('a command HTTP failure releases the mutation lock without refreshing', () => {
    store.connect();
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));

    let error: unknown;
    store.rateSession({ clientId, idempotencyKey, effort: 6, focus: 7 }).subscribe({ error: (e) => (error = e) });
    expect(store.mutating()).toBe(true);

    httpMock.expectOne(`${base}/sessions/rate`).error(new ProgressEvent('error'));
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

    const completeReq = httpMock.expectOne(`${base}/sessions/complete`);
    expect(completeReq.request.method).toBe('POST');
    completeReq.flush(envelope({ ...session, status: ReadingSessionStatus.AwaitingFeedback }, { reply: 'session completed' }));

    // The lock stays held through the first command's authoritative refresh...
    expect(store.mutating()).toBe(true);
    httpMock.expectOne(`${base}/dashboard`).flush(envelope(dashboard()));
    expect(completeEmitted).toBeDefined();

    // ...then the rate POST is issued from the result handler, no mutation error.
    expect(rateError).toBeUndefined();
    const rateReq = httpMock.expectOne(`${base}/sessions/rate`);
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

    httpMock.expectOne(`${base}/sessions/complete`).flush(
      { reply: 'Cannot complete: no active session', data: { code: 'invalid_transition' }, stateVersion: '17', duplicate: false },
      { status: 409, statusText: 'Conflict' }
    );

    expect(followUpError).toBeUndefined();
    httpMock.expectOne(`${base}/sessions/rate`).flush(envelope({ ...session, effort: 6, focus: 7 }, { reply: 'session rated' }));
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
    expect(httpMock.match(`${base}/sessions/pause`)).toHaveLength(0);
  });

  it('a command that completes without emitting still releases the mutation lock', () => {
    const service = TestBed.inject(ReadingTrainingService);
    vi.spyOn(service, 'pauseSession').mockReturnValue(EMPTY);

    let completed = false;
    store.pauseSession({ clientId, idempotencyKey }).subscribe({ complete: () => (completed = true) });
    expect(completed).toBe(true);
    expect(store.mutating()).toBe(false);
    expect(httpMock.match(`${base}/sessions/pause`)).toHaveLength(0);
  });
});
