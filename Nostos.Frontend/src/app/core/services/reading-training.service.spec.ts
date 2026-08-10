import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { ReadingTrainingService } from './reading-training.service';
import {
  ReadingAssignmentStatus,
  ReadingBookAssignment,
  ReadingCapture,
  ReadingCaptureType,
  ReadingCommandResult,
  ReadingConstraint,
  ReadingDashboard,
  ReadingMode,
  ReadingNotification,
  ReadingProgramme,
  ReadingSession,
  ReadingSessionStatus,
  ReadingTargets,
  ReadingWeeklyReview,
} from '../dtos/reading-training.dtos';

describe('ReadingTrainingService', () => {
  let service: ReadingTrainingService;
  let httpMock: HttpTestingController;

  const base = '/api/reading';
  const clientId = 'test-client';
  const idempotencyKey = 'key-1';
  const sessionId = '11111111-1111-1111-1111-111111111111';
  const assignmentId = '22222222-2222-2222-2222-222222222222';
  const bookId = '33333333-3333-3333-3333-333333333333';
  const captureId = '44444444-4444-4444-4444-444444444444';
  const noteId = '55555555-5555-5555-5555-555555555555';
  const notificationId = '66666666-6666-6666-6666-666666666666';

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

  const notification: ReadingNotification = {
    notificationId,
    payload: {
      notificationId,
      sessionId,
      bookId,
      mode: ReadingMode.Deep,
      plannedTargetMinutes: 30,
      effectiveElapsedSeconds: 1800,
      message: '30 minutes reached.',
    },
    leaseUntil: '2026-08-09T09:01:00+02:00',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ReadingTrainingService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Every request issued during a test must have been matched and flushed;
    // this fails on hidden retries or stray requests.
    httpMock.verify();
  });

  function envelope<T>(data: T, overrides: Partial<ReadingCommandResult<T>> = {}): ReadingCommandResult<T> {
    return { reply: 'ok', stateVersion: '17', duplicate: false, data, ...overrides };
  }

  function expectCommand(method: string, url: string, body: unknown, respond: object) {
    const req = httpMock.expectOne(url);
    expect(req.request.method).toBe(method);
    if (body !== undefined) {
      expect(req.request.body).toEqual(body);
    }
    req.flush(respond);
    return req;
  }

  it('initialize POSTs clientId/idempotencyKey and passes the typed envelope through', () => {
    let result: ReadingCommandResult<ReadingProgramme> | undefined;
    service.initialize({ clientId, idempotencyKey }).subscribe((r) => (result = r));

    expectCommand('POST', `${base}/initialize`, { clientId, idempotencyKey }, envelope(programme));

    expect(result).toEqual(envelope(programme));
  });

  it('passes the duplicate flag through the envelope', () => {
    let result: ReadingCommandResult<ReadingProgramme> | undefined;
    service.initialize({ clientId, idempotencyKey }).subscribe((r) => (result = r));

    expectCommand('POST', `${base}/initialize`, { clientId, idempotencyKey }, envelope(programme, { duplicate: true }));

    expect(result?.duplicate).toBe(true);
  });

  it('GETs the dashboard and emits the fully typed payload', () => {
    const dashboard: ReadingDashboard = { programme, books: [assignment], openSession: session, currentWeek: null };
    let result: ReadingCommandResult<ReadingDashboard> | undefined;
    service.getDashboard().subscribe((r) => (result = r));

    expectCommand('GET', `${base}/dashboard`, undefined, envelope(dashboard));

    expect(result).toEqual(envelope(dashboard));
    expect(result?.data?.programme.targets.enduranceTargetMinutes).toBe(40);
    expect(result?.data?.openSession?.status).toBe(ReadingSessionStatus.Active);
  });

  it('GETs status with a null data payload when no session is open', () => {
    let result: ReadingCommandResult<ReadingSession | null> | undefined;
    service.getStatus().subscribe((r) => (result = r));

    expectCommand('GET', `${base}/status`, undefined, envelope(null, { reply: 'no active session' }));

    expect(result).toEqual(envelope(null, { reply: 'no active session' }));
    expect(result?.data).toBeNull();
  });

  it('GETs history and inbox as session/capture arrays', () => {
    let history: ReadingCommandResult<ReadingSession[]> | undefined;
    let inbox: ReadingCommandResult<ReadingCapture[]> | undefined;
    service.getHistory().subscribe((r) => (history = r));
    service.getInbox().subscribe((r) => (inbox = r));

    expectCommand('GET', `${base}/sessions`, undefined, envelope([session]));
    expectCommand('GET', `${base}/inbox`, undefined, envelope([capture]));

    expect(history?.data).toEqual([session]);
    expect(inbox?.data).toEqual([capture]);
  });

  it('previews a weekly review on the year/week path', () => {
    let result: ReadingCommandResult<ReadingWeeklyReview> | undefined;
    service.previewWeeklyReview(2026, 33).subscribe((r) => (result = r));

    expectCommand('POST', `${base}/reviews/preview`, { year: 2026, week: 33 }, envelope(review));

    expect(result?.data?.weekKey).toBe('2026-W33');
    expect(result?.data?.modes[0].decisionKind).toBe('increase');
  });

  it('commits a weekly review with year/week in the body', () => {
    let result: ReadingCommandResult<ReadingWeeklyReview> | undefined;
    service.commitWeeklyReview({ clientId, idempotencyKey, year: 2026, week: 33 }).subscribe((r) => (result = r));

    expectCommand(
      'POST',
      `${base}/reviews/commit`,
      { clientId, idempotencyKey, year: 2026, week: 33 },
      envelope(review, { reply: 'week committed', stateVersion: '18' })
    );

    expect(result?.data?.committed).toBe(true);
  });

  it('covers the book/queue command surface', () => {
    let add: ReadingCommandResult<ReadingBookAssignment> | undefined;
    let setDefault: ReadingCommandResult<ReadingBookAssignment> | undefined;
    let complete: ReadingCommandResult<ReadingBookAssignment> | undefined;
    let reorder: ReadingCommandResult<ReadingBookAssignment[]> | undefined;

    service.addBook({ clientId, idempotencyKey, bookId, mode: ReadingMode.Endurance, makeDefault: true }).subscribe((r) => (add = r));
    service.setDefaultBook({ clientId, idempotencyKey, bookAssignmentId: assignmentId, mode: ReadingMode.Endurance }).subscribe((r) => (setDefault = r));
    service.completeBook({ clientId, idempotencyKey, bookAssignmentId: assignmentId }).subscribe((r) => (complete = r));
    service.reorderQueue({ clientId, idempotencyKey, assignmentIds: [assignmentId] }).subscribe((r) => (reorder = r));

    expectCommand('POST', `${base}/books`, { clientId, idempotencyKey, bookId, mode: 0, makeDefault: true }, envelope(assignment));
    expectCommand('PATCH', `${base}/books/${assignmentId}`, { clientId, idempotencyKey, bookAssignmentId: assignmentId, mode: 0 }, envelope(assignment));
    expectCommand('POST', `${base}/books/${assignmentId}/finish`, { clientId, idempotencyKey, bookAssignmentId: assignmentId }, envelope(assignment));
    expectCommand('POST', `${base}/books/reorder`, { clientId, idempotencyKey, assignmentIds: [assignmentId] }, envelope([assignment]));

    expect(add?.data).toEqual(assignment);
    expect(setDefault?.data).toEqual(assignment);
    expect(complete?.data).toEqual(assignment);
    expect(reorder?.data).toEqual([assignment]);
  });

  it('drives a full session lifecycle with exact request bodies', () => {
    const plan = { clientId, idempotencyKey, bookAssignmentId: assignmentId, mode: ReadingMode.Endurance, targetMinutes: 40 };
    const baseCommand = { clientId, idempotencyKey };

    let planned: ReadingCommandResult<ReadingSession> | undefined;
    let started: ReadingCommandResult<ReadingSession> | undefined;
    let paused: ReadingCommandResult<ReadingSession> | undefined;
    let resumed: ReadingCommandResult<ReadingSession> | undefined;
    let completed: ReadingCommandResult<ReadingSession> | undefined;
    let rated: ReadingCommandResult<ReadingSession> | undefined;
    let skipped: ReadingCommandResult<ReadingSession> | undefined;
    let cancelled: ReadingCommandResult<ReadingSession> | undefined;

    service.planSession(plan).subscribe((r) => (planned = r));
    expectCommand('POST', `${base}/sessions/plan`, plan, envelope(session));

    service.startSession({ ...baseCommand, sessionId }).subscribe((r) => (started = r));
    expectCommand('POST', `${base}/sessions/start`, { ...baseCommand, sessionId }, envelope(session));

    service.pauseSession(baseCommand, sessionId).subscribe((r) => (paused = r));
    expectCommand('POST', `${base}/sessions/${sessionId}/pause`, baseCommand, envelope(session));

    service.resumeSession(baseCommand, sessionId).subscribe((r) => (resumed = r));
    expectCommand('POST', `${base}/sessions/${sessionId}/resume`, baseCommand, envelope(session));

    service.completeSession({ ...baseCommand, reportedMinutes: 42 }, sessionId).subscribe((r) => (completed = r));
    expectCommand('POST', `${base}/sessions/${sessionId}/complete`, { ...baseCommand, reportedMinutes: 42 }, envelope(session));

    service.rateSession({ ...baseCommand, effort: 6, focus: 7, rating: 4 }, sessionId).subscribe((r) => (rated = r));
    expectCommand('POST', `${base}/sessions/${sessionId}/rate`, { ...baseCommand, effort: 6, focus: 7, rating: 4 }, envelope(session));

    service.skipRatings(baseCommand, sessionId).subscribe((r) => (skipped = r));
    expectCommand('POST', `${base}/sessions/${sessionId}/skip-ratings`, baseCommand, envelope(session));

    service.cancelSession(baseCommand, sessionId).subscribe((r) => (cancelled = r));
    expectCommand('DELETE', `${base}/sessions/${sessionId}/open`, baseCommand, envelope(session));

    expect(planned?.data?.status).toBe(ReadingSessionStatus.Active);
    expect(started?.data?.accumulatedSeconds).toBe(900);
    expect(paused?.data).toEqual(session);
    expect(resumed?.data).toEqual(session);
    expect(completed?.data).toEqual(session);
    expect(rated?.data).toEqual(session);
    expect(skipped?.data).toEqual(session);
    expect(cancelled?.data).toEqual(session);
  });

  it('POSTs start-new with optional fields omitted', () => {
    let result: ReadingCommandResult<ReadingSession> | undefined;
    service.startNewSession({ clientId, idempotencyKey }).subscribe((r) => (result = r));

    expectCommand('POST', `${base}/sessions/start-new`, { clientId, idempotencyKey }, envelope(session));

    expect(result?.data).toEqual(session);
  });

  it('covers capture, PATCH resolve, and promote-to-note', () => {
    let created: ReadingCommandResult<ReadingCapture> | undefined;
    let resolved: ReadingCommandResult<ReadingCapture> | undefined;
    let promoted: ReadingCommandResult<ReadingCapture> | undefined;

    service
      .capture({ clientId, idempotencyKey, text: 'A stoic thought.', type: ReadingCaptureType.Thought, bookId, sessionId })
      .subscribe((r) => (created = r));
    expectCommand('POST', `${base}/captures`, { clientId, idempotencyKey, text: 'A stoic thought.', type: 0, bookId, sessionId }, envelope(capture));

    service.resolveCapture(captureId, { clientId, idempotencyKey, keep: true, noteId }).subscribe((r) => (resolved = r));
    expectCommand('PATCH', `${base}/captures/${captureId}`, { clientId, idempotencyKey, keep: true, noteId }, envelope(capture));

    service.promoteCapture(captureId, { clientId, idempotencyKey, noteId }).subscribe((r) => (promoted = r));
    expectCommand('POST', `${base}/captures/${captureId}/promote-to-note`, { clientId, idempotencyKey, noteId }, envelope(capture));

    expect(created?.data?.type).toBe(ReadingCaptureType.Thought);
    expect(resolved?.data?.id).toBe(captureId);
    expect(promoted?.data).toEqual(capture);
  });

  it('leases notifications with the default query parameters', () => {
    let result: ReadingNotification[] | undefined;
    service.leaseNotifications().subscribe((r) => (result = r));

    const req = httpMock.expectOne(`${base}/notifications/lease?maxCount=10&leaseSeconds=60`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('maxCount')).toBe('10');
    expect(req.request.params.get('leaseSeconds')).toBe('60');
    req.flush([notification]);

    expect(result).toEqual([notification]);
  });

  it('leases notifications with explicit query parameters', () => {
    let result: ReadingNotification[] | undefined;
    service.leaseNotifications(3, 300).subscribe((r) => (result = r));

    const req = httpMock.expectOne(`${base}/notifications/lease?maxCount=3&leaseSeconds=300`);
    expect(req.request.method).toBe('GET');
    req.flush([notification]);

    expect(result?.length).toBe(1);
  });

  it('acknowledges a notification on its path with no body', () => {
    let result: { notificationId: string; acknowledged: boolean } | undefined;
    service.acknowledgeNotification(notificationId).subscribe((r) => (result = r));

    const req = httpMock.expectOne(`${base}/notifications/${notificationId}/ack`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBeNull();
    req.flush({ notificationId, acknowledged: true });

    expect(result).toEqual({ notificationId, acknowledged: true });
  });

  it('emits exactly one request per call with no retries', () => {
    let emissions = 0;
    service.getDashboard().subscribe(() => emissions++);

    const req = httpMock.expectOne(`${base}/dashboard`);
    req.flush(envelope({ programme, books: [assignment], openSession: session, currentWeek: null }));

    expect(emissions).toBe(1);
    expect(req.request.method).toBe('GET');
    // No pending requests may remain: httpMock.verify() in afterEach enforces it.
  });
});
