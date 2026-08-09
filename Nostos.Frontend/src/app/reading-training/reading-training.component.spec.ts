import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { WritableSignal, signal } from '@angular/core';
import { of } from 'rxjs';

import { ReadingTrainingComponent } from './reading-training.component';
import { ReadingTrainingStore } from './reading-training.store';
import { routes } from '../app.routes';
import { WorkspaceLayout } from '../layout/workspace-layout/workspace-layout.component';
import {
  ReadingAssignmentStatus,
  ReadingBookAssignment,
  ReadingCommandResult,
  ReadingConstraint,
  ReadingDashboard,
  ReadingMode,
  ReadingProgramme,
  ReadingSession,
  ReadingSessionStatus,
  ReadingTargets,
} from '../core/dtos/reading-training.dtos';

const targets: ReadingTargets = {
  enduranceTargetMinutes: 40,
  deepTargetMinutes: 30,
  recoveryTargetMinutes: 20,
  enduranceEstablishedMinutes: 40,
  deepEstablishedMinutes: 30,
  recoveryEstablishedMinutes: 20,
};

const programme: ReadingProgramme = {
  id: 'p1',
  timezoneId: 'Europe/Stockholm',
  stateVersion: '1',
  targets,
  deloadActive: false,
};

const enduranceBook: ReadingBookAssignment = {
  id: 'a1',
  bookId: 'b1',
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

function makeSession(overrides: Partial<ReadingSession> = {}): ReadingSession {
  return {
    id: 's1',
    bookAssignmentId: enduranceBook.id,
    bookId: enduranceBook.bookId,
    bookTitle: enduranceBook.bookTitle,
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
    ...overrides,
  };
}

function envelope<T>(data: T | null = null): ReadingCommandResult<T> {
  return { reply: 'ok', data, stateVersion: '1', duplicate: false };
}

interface StoreMock {
  dashboard: WritableSignal<ReadingDashboard | null>;
  loading: WritableSignal<boolean>;
  mutating: WritableSignal<boolean>;
  error: WritableSignal<string | null>;
  lastReply: WritableSignal<string | null>;
  connected: WritableSignal<boolean>;
  programme: WritableSignal<ReadingProgramme | null>;
  books: WritableSignal<ReadingBookAssignment[]>;
  openSession: WritableSignal<ReadingSession | null>;
  currentWeek: WritableSignal<null>;
  displayedElapsedSeconds: WritableSignal<number>;
  defaultBookForMode: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  initialize: ReturnType<typeof vi.fn>;
  startSession: ReturnType<typeof vi.fn>;
  startNewSession: ReturnType<typeof vi.fn>;
  pauseSession: ReturnType<typeof vi.fn>;
  resumeSession: ReturnType<typeof vi.fn>;
  completeSession: ReturnType<typeof vi.fn>;
  cancelSession: ReturnType<typeof vi.fn>;
}

function createStoreMock(): StoreMock {
  return {
    dashboard: signal<ReadingDashboard | null>(null),
    loading: signal(false),
    mutating: signal(false),
    error: signal<string | null>(null),
    lastReply: signal<string | null>(null),
    connected: signal(false),
    programme: signal<ReadingProgramme | null>(null),
    books: signal<ReadingBookAssignment[]>([]),
    openSession: signal<ReadingSession | null>(null),
    currentWeek: signal(null),
    displayedElapsedSeconds: signal(0),
    defaultBookForMode: vi.fn(() => null),
    connect: vi.fn(),
    disconnect: vi.fn(),
    refresh: vi.fn(),
    initialize: vi.fn(() => of(envelope<unknown>(null))),
    startSession: vi.fn(() => of(envelope<unknown>(null))),
    startNewSession: vi.fn(() => of(envelope<unknown>(null))),
    pauseSession: vi.fn(() => of(envelope<unknown>(null))),
    resumeSession: vi.fn(() => of(envelope<unknown>(null))),
    completeSession: vi.fn(() => of(envelope<unknown>(null))),
    cancelSession: vi.fn(() => of(envelope<unknown>(null))),
  };
}

describe('ReadingTrainingComponent', () => {
  let mock: StoreMock;
  let fixture: ComponentFixture<ReadingTrainingComponent>;

  beforeEach(async () => {
    mock = createStoreMock();
    await TestBed.configureTestingModule({
      imports: [ReadingTrainingComponent],
      providers: [{ provide: ReadingTrainingStore, useValue: mock as unknown as ReadingTrainingStore }],
    }).compileComponents();
    fixture = TestBed.createComponent(ReadingTrainingComponent);
    fixture.detectChanges();
  });

  function initializedDashboard(openSession: ReadingSession | null = null): ReadingDashboard {
    return {
      programme,
      books: [enduranceBook],
      openSession,
      currentWeek: null,
    };
  }

  function clickButton(text: string): void {
    const buttons = fixture.nativeElement.querySelectorAll('button');
    const button = Array.from(buttons).find((b) => (b as HTMLButtonElement).textContent?.trim() === text);
    expect(button, `button "${text}"`).toBeTruthy();
    (button as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  const forbidden = /streak|debt|catch.?up|guilt/i;

  it('connects on init and disconnects on destroy', () => {
    expect(mock.connect).toHaveBeenCalledTimes(1);
    fixture.destroy();
    expect(mock.disconnect).toHaveBeenCalledTimes(1);
  });

  it('renders a loading region while loading without a dashboard', () => {
    mock.loading.set(true);
    fixture.detectChanges();
    const status = fixture.debugElement.query(By.css('[role="status"]'));
    expect(status).toBeTruthy();
    expect(status.nativeElement.textContent).toContain('Loading reading training');
  });

  it('renders an error panel without a dashboard and retries via refresh', () => {
    mock.error.set('Unable to load dashboard: network error');
    fixture.detectChanges();
    const alert = fixture.debugElement.query(By.css('[role="alert"]'));
    expect(alert.nativeElement.textContent).toContain('Unable to load dashboard');
    clickButton('Try again');
    expect(mock.refresh).toHaveBeenCalledTimes(1);
  });

  it('shows the not-initialized panel and sets up on a single explicit action', () => {
    mock.error.set('Unable to load dashboard: not_initialized');
    fixture.detectChanges();
    const panel = fixture.debugElement.query(By.css('.setup-panel'));
    expect(panel).toBeTruthy();
    expect(panel.nativeElement.textContent).toContain('Set up reading training');

    clickButton('Set up reading training');
    expect(mock.initialize).toHaveBeenCalledTimes(1);
    const first = mock.initialize.mock.calls[0][0] as { clientId: string; idempotencyKey: string };
    expect(first.clientId).toBeTruthy();
    expect(first.idempotencyKey).toBeTruthy();

    // Another user action is a new action: fresh key, stable client.
    clickButton('Set up reading training');
    expect(mock.initialize).toHaveBeenCalledTimes(2);
    const second = mock.initialize.mock.calls[1][0] as { clientId: string; idempotencyKey: string };
    expect(second.clientId).toBe(first.clientId);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it('never auto-retries the initialize mutation', () => {
    mock.error.set('Unable to load dashboard: not_initialized');
    fixture.detectChanges();
    clickButton('Set up reading training');
    expect(mock.initialize).toHaveBeenCalledTimes(1);
    // No additional calls without another click, even after further renders.
    fixture.detectChanges();
    expect(mock.initialize).toHaveBeenCalledTimes(1);
  });

  it('renders three capacity lanes with mode targets, books, and recovery volume-only note', () => {
    mock.dashboard.set(initializedDashboard());
    mock.defaultBookForMode.mockImplementation((mode: ReadingMode) =>
      mode === ReadingMode.Endurance ? enduranceBook : null
    );
    fixture.detectChanges();

    const lanes = fixture.nativeElement.querySelectorAll('.lane');
    expect(lanes.length).toBe(3);
    expect(lanes[0].textContent).toContain('Endurance');
    expect(lanes[0].textContent).toContain('40');
    expect(lanes[0].textContent).toContain('Meditations');
    expect(lanes[1].textContent).toContain('Deep');
    expect(lanes[1].textContent).toContain('30');
    expect(lanes[1].textContent).toContain('No book assigned');
    expect(lanes[2].textContent).toContain('Recovery');
    expect(lanes[2].textContent).toContain('20');
    expect(lanes[2].textContent).toContain('Volume only');
    // Recovery never uses progression/failure language.
    expect(lanes[2].textContent).not.toMatch(/increase|deload|fail|progression/i);
  });

  it('forwards a start from the empty state as startNewSession', () => {
    mock.dashboard.set(initializedDashboard());
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No session in progress');
    clickButton('Start reading');
    expect(mock.startNewSession).toHaveBeenCalledTimes(1);
    const req = mock.startNewSession.mock.calls[0][0] as { clientId: string; idempotencyKey: string };
    expect(req.clientId).toBeTruthy();
    expect(req.idempotencyKey).toBeTruthy();
    expect(mock.startSession).not.toHaveBeenCalled();
  });

  it('forwards a start of a planned session as startSession with the session id', () => {
    mock.dashboard.set(initializedDashboard(makeSession({ status: ReadingSessionStatus.Planned })));
    fixture.detectChanges();
    clickButton('Start');
    expect(mock.startSession).toHaveBeenCalledTimes(1);
    const req = mock.startSession.mock.calls[0][0] as { sessionId?: string; clientId: string };
    expect(req.sessionId).toBe('s1');
    expect(mock.startNewSession).not.toHaveBeenCalled();
  });

  it('forwards pause/resume/cancel/complete as typed commands with per-action keys', () => {
    const active = makeSession({ status: ReadingSessionStatus.Active });
    mock.dashboard.set(initializedDashboard(active));
    fixture.detectChanges();

    clickButton('Pause');
    expect(mock.pauseSession).toHaveBeenCalledTimes(1);
    const pauseReq = mock.pauseSession.mock.calls[0][0] as { clientId: string; idempotencyKey: string };
    expect(pauseReq.clientId).toBeTruthy();
    expect(pauseReq.idempotencyKey).toBeTruthy();

    // Paused state: Resume and Cancel both available.
    mock.openSession.set(makeSession({ status: ReadingSessionStatus.Paused }));
    fixture.detectChanges();
    clickButton('Resume');
    expect(mock.resumeSession).toHaveBeenCalledTimes(1);
    clickButton('Cancel');
    expect(mock.cancelSession).toHaveBeenCalledTimes(1);

    // AwaitingFeedback: Complete carries the reported minutes.
    mock.openSession.set(makeSession({ status: ReadingSessionStatus.AwaitingFeedback }));
    fixture.detectChanges();
    const minutesInput = fixture.nativeElement.querySelector('input[aria-label="Actual minutes read"]') as HTMLInputElement;
    expect(minutesInput).toBeTruthy();
    minutesInput.value = '25';
    minutesInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    clickButton('Complete');
    expect(mock.completeSession).toHaveBeenCalledTimes(1);
    const completeReq = mock.completeSession.mock.calls[0][0] as { reportedMinutes?: number };
    expect(completeReq.reportedMinutes).toBe(25);

    // A later feedback state must not inherit the previous session's value.
    mock.openSession.set(makeSession({ status: ReadingSessionStatus.Active }));
    fixture.detectChanges();
    mock.openSession.set(makeSession({ id: 's2', status: ReadingSessionStatus.AwaitingFeedback }));
    fixture.detectChanges();
    const nextMinutesInput = fixture.nativeElement.querySelector(
      'input[aria-label="Actual minutes read"]'
    ) as HTMLInputElement;
    expect(nextMinutesInput.value).toBe('');

    // Per-action keys are fresh; the UI client stays stable.
    mock.openSession.set(makeSession({ status: ReadingSessionStatus.Active }));
    fixture.detectChanges();
    clickButton('Pause');
    expect(mock.pauseSession).toHaveBeenCalledTimes(2);
    const pauseReq2 = mock.pauseSession.mock.calls[1][0] as { clientId: string; idempotencyKey: string };
    expect(pauseReq2.clientId).toBe(pauseReq.clientId);
    expect(pauseReq2.idempotencyKey).not.toBe(pauseReq.idempotencyKey);
  });

  it('disables mutation controls while a mutation is in flight', () => {
    mock.dashboard.set(initializedDashboard(makeSession({ status: ReadingSessionStatus.Active })));
    mock.mutating.set(true);
    fixture.detectChanges();
    const pause = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (b) => (b as HTMLButtonElement).textContent?.trim() === 'Pause'
    ) as HTMLButtonElement;
    expect(pause.disabled).toBe(true);
  });

  it('shows the ticking elapsed value with aria-live off and a polite command reply region', () => {
    mock.dashboard.set(initializedDashboard(makeSession({ status: ReadingSessionStatus.Active })));
    mock.displayedElapsedSeconds.set(125);
    mock.lastReply.set('Session paused.');
    fixture.detectChanges();

    const elapsed = fixture.nativeElement.querySelector('.elapsed') as HTMLElement;
    expect(elapsed.textContent?.trim()).toBe('02:05');
    expect(elapsed.getAttribute('aria-live')).toBe('off');

    const statusRegion = fixture.nativeElement.querySelector('.status-region') as HTMLElement;
    expect(statusRegion).toBeTruthy();
    expect(statusRegion.getAttribute('aria-live')).toBe('polite');
    expect(statusRegion.textContent).toContain('Session paused.');
  });

  it('keeps the dashboard visible with an error banner when a refresh fails', () => {
    mock.dashboard.set(initializedDashboard());
    mock.error.set('Unable to load dashboard: HTTP 500');
    fixture.detectChanges();
    const banner = fixture.debugElement.query(By.css('.error-banner'));
    expect(banner).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('.lane').length).toBe(3);
  });

  it('renders a refresh button that calls store refresh', () => {
    mock.dashboard.set(initializedDashboard());
    fixture.detectChanges();
    const refresh = fixture.nativeElement.querySelector('button[aria-label="Refresh reading training"]') as HTMLButtonElement;
    expect(refresh).toBeTruthy();
    refresh.click();
    expect(mock.refresh).toHaveBeenCalledTimes(1);
  });

  it('never renders streak, debt, catch-up, or guilt language', () => {
    mock.error.set('Unable to load dashboard: not_initialized');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toMatch(forbidden);

    mock.error.set(null);
    mock.dashboard.set(initializedDashboard(makeSession({ status: ReadingSessionStatus.Active })));
    mock.lastReply.set('Session paused.');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toMatch(forbidden);
  });
});

describe('ReadingTraining route wiring', () => {
  it('registers a lazy /training route inside WorkspaceLayout', async () => {
    const workspace = routes.find((route) => route.component === WorkspaceLayout);
    expect(workspace).toBeTruthy();
    const training = workspace?.children?.find((child) => child.path === 'training');
    expect(training).toBeTruthy();
    expect(training?.loadComponent).toBeDefined();
    const loaded = await training!.loadComponent!();
    expect(loaded).toBe(ReadingTrainingComponent);
  });
});
