import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { BookDetail } from './book-detail.component';
import { Book } from '../core/dtos/book.dtos';
import { ToastService } from '../core/services/toast.service';
import {
  ReadingAssignmentStatus,
  ReadingBookAssignment,
  ReadingCommandResult,
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

const book: Book = {
  id: 'b1',
  title: 'Meditations',
  subtitle: null,
  author: 'Marcus Aurelius',
  editor: null,
  translator: null,
  narrator: null,
  description: null,
  type: 'ebook',
  edition: null,
  asin: null,
  duration: null,
  isbn: null,
  publisher: null,
  placeOfPublication: null,
  publishedDate: null,
  pageCount: null,
  language: null,
  categories: null,
  series: null,
  volumeNumber: null,
  createdAt: '2026-08-01T08:00:00+02:00',
  hasFile: false,
  fileName: null,
  coverUrl: null,
  collectionId: null,
  lastLocation: null,
  progressPercent: 0,
  lastReadAt: null,
  rating: 0,
  isFavorite: false,
  personalReview: null,
  finishedAt: null,
};

function makeAssignment(overrides: Partial<ReadingBookAssignment> = {}): ReadingBookAssignment {
  return {
    id: 'a1',
    bookId: book.id,
    bookTitle: book.title,
    bookAuthor: book.author,
    mode: ReadingMode.Endurance,
    status: ReadingAssignmentStatus.Active,
    queueOrder: 0,
    isDefault: true,
    createdAt: '2026-08-09T08:00:00+02:00',
    startedAt: '2026-08-09T08:00:00+02:00',
    completedAt: null,
    ...overrides,
  };
}

function makeSession(overrides: Partial<ReadingSession> = {}): ReadingSession {
  return {
    id: 's1',
    bookAssignmentId: 'a1',
    bookId: book.id,
    bookTitle: book.title,
    mode: ReadingMode.Endurance,
    status: ReadingSessionStatus.Completed,
    targetMinutes: 40,
    plannedTargetMinutes: 40,
    constraint: 0,
    progressionEligible: true,
    countsAsFailure: false,
    accumulatedSeconds: 1500,
    measuredSeconds: 1500,
    reportedMinutes: 25,
    effort: 7,
    focus: 6,
    rating: null,
    ratingsSkipped: false,
    plannedAt: '2026-08-09T08:00:00+02:00',
    startedAt: '2026-08-09T08:05:00+02:00',
    lastStartedAt: '2026-08-09T08:05:00+02:00',
    pausedAt: null,
    completedAt: '2026-08-09T08:30:00+02:00',
    ...overrides,
  };
}

function envelope<T>(data: T | null, reply = 'ok', stateVersion = '1'): ReadingCommandResult<T> {
  return { reply, data, stateVersion, duplicate: false };
}

function dashboard(assignments: ReadingBookAssignment[]): ReadingDashboard {
  return { programme, books: assignments, openSession: null, currentWeek: null };
}

describe('BookDetail reading training section', () => {
  let component: BookDetail;
  let fixture: ComponentFixture<BookDetail>;
  let httpMock: HttpTestingController;

  /** Boots the component with a stub route emitting `library/:id` = b1. */
  async function setup() {
    fixture = TestBed.createComponent(BookDetail);
    component = fixture.componentInstance;
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Flushes the requests fired on mount for a given reading dashboard + history. */
  function flushInitialLoads(assignments: ReadingBookAssignment[], sessions: ReadingSession[]) {
    httpMock.expectOne('/api/books/b1').flush(book);
    httpMock.expectOne('/api/books/b1/notes').flush([]);
    httpMock.expectOne('/api/collections').flush([]);
    httpMock.match('/api/concepts').forEach((request) => request.flush([]));
    httpMock.expectOne('/api/reading/dashboard').flush(envelope(dashboard(assignments)));
    httpMock.expectOne('/api/reading/sessions').flush(envelope(sessions));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BookDetail],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: book.id })) },
        },
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Concept autocomplete may schedule its own list request after the parent
    // store's request has been flushed; it is unrelated to Reading Training.
    httpMock.match('/api/concepts').forEach((request) => request.flush([]));
    httpMock.verify();
  });

  it('should create', async () => {
    await setup();
    flushInitialLoads([], []);
    expect(component).toBeTruthy();
  });

  it('offers Endurance and Deep assignment buttons and an empty sessions note when the book is not in training', async () => {
    await setup();
    flushInitialLoads([], []);

    const assignButtons = fixture.nativeElement.querySelectorAll('.training-assign-btn');
    expect(assignButtons.length).toBe(2);
    expect(assignButtons[0].textContent).toContain('Endurance');
    expect(assignButtons[1].textContent).toContain('Deep');
    expect(fixture.nativeElement.textContent).toContain('No reading sessions for this book yet.');
    expect(fixture.nativeElement.querySelectorAll('.training-default-btn').length).toBe(0);
  });

  it('assigns the book with a fresh idempotency key, then refreshes the dashboard and history', async () => {
    await setup();
    flushInitialLoads([], []);

    fixture.nativeElement.querySelectorAll('.training-assign-btn')[0].click();
    fixture.detectChanges();

    const post = httpMock.expectOne(
      (req) => req.method === 'POST' && req.url === '/api/reading/books'
    );
    const body = post.request.body as { clientId: string; idempotencyKey: string; bookId: string; mode: number; makeDefault: boolean };
    expect(body.bookId).toBe(book.id);
    expect(body.mode).toBe(ReadingMode.Endurance);
    expect(body.makeDefault).toBe(false);
    expect(body.clientId.length).toBeGreaterThan(0);
    expect(body.idempotencyKey.length).toBeGreaterThan(0);

    // Authoritative refresh must follow the mutation before history reloads.
    post.flush(
      envelope(makeAssignment({ isDefault: false }), 'Meditations added to the reading queue.', '2')
    );
    const refreshed = httpMock.expectOne('/api/reading/dashboard');
    refreshed.flush(envelope(dashboard([makeAssignment({ isDefault: false })]), 'Dashboard.', '2'));
    const history = httpMock.expectOne('/api/reading/sessions');
    history.flush(envelope([]));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Meditations added to the reading queue.');
    expect(fixture.nativeElement.querySelectorAll('.training-default-btn').length).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('.training-assign-btn').length).toBe(1);
  });

  it('makes an active non-default assignment the default for its mode', async () => {
    await setup();
    flushInitialLoads([makeAssignment({ isDefault: false })], []);

    fixture.nativeElement.querySelector('.training-default-btn').click();
    fixture.detectChanges();

    const post = httpMock.expectOne(
      (req) => req.method === 'PATCH' && req.url === '/api/reading/books/a1'
    );
    const body = post.request.body as { clientId: string; idempotencyKey: string; bookAssignmentId: string; mode: number };
    expect(body.bookAssignmentId).toBe('a1');
    expect(body.mode).toBe(ReadingMode.Endurance);
    expect(body.idempotencyKey.length).toBeGreaterThan(0);

    post.flush(envelope(makeAssignment({ isDefault: true }), 'Meditations is now the default Endurance book.', '2'));
    httpMock.expectOne('/api/reading/dashboard').flush(envelope(dashboard([makeAssignment()]), 'Dashboard.', '2'));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Meditations is now the default Endurance book.');
    expect(fixture.nativeElement.textContent).toContain('Default');
    expect(fixture.nativeElement.querySelectorAll('.training-default-btn').length).toBe(0);
  });

  it('shows a Default badge for the active default assignment and does not offer make-default', async () => {
    await setup();
    flushInitialLoads([makeAssignment({ isDefault: true })], []);

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Default');
    expect(fixture.nativeElement.querySelectorAll('.training-default-btn').length).toBe(0);
    expect(fixture.nativeElement.querySelectorAll('.training-assign-btn').length).toBe(1);
  });

  it('shows Queued and Completed badges without offering make-default for non-active assignments', async () => {
    await setup();
    flushInitialLoads(
      [
        makeAssignment({
          id: 'a-queued',
          status: ReadingAssignmentStatus.Queued,
          queueOrder: 1,
          isDefault: false,
        }),
        makeAssignment({
          id: 'a-completed',
          mode: ReadingMode.Deep,
          status: ReadingAssignmentStatus.Completed,
          queueOrder: 2,
          isDefault: false,
          completedAt: '2026-08-09T09:00:00+02:00',
        }),
      ],
      []
    );

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Queued');
    expect(text).toContain('Completed');
    expect(fixture.nativeElement.querySelectorAll('.training-default-btn').length).toBe(0);
    expect(fixture.nativeElement.querySelectorAll('.training-assign-btn').length).toBe(0);
  });

  it('shows only this book’s sessions, capped at five, and excludes other books', async () => {
    const own = Array.from({ length: 6 }, (_, i) =>
      makeSession({
        id: `s-own-${i}`,
        plannedAt: `2026-08-0${i + 1}T08:00:00+02:00`,
        completedAt: `2026-08-0${i + 1}T08:30:00+02:00`,
        reportedMinutes: 20 + i,
      })
    ).reverse();
    const other = makeSession({
      id: 's-other',
      bookId: 'b2',
      bookTitle: 'Letters from a Stoic',
      plannedAt: '2026-08-09T10:00:00+02:00',
      completedAt: '2026-08-09T10:30:00+02:00',
    });

    await setup();
    flushInitialLoads([], [other, ...own]);

    const items = fixture.nativeElement.querySelectorAll('.training-session-item');
    expect(items.length).toBe(5);
    expect(fixture.nativeElement.textContent).not.toContain('Letters from a Stoic');
    expect(items[0].textContent).toContain('25 min');
    expect(items[4].textContent).toContain('21 min');
  });

  it('shows a loading status while the dashboard is still in flight', async () => {
    await setup();
    httpMock.expectOne('/api/books/b1').flush(book);
    httpMock.expectOne('/api/books/b1/notes').flush([]);
    httpMock.expectOne('/api/collections').flush([]);
    httpMock.match('/api/concepts').forEach((request) => request.flush([]));
    fixture.detectChanges();

    const status = fixture.nativeElement.querySelector('.training-section [role="status"]');
    expect(status).toBeTruthy();
    expect(status.textContent).toContain('Loading reading training');

    httpMock.expectOne('/api/reading/dashboard').flush(envelope(dashboard([])));
    httpMock.expectOne('/api/reading/sessions').flush(envelope([]));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.training-assign-btn').length).toBe(2);
  });

  it('shows a loading status while sessions are being fetched', async () => {
    await setup();
    httpMock.expectOne('/api/books/b1').flush(book);
    httpMock.expectOne('/api/books/b1/notes').flush([]);
    httpMock.expectOne('/api/collections').flush([]);
    httpMock.match('/api/concepts').forEach((request) => request.flush([]));
    httpMock.expectOne('/api/reading/dashboard').flush(envelope(dashboard([])));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Loading sessions');

    httpMock.expectOne('/api/reading/sessions').flush(envelope([]));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No reading sessions for this book yet.');
  });

  it('shows the not-initialized state with a link to the training page instead of assignment controls', async () => {
    await setup();
    httpMock.expectOne('/api/books/b1').flush(book);
    httpMock.expectOne('/api/books/b1/notes').flush([]);
    httpMock.expectOne('/api/collections').flush([]);
    httpMock.match('/api/concepts').forEach((request) => request.flush([]));
    httpMock
      .expectOne('/api/reading/dashboard')
      .flush(envelope({ code: 'not_initialized' }, 'not_initialized', '0'));
    httpMock.expectOne('/api/reading/sessions').flush(envelope(null, 'not_initialized', '0'));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Reading training is not set up yet');
    expect(fixture.nativeElement.querySelectorAll('.training-assign-btn').length).toBe(0);
    const link = fixture.nativeElement.querySelector('a[routerlink="/training"]');
    expect(link).toBeTruthy();
  });

  it('disables controls while a command is in flight', async () => {
    await setup();
    flushInitialLoads([], []);

    fixture.nativeElement.querySelector('.training-assign-btn').click();
    fixture.detectChanges();

    const disabled = fixture.nativeElement.querySelectorAll('button:disabled');
    expect(disabled.length).toBeGreaterThan(0);

    httpMock
      .expectOne((req) => req.method === 'POST' && req.url === '/api/reading/books')
      .flush(envelope(makeAssignment({ isDefault: false }), 'Meditations added to the reading queue.', '2'));
    httpMock.expectOne('/api/reading/dashboard').flush(envelope(dashboard([makeAssignment({ isDefault: false })]), 'Dashboard.', '2'));
    httpMock.expectOne('/api/reading/sessions').flush(envelope([]));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('button:disabled').length).toBe(0);
  });

  it('surfaces a command failure in an alert region and never refreshes snapshots', async () => {
    await setup();
    flushInitialLoads([], []);

    fixture.nativeElement.querySelector('.training-assign-btn').click();
    fixture.detectChanges();

    httpMock
      .expectOne((req) => req.method === 'POST' && req.url === '/api/reading/books')
      .flush(
        { data: { code: 'book_not_found' } },
        { status: 400, statusText: 'Bad Request' }
      );
    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector('.training-section [role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain('book_not_found');
    expect(fixture.nativeElement.querySelectorAll('button:disabled').length).toBe(0);
  });

  it('exposes a keyboard-accessible, labelled section with a polite status region', async () => {
    await setup();
    flushInitialLoads([makeAssignment({ isDefault: false })], [makeSession()]);

    const section = fixture.nativeElement.querySelector('.training-section');
    expect(section.getAttribute('aria-labelledby')).toBe('training-heading');
    expect(fixture.nativeElement.querySelector('#training-heading').textContent).toContain('Reading Training');

    const buttons = fixture.nativeElement.querySelectorAll('.training-section button');
    buttons.forEach((button: HTMLButtonElement) => {
      expect(button.type).toBe('button');
      expect(button.getAttribute('aria-label')?.length).toBeGreaterThan(0);
    });

    fixture.nativeElement.querySelector('.training-default-btn').click();
    fixture.detectChanges();
    httpMock
      .expectOne((req) => req.method === 'PATCH' && req.url === '/api/reading/books/a1')
      .flush(envelope(makeAssignment({ isDefault: true }), 'Meditations is now the default Endurance book.', '2'));
    httpMock.expectOne('/api/reading/dashboard').flush(envelope(dashboard([makeAssignment()]), 'Dashboard.', '2'));
    fixture.detectChanges();

    const status = fixture.nativeElement.querySelector('.training-status');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toContain('is now the default Endurance book');
  });
});

describe('BookDetail reset progress', () => {
  let component: BookDetail;
  let fixture: ComponentFixture<BookDetail>;
  let httpMock: HttpTestingController;
  let toast: ToastService;

  /** Readable book with progress worth resetting (partial read). */
  function readableBook(overrides: Partial<Book> = {}): Book {
    return {
      ...book,
      hasFile: true,
      progressPercent: 42,
      lastLocation: 'epub.cfi',
      lastReadAt: '2026-08-10T08:00:00+02:00',
      ...overrides,
    };
  }

  async function setup(initial: Book = readableBook()) {
    fixture = TestBed.createComponent(BookDetail);
    component = fixture.componentInstance;
    await fixture.whenStable();
    fixture.detectChanges();

    httpMock.expectOne('/api/books/b1').flush(initial);
    httpMock.expectOne('/api/books/b1/notes').flush([]);
    httpMock.expectOne('/api/collections').flush([]);
    httpMock.match('/api/concepts').forEach((request) => request.flush([]));
    httpMock.expectOne('/api/reading/dashboard').flush(envelope(dashboard([])));
    httpMock.expectOne('/api/reading/sessions').flush(envelope([]));
    fixture.detectChanges();
  }

  function resetButton(): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector('.reset-progress-btn');
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BookDetail],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: book.id })) },
        },
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    toast = TestBed.inject(ToastService);
  });

  afterEach(() => {
    httpMock.match('/api/concepts').forEach((request) => request.flush([]));
    httpMock.verify();
  });

  it('is hidden for an untouched book, even when it has a file', async () => {
    await setup(readableBook({ progressPercent: 0, lastLocation: null, lastReadAt: null, finishedAt: null }));
    expect(resetButton()).toBeNull();
  });

  it('is hidden for a book without a file even when progress exists', async () => {
    await setup({ ...book, hasFile: false, progressPercent: 42, lastLocation: 'epub.cfi' });
    expect(resetButton()).toBeNull();
  });

  it('is visible for a partially read book', async () => {
    await setup(readableBook());
    const button = resetButton();
    expect(button).toBeTruthy();
    expect(button!.textContent).toContain('Reset progress');
  });

  it('is visible for a finished book', async () => {
    await setup(
      readableBook({
        progressPercent: 100,
        finishedAt: '2026-08-10T08:00:00+02:00',
      })
    );
    expect(resetButton()).toBeTruthy();
  });

  it('is visible when only a saved location or recency exists', async () => {
    await setup(readableBook({ progressPercent: 0, lastLocation: 'epub.cfi', lastReadAt: null }));
    expect(resetButton()).toBeTruthy();

    await setup(readableBook({ progressPercent: 0, lastLocation: null, lastReadAt: '2026-08-10T08:00:00+02:00' }));
    expect(resetButton()).toBeTruthy();
  });

  it('does nothing when the confirmation is cancelled', async () => {
    await setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    resetButton()!.click();
    fixture.detectChanges();

    expect(confirmSpy).toHaveBeenCalledWith(
      'Reset reading progress? The next time you open this book, it will start from the beginning.'
    );
    expect(httpMock.match((req) => req.method === 'POST' && req.url === '/api/books/b1/progress/reset').length).toBe(0);
    expect(component.store.book()?.progressPercent).toBe(42);
  });

  it('confirms, then calls exactly one reset endpoint and refetches the book on success', async () => {
    await setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    resetButton()!.click();
    fixture.detectChanges();

    const posts = httpMock.match((req) => req.method === 'POST' && req.url === '/api/books/b1/progress/reset');
    expect(posts.length).toBe(1);
    expect(posts[0].request.body).toBeNull();

    posts[0].flush({ updated: true });
    const refetch = httpMock.expectOne('/api/books/b1');
    expect(refetch.request.method).toBe('GET');
    refetch.flush(
      readableBook({ progressPercent: 0, lastLocation: null, lastReadAt: null, finishedAt: null })
    );
    fixture.detectChanges();

    expect(component.store.book()?.progressPercent).toBe(0);
    expect(component.store.book()?.lastLocation).toBeNull();
    expect(resetButton()).toBeNull();
    expect(toast.toasts().some((t) => t.message === 'Reading progress reset' && t.type === 'success')).toBe(true);
  });

  it('disables the button while the reset is pending and never submits twice', async () => {
    await setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    resetButton()!.click();
    fixture.detectChanges();
    expect(resetButton()!.disabled).toBe(true);
    expect(resetButton()!.textContent).toContain('Resetting');

    // A second click on the disabled button must not fire another request.
    resetButton()!.click();
    fixture.detectChanges();

    const posts = httpMock.match((req) => req.method === 'POST' && req.url === '/api/books/b1/progress/reset');
    // Exactly one reset submission despite the duplicate click.
    expect(posts.length).toBe(1);
    posts[0].flush({ updated: true });
    httpMock.expectOne('/api/books/b1').flush(readableBook({ progressPercent: 0, lastLocation: null, lastReadAt: null, finishedAt: null }));
    fixture.detectChanges();
    expect(resetButton()).toBeNull();
  });

  it('preserves the displayed state and shows an error toast on failure', async () => {
    await setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    resetButton()!.click();
    fixture.detectChanges();

    httpMock
      .expectOne((req) => req.method === 'POST' && req.url === '/api/books/b1/progress/reset')
      .flush({ data: { code: 'book_not_found' } }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(httpMock.match((req) => req.method === 'GET' && req.url === '/api/books/b1').length).toBe(0);
    expect(component.store.book()?.progressPercent).toBe(42);
    expect(resetButton()).toBeTruthy();
    expect(toast.toasts().some((t) => t.message === 'Failed to reset progress' && t.type === 'error')).toBe(true);
  });
});
