import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { WritableSignal, signal } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';

import { ReadingTrainingComponent } from './reading-training.component';
import { ReadingTrainingStore } from './reading-training.store';
import { routes } from '../app.routes';
import { WorkspaceLayout } from '../layout/workspace-layout/workspace-layout.component';
import { Book, PaginatedResponse } from '../core/dtos/book.dtos';
import { Note } from '../core/dtos/note.dtos';
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
  ReadingWeekSummary,
  ReadingWeeklyReview,
} from '../core/dtos/reading-training.dtos';
import { BooksService } from '../core/services/books.service';
import { NotesService } from '../core/services/notes.service';
import { ReadingTrainingService } from '../core/services/reading-training.service';

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

const secondBook: ReadingBookAssignment = {
  ...enduranceBook,
  id: 'a2',
  bookId: 'b2',
  bookTitle: 'Letters from a Stoic',
  bookAuthor: 'Seneca',
  queueOrder: 1,
  isDefault: false,
};

const libraryBook = {
  id: 'lib1',
  title: 'The Enchiridion',
  author: 'Epictetus',
} as unknown as Book;

const note1: Note = {
  id: 'n1',
  bookId: 'b1',
  content: 'First line of the note\nSecond line',
  createdAt: '2026-08-01T10:00:00+02:00',
};

const note2: Note = {
  id: 'n2',
  bookId: 'b1',
  content: 'Another note',
  createdAt: '2026-08-02T10:00:00+02:00',
};

const capture: ReadingCapture = {
  id: 'c1',
  text: 'What is virtue?',
  type: ReadingCaptureType.Question,
  bookId: 'b1',
  sessionId: 's1',
  externalId: null,
  resolved: false,
  promotedNoteId: null,
  createdAt: '2026-08-09T10:00:00+02:00',
};

const weekSummary: ReadingWeekSummary = {
  weekKey: '2026-W33',
  completedSessions: 2,
  qualifyingSessions: 1,
  volumeMinutes: 60,
  completionThreshold: 3,
  reviewCommitted: false,
};

const weeklyReview: ReadingWeeklyReview = {
  weekKey: '2026-W33',
  isoYear: 2026,
  isoWeek: 33,
  committed: false,
  committedAt: null,
  totalVolumeMinutes: 60,
  previousWeekVolumeMinutes: 45,
  modes: [
    {
      mode: ReadingMode.Endurance,
      targetBeforeMinutes: 40,
      targetAfterMinutes: 45,
      decisionKind: 'increase',
      reason: 'completed above threshold',
      qualifyingCount: 2,
      completionRate: 0.67,
      medianEffort: 7,
      medianFocus: 6,
      nextConsecutiveIncreases: 1,
    },
  ],
  stateVersion: '1',
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

const booksPage: PaginatedResponse<Book> = {
  items: [libraryBook],
  totalCount: 1,
  page: 1,
  pageSize: 100,
};

function pendingNotice(id: string, mode: ReadingMode): ReadingNotification {
  return {
    notificationId: id,
    payload: {
      notificationId: id,
      sessionId: 's1',
      bookId: 'b1',
      mode,
      plannedTargetMinutes: 40,
      effectiveElapsedSeconds: 2500,
      message: 'Reading target reached.',
    },
    leaseUntil: '2026-08-09T19:00:00+02:00',
  };
}

const pendingNotice1 = pendingNotice('notice-1', ReadingMode.Endurance);
const pendingNotice2 = pendingNotice('notice-2', ReadingMode.Recovery);

interface StoreMock {
  dashboard: WritableSignal<ReadingDashboard | null>;
  loading: WritableSignal<boolean>;
  mutating: WritableSignal<boolean>;
  error: WritableSignal<string | null>;
  lastReply: WritableSignal<string | null>;
  connected: WritableSignal<boolean>;
  stateVersion: WritableSignal<string | null>;
  programme: WritableSignal<ReadingProgramme | null>;
  books: WritableSignal<ReadingBookAssignment[]>;
  openSession: WritableSignal<ReadingSession | null>;
  currentWeek: WritableSignal<ReadingWeekSummary | null>;
  inbox: WritableSignal<ReadingCapture[]>;
  history: WritableSignal<ReadingSession[]>;
  pendingNotices: WritableSignal<ReadingNotification[]>;
  notificationsLoading: WritableSignal<boolean>;
  acknowledgingNotificationId: WritableSignal<string | null>;
  notificationsBusy: WritableSignal<boolean>;
  displayedElapsedSeconds: WritableSignal<number>;
  defaultBookForMode: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  loadNotifications: ReturnType<typeof vi.fn>;
  acknowledgeNotification: ReturnType<typeof vi.fn>;
  initialize: ReturnType<typeof vi.fn>;
  startSession: ReturnType<typeof vi.fn>;
  startNewSession: ReturnType<typeof vi.fn>;
  pauseSession: ReturnType<typeof vi.fn>;
  resumeSession: ReturnType<typeof vi.fn>;
  completeSession: ReturnType<typeof vi.fn>;
  cancelSession: ReturnType<typeof vi.fn>;
  loadInbox: ReturnType<typeof vi.fn>;
  loadHistory: ReturnType<typeof vi.fn>;
  addBook: ReturnType<typeof vi.fn>;
  setDefaultBook: ReturnType<typeof vi.fn>;
  completeBook: ReturnType<typeof vi.fn>;
  reorderQueue: ReturnType<typeof vi.fn>;
  planSession: ReturnType<typeof vi.fn>;
  rateSession: ReturnType<typeof vi.fn>;
  skipRatings: ReturnType<typeof vi.fn>;
  capture: ReturnType<typeof vi.fn>;
  resolveCapture: ReturnType<typeof vi.fn>;
  promoteCapture: ReturnType<typeof vi.fn>;
  commitWeeklyReview: ReturnType<typeof vi.fn>;
}

function createStoreMock(): StoreMock {
  const command = () => vi.fn(() => of(envelope<unknown>(null)));
  return {
    dashboard: signal<ReadingDashboard | null>(null),
    loading: signal(false),
    mutating: signal(false),
    error: signal<string | null>(null),
    lastReply: signal<string | null>(null),
    connected: signal(false),
    stateVersion: signal<string | null>(null),
    programme: signal<ReadingProgramme | null>(null),
    books: signal<ReadingBookAssignment[]>([]),
    openSession: signal<ReadingSession | null>(null),
    currentWeek: signal<ReadingWeekSummary | null>(null),
    inbox: signal<ReadingCapture[]>([]),
    history: signal<ReadingSession[]>([]),
    pendingNotices: signal<ReadingNotification[]>([]),
    notificationsLoading: signal(false),
    acknowledgingNotificationId: signal<string | null>(null),
    notificationsBusy: signal(false),
    displayedElapsedSeconds: signal(0),
    defaultBookForMode: vi.fn(() => null),
    connect: vi.fn(),
    disconnect: vi.fn(),
    refresh: vi.fn(),
    loadNotifications: vi.fn(() => of([] as ReadingNotification[])),
    acknowledgeNotification: vi.fn(() => of({ notificationId: '', acknowledged: true })),
    initialize: command(),
    startSession: command(),
    startNewSession: command(),
    pauseSession: command(),
    resumeSession: command(),
    completeSession: command(),
    cancelSession: command(),
    loadInbox: vi.fn(() => of(envelope<ReadingCapture[]>([]))),
    loadHistory: vi.fn(() => of(envelope<ReadingSession[]>([]))),
    addBook: command(),
    setDefaultBook: command(),
    completeBook: command(),
    reorderQueue: command(),
    planSession: command(),
    rateSession: command(),
    skipRatings: command(),
    capture: command(),
    resolveCapture: command(),
    promoteCapture: command(),
    commitWeeklyReview: command(),
  };
}

interface BooksServiceMock {
  list: ReturnType<typeof vi.fn>;
}

interface NotesServiceMock {
  list: ReturnType<typeof vi.fn>;
}

interface ReadingServiceMock {
  previewWeeklyReview: ReturnType<typeof vi.fn>;
}

describe('ReadingTrainingComponent', () => {
  let mock: StoreMock;
  let booksMock: BooksServiceMock;
  let notesMock: NotesServiceMock;
  let readingServiceMock: ReadingServiceMock;
  let fixture: ComponentFixture<ReadingTrainingComponent>;

  beforeEach(async () => {
    mock = createStoreMock();
    booksMock = { list: vi.fn(() => of(booksPage)) };
    notesMock = { list: vi.fn(() => of([note1, note2])) };
    readingServiceMock = { previewWeeklyReview: vi.fn(() => of(envelope(weeklyReview))) };
    await TestBed.configureTestingModule({
      imports: [ReadingTrainingComponent],
      providers: [
        { provide: ReadingTrainingStore, useValue: mock as unknown as ReadingTrainingStore },
        { provide: BooksService, useValue: booksMock as unknown as BooksService },
        { provide: NotesService, useValue: notesMock as unknown as NotesService },
        { provide: ReadingTrainingService, useValue: readingServiceMock as unknown as ReadingTrainingService },
      ],
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

  function clickByAria(label: string): void {
    const button = fixture.nativeElement.querySelector(
      `button[aria-label="${label}"]`
    ) as HTMLButtonElement;
    expect(button, `button[aria-label="${label}"]`).toBeTruthy();
    button.click();
    fixture.detectChanges();
  }

  function clickDialogButton(text: string): void {
    const dialogs = fixture.nativeElement.querySelectorAll('.dialog');
    expect(dialogs.length, 'an open dialog').toBeGreaterThan(0);
    const buttons = dialogs[dialogs.length - 1].querySelectorAll('button');
    const button = Array.from(buttons).find((b) => (b as HTMLButtonElement).textContent?.trim() === text);
    expect(button, `dialog button "${text}"`).toBeTruthy();
    (button as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  function setInput(selector: string, value: string): void {
    const el = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    expect(el, selector).toBeTruthy();
    el.value = value;
    el.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function setChecked(selector: string, checked: boolean): void {
    const el = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    expect(el, selector).toBeTruthy();
    el.checked = checked;
    el.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function setSelect(selector: string, value: string): void {
    const el = fixture.nativeElement.querySelector(selector) as HTMLSelectElement;
    expect(el, selector).toBeTruthy();
    el.value = value;
    el.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function openSessionFixture(status: ReadingSessionStatus, overrides: Partial<ReadingSession> = {}): void {
    mock.dashboard.set(initializedDashboard());
    mock.openSession.set(makeSession({ status, ...overrides }));
    fixture.detectChanges();
  }

  const forbidden = /streak|debt|catch.?up|guilt/i;

  it('connects on init and disconnects on destroy', () => {
    expect(mock.connect).toHaveBeenCalledTimes(1);
    fixture.destroy();
    expect(mock.disconnect).toHaveBeenCalledTimes(1);
  });

  it('leases notices only through the store-owned lifecycle; the page never calls loadNotifications', () => {
    expect(mock.connect).toHaveBeenCalledTimes(1);
    expect(mock.loadNotifications).not.toHaveBeenCalled();
  });

  it('renders a loading region while loading without a dashboard', () => {
    mock.loading.set(true);
    fixture.detectChanges();
    const status = fixture.debugElement.query(By.css('[role="status"]'));
    expect(status).toBeTruthy();
    expect(status.nativeElement.textContent).toContain('Loading reading training');
  });

  it('uses a symmetric loading ring instead of rotating the asymmetric refresh glyph', () => {
    mock.dashboard.set(initializedDashboard());
    fixture.detectChanges();
    const refresh = fixture.nativeElement.querySelector(
      'button[aria-label="Refresh reading training"]',
    ) as HTMLButtonElement;
    expect(refresh.querySelector('lucide-icon')).toBeTruthy();
    expect(refresh.querySelector('.refresh-spinner')).toBeNull();

    mock.loading.set(true);
    fixture.detectChanges();
    expect(refresh.querySelector('lucide-icon')).toBeNull();
    expect(refresh.querySelector('.refresh-spinner')).toBeTruthy();
  });

  it('renders an error panel without a dashboard and retries via refresh', () => {
    mock.error.set('Unable to load dashboard: network error');
    fixture.detectChanges();
    const alert = fixture.debugElement.query(By.css('[role="alert"]'));
    expect(alert.nativeElement.textContent).toContain('Unable to load dashboard');
    clickButton('Try again');
    expect(mock.refresh).toHaveBeenCalledTimes(1);
  });

  // --- stateVersion page attribute (UI/REST/MCP version identity) ---

  it('surfaces the retained stateVersion on the page root as data-state-version, non-visually', () => {
    const root = fixture.nativeElement.querySelector('.reading-training-page') as HTMLElement;
    expect(root).toBeTruthy();
    // Null before the first successful envelope: the attribute is absent.
    expect(root.hasAttribute('data-state-version')).toBe(false);

    mock.stateVersion.set('17');
    fixture.detectChanges();
    expect(root.getAttribute('data-state-version')).toBe('17');
    // Non-visual: the version is never rendered as page text or an element.
    expect(fixture.nativeElement.textContent).not.toContain('17');

    // The attribute mirrors the signal exactly: clearing it removes it again.
    mock.stateVersion.set(null);
    fixture.detectChanges();
    expect(root.hasAttribute('data-state-version')).toBe(false);
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

  it('keeps a confirmed not-initialized panel actionable during a background refresh', () => {
    mock.error.set('Unable to load dashboard: not_initialized');
    mock.loading.set(true);
    fixture.detectChanges();

    const panel = fixture.debugElement.query(By.css('.setup-panel'));
    expect(panel).toBeTruthy();
    const setup = Array.from(
      panel.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>
    ).find((button) => button.textContent?.trim() === 'Set up reading training');
    expect(setup).toBeTruthy();
    expect(setup!.disabled).toBe(false);

    setup!.click();
    expect(mock.initialize).toHaveBeenCalledTimes(1);
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

    // Active: Finish carries the reported minutes into completeSession.
    mock.openSession.set(makeSession({ status: ReadingSessionStatus.Active }));
    fixture.detectChanges();
    setInput('input[aria-label="Actual minutes read (optional)"]', '25');
    clickButton('Finish');
    expect(mock.completeSession).toHaveBeenCalledTimes(1);
    const completeReq = mock.completeSession.mock.calls[0][0] as { reportedMinutes?: number };
    expect(completeReq.reportedMinutes).toBe(25);

    // A later session must not inherit the previous session's minutes value.
    mock.openSession.set(makeSession({ id: 's2', status: ReadingSessionStatus.Active }));
    fixture.detectChanges();
    const nextMinutesInput = fixture.nativeElement.querySelector(
      'input[aria-label="Actual minutes read (optional)"]'
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

  // --- Task 7D: panels, forms, and manual workflows ---

  it('loads inbox and history once on connect', () => {
    expect(mock.loadInbox).toHaveBeenCalledTimes(1);
    expect(mock.loadHistory).toHaveBeenCalledTimes(1);
  });

  it('renders all committed panels beside the lanes and today card', () => {
    mock.dashboard.set(initializedDashboard());
    mock.books.set([enduranceBook, secondBook]);
    mock.inbox.set([capture]);
    mock.history.set([makeSession({ status: ReadingSessionStatus.Completed })]);
    mock.currentWeek.set(weekSummary);
    fixture.detectChanges();

    const page = fixture.nativeElement;
    expect(page.querySelector('app-week-strip')).toBeTruthy();
    expect(page.querySelector('app-active-books')).toBeTruthy();
    expect(page.querySelector('app-reading-inbox')).toBeTruthy();
    expect(page.querySelector('app-session-history')).toBeTruthy();
    // Inbox shows the real capture text and book title from store books.
    expect(page.textContent).toContain('What is virtue?');
    expect(page.textContent).toContain('Meditations');
    expect(page.textContent).toContain('Week 33');

    // Planner and feedback are hidden until their conditions are met.
    expect(page.querySelector('app-session-planner')).toBeNull();
    expect(page.querySelector('app-session-feedback')).toBeNull();

    mock.openSession.set(makeSession({ status: ReadingSessionStatus.AwaitingFeedback }));
    fixture.detectChanges();
    expect(page.querySelector('app-session-feedback')).toBeTruthy();
    expect(page.querySelector('app-session-planner')).toBeNull();
  });

  it('opens the planner explicitly and closes it when a session exists', () => {
    mock.dashboard.set(initializedDashboard());
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-session-planner')).toBeNull();

    clickButton('Plan a session');
    expect(fixture.nativeElement.querySelector('app-session-planner')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[role="dialog"][aria-modal="true"]')).toBeTruthy();

    clickButton('Close session planner');
    expect(fixture.nativeElement.querySelector('app-session-planner')).toBeNull();
    clickButton('Plan a session');

    // A real open session hides the planner and resets the open flag.
    mock.openSession.set(makeSession({ status: ReadingSessionStatus.Planned }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-session-planner')).toBeNull();

    // It does not reappear when the session ends; only an explicit action reopens it.
    mock.openSession.set(null);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-session-planner')).toBeNull();
    clickButton('Plan a session');
    expect(fixture.nativeElement.querySelector('app-session-planner')).toBeTruthy();
  });

  it('plans a session with constrained minutes mapped to targetMinutes', () => {
    mock.dashboard.set(initializedDashboard());
    mock.books.set([enduranceBook]);
    fixture.detectChanges();
    clickButton('Plan a session');

    setInput('#session-planner-target', '40');
    clickButton('Plan session');
    expect(mock.planSession).toHaveBeenCalledTimes(1);
    const plain = mock.planSession.mock.calls[0][0] as {
      bookAssignmentId: string;
      mode: ReadingMode;
      targetMinutes: number;
      constraint?: ReadingConstraint;
    };
    expect(plain.bookAssignmentId).toBe('a1');
    expect(plain.mode).toBe(ReadingMode.Endurance);
    expect(plain.targetMinutes).toBe(40);
    expect(plain.constraint).toBeUndefined();

    setChecked('#session-planner-constrained', true);
    setInput('#session-planner-constrained-minutes', '20');
    clickButton('Plan session');
    expect(mock.planSession).toHaveBeenCalledTimes(2);
    const constrained = mock.planSession.mock.calls[1][0] as {
      targetMinutes: number;
      constraint?: ReadingConstraint;
    };
    expect(constrained.targetMinutes).toBe(20);
    expect(constrained.constraint).toBe(ReadingConstraint.TimeConstrained);
  });

  it('start-now drops target and constraint and sends assignment plus mode', () => {
    mock.dashboard.set(initializedDashboard());
    mock.books.set([enduranceBook]);
    fixture.detectChanges();
    clickButton('Plan a session');

    setInput('#session-planner-target', '40');
    clickButton('Start now');
    expect(mock.startNewSession).toHaveBeenCalledTimes(1);
    const req = mock.startNewSession.mock.calls[0][0] as Record<string, unknown>;
    expect(req['bookAssignmentId']).toBe('a1');
    expect(req['mode']).toBe(ReadingMode.Endurance);
    expect(req['clientId']).toBeTruthy();
    expect(req['idempotencyKey']).toBeTruthy();
    expect(req).not.toHaveProperty('targetMinutes');
    expect(req).not.toHaveProperty('constraint');
    expect(mock.planSession).not.toHaveBeenCalled();
  });

  it('forwards active-book commands with exact DTO fields, stable client, fresh keys', () => {
    mock.dashboard.set(initializedDashboard());
    mock.books.set([enduranceBook, secondBook]);
    fixture.detectChanges();

    // Set default on the non-default Active book.
    clickByAria('Make Letters from a Stoic the default Endurance book');
    expect(mock.setDefaultBook).toHaveBeenCalledTimes(1);
    const defaultReq = mock.setDefaultBook.mock.calls[0][0] as Record<string, unknown>;
    expect(defaultReq['bookAssignmentId']).toBe('a2');
    expect(defaultReq['mode']).toBe(ReadingMode.Endurance);

    // Finish an Active book.
    clickByAria('Finish training book: Meditations');
    expect(mock.completeBook).toHaveBeenCalledTimes(1);
    const finishReq = mock.completeBook.mock.calls[0][0] as Record<string, unknown>;
    expect(finishReq['bookAssignmentId']).toBe('a1');

    // Reorder: moving Meditations down yields [a2, a1].
    clickByAria('Move Meditations down');
    expect(mock.reorderQueue).toHaveBeenCalledTimes(1);
    const reorderReq = mock.reorderQueue.mock.calls[0][0] as Record<string, unknown>;
    expect(reorderReq['assignmentIds']).toEqual(['a2', 'a1']);

    const clientId = defaultReq['clientId'];
    expect(clientId).toBeTruthy();
    expect(finishReq['clientId']).toBe(clientId);
    expect(reorderReq['clientId']).toBe(clientId);
    const keys = [defaultReq['idempotencyKey'], finishReq['idempotencyKey'], reorderReq['idempotencyKey']];
    expect(new Set(keys).size).toBe(3);
  });

  it('opens the book form from a lane with the preferred mode and maps the real catalogue', () => {
    const booksSubject = new Subject<PaginatedResponse<Book>>();
    booksMock.list.mockReturnValue(booksSubject);
    mock.dashboard.set(initializedDashboard());
    fixture.detectChanges();

    clickByAria('Add book to Deep');
    const dialog = fixture.nativeElement.querySelector('.dialog') as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // Deterministic loading state first.
    expect(dialog.textContent).toContain('Loading library books…');

    booksSubject.next(booksPage);
    booksSubject.complete();
    fixture.detectChanges();

    const bookSelect = dialog.querySelector('#book-assignment-book') as HTMLSelectElement;
    expect(bookSelect.value).toBe('lib1');
    expect(dialog.textContent).toContain('The Enchiridion — Epictetus');
    const modeSelect = dialog.querySelector('#book-assignment-mode') as HTMLSelectElement;
    expect(modeSelect.value).toBe(String(ReadingMode.Deep));

    setChecked('#book-assignment-make-default', true);
    clickDialogButton('Add book');
    expect(mock.addBook).toHaveBeenCalledTimes(1);
    const req = mock.addBook.mock.calls[0][0] as Record<string, unknown>;
    expect(req['bookId']).toBe('lib1');
    expect(req['mode']).toBe(ReadingMode.Deep);
    expect(req['makeDefault']).toBe(true);
    expect(req['clientId']).toBeTruthy();
    expect(req['idempotencyKey']).toBeTruthy();
    // Dialog closes on command success.
    expect(fixture.nativeElement.querySelector('.dialog')).toBeNull();
  });

  it('surfaces catalogue loading failures with a retry that never invents books', () => {
    booksMock.list.mockReturnValueOnce(throwError(() => new Error('catalogue down')));
    mock.dashboard.set(initializedDashboard());
    fixture.detectChanges();

    clickByAria('Add book to Endurance');
    let dialog = fixture.nativeElement.querySelector('.dialog') as HTMLElement;
    expect(dialog.textContent).toContain('Unable to load the library book list.');
    expect(dialog.querySelector('app-book-assignment-form')).toBeNull();

    clickDialogButton('Retry loading books');
    dialog = fixture.nativeElement.querySelector('.dialog') as HTMLElement;
    expect(dialog.querySelector('#book-assignment-book')).toBeTruthy();
    expect(booksMock.list).toHaveBeenCalledTimes(2);
  });

  it('captures verbatim text enriched with the open session, then reloads the inbox', () => {
    openSessionFixture(ReadingSessionStatus.Active);
    clickButton('Capture');
    expect(fixture.nativeElement.querySelector('.dialog')).toBeTruthy();

    setInput('#capture-form-text', '  A thought worth keeping  ');
    clickDialogButton('Save capture');
    expect(mock.capture).toHaveBeenCalledTimes(1);
    const req = mock.capture.mock.calls[0][0] as Record<string, unknown>;
    expect(req['text']).toBe('  A thought worth keeping  ');
    expect(req['type']).toBe(ReadingCaptureType.Thought);
    expect(req['bookId']).toBe('b1');
    expect(req['sessionId']).toBe('s1');
    expect(req['clientId']).toBeTruthy();
    expect(req['idempotencyKey']).toBeTruthy();
    // Dialog closes on success and the inbox reloads.
    expect(fixture.nativeElement.querySelector('.dialog')).toBeNull();
    expect(mock.loadInbox).toHaveBeenCalledTimes(2);
  });

  it('captures without an open session omit book and session enrichment', () => {
    mock.dashboard.set(initializedDashboard());
    fixture.detectChanges();
    clickButton('Capture');
    setInput('#capture-form-text', 'standalone note');
    setSelect('#capture-form-type', String(ReadingCaptureType.Question));
    clickDialogButton('Save capture');
    const req = mock.capture.mock.calls[0][0] as Record<string, unknown>;
    expect(req['text']).toBe('standalone note');
    expect(req['type']).toBe(ReadingCaptureType.Question);
    expect(req).not.toHaveProperty('bookId');
    expect(req).not.toHaveProperty('sessionId');
  });

  it('reloads the inbox after resolve (keep and dismiss) and promote successes', () => {
    mock.dashboard.set(initializedDashboard());
    mock.inbox.set([capture]);
    fixture.detectChanges();

    clickButton('Keep');
    expect(mock.resolveCapture).toHaveBeenCalledWith('c1', expect.objectContaining({ keep: true }));
    expect(mock.loadInbox).toHaveBeenCalledTimes(2);

    clickButton('Dismiss');
    expect(mock.resolveCapture).toHaveBeenCalledWith('c1', expect.objectContaining({ keep: false }));
    expect(mock.loadInbox).toHaveBeenCalledTimes(3);

    clickButton('Promote to note');
    expect(notesMock.list).toHaveBeenCalledWith('b1');
    setSelect('#note-chooser-select', 'n1');
    clickDialogButton('Promote capture');
    expect(mock.promoteCapture).toHaveBeenCalledWith('c1', expect.objectContaining({ noteId: 'n1' }));
    expect(mock.loadInbox).toHaveBeenCalledTimes(4);
    expect(fixture.nativeElement.querySelector('.dialog')).toBeNull();
  });

  it('requires choosing an existing note before promoting', () => {
    mock.dashboard.set(initializedDashboard());
    mock.inbox.set([capture]);
    fixture.detectChanges();
    clickButton('Promote to note');

    const dialog = fixture.nativeElement.querySelector('.dialog') as HTMLElement;
    const promote = Array.from(dialog.querySelectorAll('button')).find(
      (b) => (b as HTMLButtonElement).textContent?.trim() === 'Promote capture'
    ) as HTMLButtonElement;
    expect(promote.disabled).toBe(true);
    // No note id may be invented: nothing is dispatched before a choice.
    promote.click();
    fixture.detectChanges();
    expect(mock.promoteCapture).not.toHaveBeenCalled();

    setSelect('#note-chooser-select', 'n2');
    expect(promote.disabled).toBe(false);
    promote.click();
    fixture.detectChanges();
    expect(mock.promoteCapture).toHaveBeenCalledWith('c1', expect.objectContaining({ noteId: 'n2' }));
  });

  it('rates in two steps with fresh keys and reloads history only on success', () => {
    openSessionFixture(ReadingSessionStatus.AwaitingFeedback);
    setInput('#session-feedback-minutes', '25');
    setInput('#session-feedback-effort', '7');
    setInput('#session-feedback-focus', '6');
    clickButton('Log ratings');

    expect(mock.completeSession).toHaveBeenCalledTimes(1);
    const completeReq = mock.completeSession.mock.calls[0][0] as Record<string, unknown>;
    expect(completeReq['reportedMinutes']).toBe(25);
    expect(completeReq['clientId']).toBeTruthy();

    expect(mock.rateSession).toHaveBeenCalledTimes(1);
    const rateReq = mock.rateSession.mock.calls[0][0] as Record<string, unknown>;
    expect(rateReq['effort']).toBe(7);
    expect(rateReq['focus']).toBe(6);
    expect(rateReq['clientId']).toBe(completeReq['clientId']);
    expect(rateReq['idempotencyKey']).not.toBe(completeReq['idempotencyKey']);
    expect(mock.loadHistory).toHaveBeenCalledTimes(2);
  });

  it('never sends ratings when the first step fails', () => {
    openSessionFixture(ReadingSessionStatus.AwaitingFeedback);
    mock.completeSession.mockReturnValueOnce(throwError(() => new Error('complete failed')));
    setInput('#session-feedback-minutes', '25');
    setInput('#session-feedback-effort', '7');
    setInput('#session-feedback-focus', '6');
    clickButton('Log ratings');

    expect(mock.completeSession).toHaveBeenCalledTimes(1);
    expect(mock.rateSession).not.toHaveBeenCalled();
    expect(mock.loadHistory).toHaveBeenCalledTimes(1);
  });

  it('skips ratings and reloads history', () => {
    openSessionFixture(ReadingSessionStatus.AwaitingFeedback);
    clickButton('Skip ratings');
    expect(mock.skipRatings).toHaveBeenCalledTimes(1);
    const req = mock.skipRatings.mock.calls[0][0] as { clientId: string; idempotencyKey: string };
    expect(req.clientId).toBeTruthy();
    expect(req.idempotencyKey).toBeTruthy();
    expect(mock.loadHistory).toHaveBeenCalledTimes(2);
  });

  it('reloads history after a today-session finish as well', () => {
    openSessionFixture(ReadingSessionStatus.Active);
    setInput('input[aria-label="Actual minutes read (optional)"]', '30');
    clickButton('Finish');
    expect(mock.completeSession).toHaveBeenCalledTimes(1);
    expect(mock.loadHistory).toHaveBeenCalledTimes(2);
  });

  it('previews the exact week through the GET endpoint and commits with a fresh key', () => {
    mock.dashboard.set(initializedDashboard());
    mock.currentWeek.set(weekSummary);
    fixture.detectChanges();

    clickButton('Review week');
    expect(readingServiceMock.previewWeeklyReview).toHaveBeenCalledWith(2026, 33);

    const dialog = fixture.nativeElement.querySelector('.dialog') as HTMLElement;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.textContent).toContain('2026-W33');
    expect(dialog.textContent).toContain('Increase target');
    expect(dialog.textContent).toContain('40 → 45 min');
    expect(dialog.textContent).toContain('67%');

    // A failed commit keeps the dialog open; a later success closes it.
    mock.commitWeeklyReview.mockReturnValueOnce(throwError(() => new Error('commit failed')));
    clickDialogButton('Commit weekly review');
    expect(mock.commitWeeklyReview).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('.dialog')).toBeTruthy();

    clickDialogButton('Commit weekly review');
    expect(mock.commitWeeklyReview).toHaveBeenCalledTimes(2);
    const req = mock.commitWeeklyReview.mock.calls[1][0] as Record<string, unknown>;
    expect(req['year']).toBe(2026);
    expect(req['week']).toBe(33);
    expect(req['clientId']).toBeTruthy();
    expect(req['idempotencyKey']).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.dialog')).toBeNull();
  });

  it('shows a preview error when the week cannot be previewed', () => {
    readingServiceMock.previewWeeklyReview.mockReturnValueOnce(
      throwError(() => new Error('preview down'))
    );
    mock.dashboard.set(initializedDashboard());
    mock.currentWeek.set(weekSummary);
    fixture.detectChanges();

    clickButton('Review week');
    const dialog = fixture.nativeElement.querySelector('.dialog') as HTMLElement;
    expect(dialog.textContent).toContain("Unable to preview this week's review.");
    // The dialog stays open so the reader can close it and try again.
    expect(dialog).toBeTruthy();
  });

  it('keeps dialogs accessible and disables mutation controls while busy', () => {
    mock.dashboard.set(initializedDashboard());
    fixture.detectChanges();
    clickButton('Capture');

    const dialog = fixture.nativeElement.querySelector('.dialog') as HTMLElement;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    // Focus moves into the opened dialog for keyboard users.
    expect(document.activeElement).toBe(dialog);

    mock.mutating.set(true);
    fixture.detectChanges();
    const save = Array.from(dialog.querySelectorAll('button')).find(
      (b) => (b as HTMLButtonElement).textContent?.trim() === 'Save capture'
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    // The close affordance stays available while a mutation is in flight.
    const close = dialog.querySelector('button[aria-label="Close capture dialog"]') as HTMLButtonElement;
    expect(close.disabled).toBe(false);

    // No gamified language anywhere, dialogs included.
    expect(fixture.nativeElement.textContent).not.toMatch(forbidden);
  });

  it('shows a polite loading region inside the note chooser until notes arrive', () => {
    const notesSubject = new Subject<Note[]>();
    notesMock.list.mockReturnValue(notesSubject);
    mock.dashboard.set(initializedDashboard());
    mock.inbox.set([capture]);
    fixture.detectChanges();

    clickButton('Promote to note');
    let dialog = fixture.nativeElement.querySelector('.dialog') as HTMLElement;
    expect(dialog.querySelector('[role="status"]')?.textContent).toContain('Loading notes…');

    notesSubject.next([note1]);
    notesSubject.complete();
    fixture.detectChanges();
    dialog = fixture.nativeElement.querySelector('.dialog') as HTMLElement;
    expect(dialog.querySelector('[role="status"]')).toBeNull();
    expect(dialog.textContent).toContain('First line of the note');
  });

  it('offers only Active assignments for the planner; queued assignments are never plan candidates', () => {
    const queuedBook: ReadingBookAssignment = {
      ...secondBook,
      id: 'a3',
      bookId: 'b3',
      bookTitle: 'On the Shortness of Life',
      status: ReadingAssignmentStatus.Queued,
      queueOrder: 1,
    };
    mock.dashboard.set(initializedDashboard());
    mock.books.set([enduranceBook, queuedBook]);
    fixture.detectChanges();

    clickButton('Plan a session');
    const planner = fixture.nativeElement.querySelector('app-session-planner') as HTMLElement;
    expect(planner).toBeTruthy();
    const bookSelect = planner.querySelector('#session-planner-book') as HTMLSelectElement;
    expect(bookSelect).toBeTruthy();
    const titles = Array.from(bookSelect.querySelectorAll('option')).map((o) =>
      (o as HTMLOptionElement).textContent?.trim()
    );
    expect(titles).toContain('Meditations');
    expect(titles).not.toContain('On the Shortness of Life');
  });

  it('traps Tab focus inside a dialog, closes with Escape, and restores trigger focus', () => {
    mock.dashboard.set(initializedDashboard());
    fixture.detectChanges();

    const captureButton = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (b) => (b as HTMLButtonElement).textContent?.trim() === 'Capture'
    ) as HTMLButtonElement;
    captureButton.focus();
    captureButton.click();
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('.dialog') as HTMLElement;
    expect(document.activeElement).toBe(dialog);

    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea')).filter(
      (el) => !(el as HTMLButtonElement).disabled
    );
    expect(focusables.length).toBeGreaterThanOrEqual(2);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    // Tab from the last focusable wraps to the first.
    last.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(first);

    // Shift+Tab from the first focusable wraps to the last.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(last);

    // Escape closes the active dialog and restores focus to the trigger.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dialog')).toBeNull();
    expect(document.activeElement).toBe(captureButton);
  });

  it('registers the focus-trap keydown listener only while a dialog is open and cleans it up on destroy', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    mock.dashboard.set(initializedDashboard());
    fixture.detectChanges();

    // No listener before any dialog opens.
    expect(addSpy).not.toHaveBeenCalledWith('keydown', expect.any(Function), true);

    clickButton('Capture');
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);

    // Closing via the close button removes the single listener again.
    clickByAria('Close capture dialog');
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    removeSpy.mockClear();

    // Destroying the page with a dialog still open also removes the listener.
    clickButton('Capture');
    fixture.destroy();
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
  });

  it('ignores a stale weekly preview response after a newer preview superseded it', () => {
    const firstPreview = new Subject<ReadingCommandResult<ReadingWeeklyReview>>();
    readingServiceMock.previewWeeklyReview.mockReturnValueOnce(firstPreview);
    mock.dashboard.set(initializedDashboard());
    mock.currentWeek.set(weekSummary);
    fixture.detectChanges();

    clickButton('Review week');
    const dialog = fixture.nativeElement.querySelector('.dialog') as HTMLElement;
    expect(dialog.textContent).toContain('Preparing the weekly review…');

    // Close and reopen — the newer preview request supersedes the first.
    const secondPreview = new Subject<ReadingCommandResult<ReadingWeeklyReview>>();
    readingServiceMock.previewWeeklyReview.mockReturnValueOnce(secondPreview);
    clickByAria('Close weekly review dialog');
    fixture.detectChanges();
    clickButton('Review week');

    const newerReview: ReadingWeeklyReview = { ...weeklyReview, totalVolumeMinutes: 999 };
    secondPreview.next(envelope(newerReview));
    secondPreview.complete();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('999 min this week');

    // The stale first response lands late and must not overwrite the newer week.
    firstPreview.next(envelope(weeklyReview));
    firstPreview.complete();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('999 min this week');
    expect(fixture.nativeElement.textContent).not.toContain('60 min this week');
  });

  it('stops page callbacks after destroy while the store still owns the in-flight command', () => {
    const completeSubject = new Subject<ReadingCommandResult<ReadingSession>>();
    mock.completeSession.mockReturnValue(completeSubject);
    openSessionFixture(ReadingSessionStatus.Active);
    setInput('input[aria-label="Actual minutes read (optional)"]', '30');
    clickButton('Finish');
    expect(mock.completeSession).toHaveBeenCalledTimes(1);

    fixture.destroy();

    // The page subscription is torn down: the late result must not run page
    // callbacks (no history reload) and must not throw.
    completeSubject.next(envelope(makeSession({ status: ReadingSessionStatus.Completed })));
    completeSubject.complete();
    expect(mock.loadHistory).toHaveBeenCalledTimes(1);
  });

  it('renders the pending notices panel with store notices inside the initialized workspace', () => {
    mock.dashboard.set(initializedDashboard());
    mock.pendingNotices.set([pendingNotice1, pendingNotice2]);
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('app-pending-notices') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain('Reading notices');
    expect(panel.textContent).toContain('Endurance');
    expect(panel.textContent).toContain('Recovery');
    expect(panel.textContent).toContain('Acknowledge');
    expect((panel.querySelector('.count-badge') as HTMLElement).textContent?.trim()).toBe('2');

    // Outside the initialized workspace (no dashboard) the panel is absent.
    mock.dashboard.set(null);
    mock.error.set(null);
    mock.loading.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-pending-notices')).toBeNull();
  });

  it('omits the pending notices panel entirely while no notices are pending, and restores it when one arrives', () => {
    mock.dashboard.set(initializedDashboard());
    mock.pendingNotices.set([]);
    fixture.detectChanges();

    // Empty collection: no empty-state framing, no panel at all.
    expect(fixture.nativeElement.querySelector('app-pending-notices')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Reading notices');
    expect(fixture.nativeElement.textContent).not.toContain('No reading notices waiting');

    // A single notice brings the panel back with its content.
    mock.pendingNotices.set([pendingNotice1]);
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('app-pending-notices') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain('Reading notices');
    expect(panel.textContent).toContain('Endurance');

    // Acknowledged away: the panel disappears again without empty-state filler.
    mock.pendingNotices.set([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-pending-notices')).toBeNull();
  });

  it('places Today and session feedback directly after the action toolbar, above the week ledger and capacity lanes', () => {
    mock.dashboard.set(initializedDashboard());
    fixture.detectChanges();

    const root = fixture.nativeElement;
    const toolbar = root.querySelector('.toolbar') as HTMLElement;
    const today = root.querySelector('app-today-session') as HTMLElement;
    const week = root.querySelector('app-week-strip') as HTMLElement;
    const lanes = root.querySelector('app-capacity-lanes') as HTMLElement;
    expect(toolbar).toBeTruthy();
    expect(today).toBeTruthy();
    expect(week).toBeTruthy();
    expect(lanes).toBeTruthy();

    // Today is the first section: it follows the toolbar with nothing between.
    expect(toolbar.nextElementSibling?.tagName).toBe('APP-TODAY-SESSION');

    // …and precedes the week ledger and capacity lanes.
    expect(today.compareDocumentPosition(week) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(today.compareDocumentPosition(lanes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Session feedback follows Today immediately when ratings are pending.
    mock.openSession.set(makeSession({ status: ReadingSessionStatus.AwaitingFeedback }));
    fixture.detectChanges();
    const feedback = root.querySelector('app-session-feedback') as HTMLElement;
    expect(feedback).toBeTruthy();
    expect(today.compareDocumentPosition(feedback) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(feedback.compareDocumentPosition(week) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('acknowledge forwards the exact notification id with no idempotency envelope', () => {
    mock.dashboard.set(initializedDashboard());
    mock.pendingNotices.set([pendingNotice1]);
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('app-pending-notices') as HTMLElement;
    const ackButton = panel.querySelector('.acknowledge-button') as HTMLButtonElement;
    expect(ackButton).toBeTruthy();
    ackButton.click();
    fixture.detectChanges();

    expect(mock.acknowledgeNotification).toHaveBeenCalledTimes(1);
    expect(mock.acknowledgeNotification).toHaveBeenCalledWith(pendingNotice1.notificationId);
    // Exactly one argument: the id — no key, no command envelope.
    expect(mock.acknowledgeNotification.mock.calls[0]).toHaveLength(1);
  });

  it('never removes a notice locally: removal is store-driven after a confirmed ack', () => {
    mock.dashboard.set(initializedDashboard());
    mock.pendingNotices.set([pendingNotice1]);
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('app-pending-notices') as HTMLElement;
    (panel.querySelector('.acknowledge-button') as HTMLButtonElement).click();
    fixture.detectChanges();

    // The page forwards the id only; the notices signal is untouched here
    // (the real store removes the row only on `{ acknowledged: true }`).
    expect(mock.pendingNotices()).toEqual([pendingNotice1]);
  });

  it('an ack failure neither removes the notice nor throws', () => {
    mock.dashboard.set(initializedDashboard());
    mock.pendingNotices.set([pendingNotice1]);
    mock.acknowledgeNotification.mockReturnValueOnce(throwError(() => new Error('ack failed')));
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('app-pending-notices') as HTMLElement;
    (panel.querySelector('.acknowledge-button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(mock.acknowledgeNotification).toHaveBeenCalledWith(pendingNotice1.notificationId);
    expect(mock.pendingNotices()).toEqual([pendingNotice1]); // preserved
  });

  it('disables acknowledge buttons only while a notification lease/ack is busy', () => {
    mock.dashboard.set(initializedDashboard());
    mock.pendingNotices.set([pendingNotice1]);
    fixture.detectChanges();

    let ackButton = fixture.nativeElement.querySelector(
      'app-pending-notices .acknowledge-button'
    ) as HTMLButtonElement;
    expect(ackButton.disabled).toBe(false);

    // A lease or ack in flight disables the panel's buttons.
    mock.notificationsBusy.set(true);
    fixture.detectChanges();
    ackButton = fixture.nativeElement.querySelector(
      'app-pending-notices .acknowledge-button'
    ) as HTMLButtonElement;
    expect(ackButton.disabled).toBe(true);

    // An unrelated domain mutation must not disable the notices panel.
    mock.notificationsBusy.set(false);
    mock.mutating.set(true);
    fixture.detectChanges();
    ackButton = fixture.nativeElement.querySelector(
      'app-pending-notices .acknowledge-button'
    ) as HTMLButtonElement;
    expect(ackButton.disabled).toBe(false);
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
