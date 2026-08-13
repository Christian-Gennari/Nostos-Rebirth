import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { AudioReader, parseTimeString } from './audio-reader.component';
import { BooksService } from '../../core/services/books.service';
import { Book } from '../../core/dtos/book.dtos';

// Mock Howl so specs can drive the Howl lifecycle (onload / onloaderror)
// without real media loading.
const howlerState = vi.hoisted(() => ({ instances: [] as any[] }));

vi.mock('howler', () => ({
  // Regular function (not an arrow) so `new Howl(...)` works.
  Howl: vi.fn(function (config: any) {
    const instance = {
      config,
      unload: vi.fn(),
      duration: vi.fn(() => 7200),
      seek: vi.fn(() => 0),
      playing: vi.fn(() => false),
      play: vi.fn(),
      pause: vi.fn(),
      rate: vi.fn(),
    };
    howlerState.instances.push(instance);
    return instance;
  }),
}));

describe('parseTimeString (issue #6)', () => {
  it('parses M:SS', () => {
    expect(parseTimeString('1:30')).toBe(90);
    expect(parseTimeString('0:00')).toBe(0);
    expect(parseTimeString('0:05')).toBe(5);
    expect(parseTimeString('12:34')).toBe(754);
  });

  it('parses H:MM:SS', () => {
    expect(parseTimeString('1:05:20')).toBe(3920);
    expect(parseTimeString('0:00:00')).toBe(0);
    expect(parseTimeString('0:01:00')).toBe(60);
  });

  it('accepts single-digit segments', () => {
    expect(parseTimeString('5:3')).toBe(303);
    expect(parseTimeString('1:2:3')).toBe(3723);
  });

  it('trims surrounding whitespace', () => {
    expect(parseTimeString('  1:30  ')).toBe(90);
  });

  it('returns null for empty / whitespace input', () => {
    expect(parseTimeString('')).toBeNull();
    expect(parseTimeString('   ')).toBeNull();
  });

  it('returns null for non-numeric or partial input', () => {
    expect(parseTimeString('abc')).toBeNull();
    expect(parseTimeString('1:')).toBeNull();
    expect(parseTimeString(':30')).toBeNull();
    expect(parseTimeString('1:30:00:00')).toBeNull();
    expect(parseTimeString('1:2:3:4')).toBeNull();
  });

  it('returns null for negative input', () => {
    expect(parseTimeString('-1:00')).toBeNull();
  });

  it('returns null for null / undefined input', () => {
    expect(parseTimeString(null as unknown as string)).toBeNull();
    expect(parseTimeString(undefined as unknown as string)).toBeNull();
  });

  it('returns permissive totals (caller clamps to duration)', () => {
    // Plan: 99:99 -> 6039s, then clamp to duration(). Parser does not reject.
    expect(parseTimeString('99:99')).toBe(6039);
    expect(parseTimeString('1:60')).toBe(120);
    expect(parseTimeString('1:00:99')).toBe(3699);
    expect(parseTimeString('1:99:00')).toBe(9540);
  });

  it('handles large hour values without overflow (caller clamps to duration)', () => {
    expect(parseTimeString('99:00:00')).toBe(356400);
  });
});

describe('AudioReader jump-to-timestamp (issue #6)', () => {
  let fixture: ComponentFixture<AudioReader>;
  let component: AudioReader;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AudioReader],
    }).compileComponents();

    fixture = TestBed.createComponent(AudioReader);
    component = fixture.componentInstance;
    // bookId is a required input; provide a placeholder so the constructor effect
    // does not throw before our individual tests can set up state.
    fixture.componentRef.setInput('bookId', 'test-book-id');
  });

  it('does not enter edit mode when duration is zero', () => {
    expect(component.duration()).toBe(0);
    component.startEditingTime();
    expect(component.isEditingTime()).toBe(false);
  });

  it('cancels cleanly without seeking', () => {
    component.duration.set(600);
    component.startEditingTime();
    expect(component.isEditingTime()).toBe(true);
    component.cancelTimeEdit();
    expect(component.isEditingTime()).toBe(false);
  });

  it('is idempotent on commit when not editing (no double-blur seek)', () => {
    component.duration.set(600);
    expect(component.isEditingTime()).toBe(false);
    component.commitTimeEdit('5:00');
    // isEditingTime was never set true; commit must be a no-op.
    expect(component.isEditingTime()).toBe(false);
  });

  it('cancels silently on malformed input and exits edit mode', () => {
    component.duration.set(600);
    component.startEditingTime();
    component.commitTimeEdit('not-a-time');
    expect(component.isEditingTime()).toBe(false);
  });

  it('clamps a value greater than duration via commitTimeEdit (no direct seek past end)', () => {
    component.duration.set(600);
    // Spy on goToTime so we can assert that commitTimeEdit invoked it with the
    // clamped value, not the raw 99:99 (=6039s) value.
    const seen: number[] = [];
    const original = (component as unknown as { goToTime: (n: number) => void }).goToTime;
    (component as unknown as { goToTime: (n: number) => void }).goToTime = (n: number) => {
      seen.push(n);
    };
    try {
      component.startEditingTime();
      component.commitTimeEdit('99:99');
    } finally {
      (component as unknown as { goToTime: (n: number) => void }).goToTime = original;
    }
    expect(seen).toEqual([600]);
    expect(component.isEditingTime()).toBe(false);
  });
});

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'book-1',
    title: 'The Iliad',
    subtitle: null,
    author: 'Homer',
    editor: null,
    translator: null,
    narrator: null,
    description: null,
    type: 'audiobook',
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
    createdAt: '2026-01-01T00:00:00Z',
    hasFile: true,
    fileName: 'iliad.m4b',
    coverUrl: null,
    collectionId: null,
    lastLocation: null,
    progressPercent: 0,
    lastReadAt: null,
    rating: 0,
    isFavorite: false,
    personalReview: null,
    finishedAt: null,
    ...overrides,
  } as Book;
}

describe('AudioReader single-fetch + restore + loading state (issue #7)', () => {
  let fixture: ComponentFixture<AudioReader>;
  let component: AudioReader;
  const booksServiceMock = {
    get: vi.fn(),
    updateProgress: vi.fn(() => of(null)),
  };

  beforeEach(async () => {
    howlerState.instances.length = 0;
    booksServiceMock.get.mockReset();
    booksServiceMock.updateProgress.mockReset();

    await TestBed.configureTestingModule({
      imports: [AudioReader],
      providers: [{ provide: BooksService, useValue: booksServiceMock }],
    }).compileComponents();

    fixture = TestBed.createComponent(AudioReader);
    component = fixture.componentInstance;
  });

  function render(book: Book) {
    fixture.componentRef.setInput('bookId', book.id);
    fixture.componentRef.setInput('book', book);
    fixture.detectChanges();
  }

  function captureGoToTime(): { seen: number[]; restore: () => void } {
    const seen: number[] = [];
    const original = (component as unknown as { goToTime: (n: number) => void }).goToTime;
    (component as unknown as { goToTime: (n: number) => void }).goToTime = (n: number) => {
      seen.push(n);
    };
    return { seen, restore: () => ((component as unknown as { goToTime: (n: number) => void }).goToTime = original) };
  }

  it('restores playback from the passed-in lastLocation without a second book fetch', () => {
    render(makeBook({ lastLocation: '3721.5' }));

    const { seen, restore } = captureGoToTime();
    try {
      component.restoreProgress();
    } finally {
      restore();
    }

    expect(seen).toEqual([3721.5]);
    expect(booksServiceMock.get).not.toHaveBeenCalled();
  });

  it('does not seek when lastLocation is missing', () => {
    render(makeBook({ lastLocation: null }));

    const { seen, restore } = captureGoToTime();
    try {
      component.restoreProgress();
    } finally {
      restore();
    }

    expect(seen).toEqual([]);
    expect(booksServiceMock.get).not.toHaveBeenCalled();
  });

  it('does not seek when lastLocation is not a valid timestamp', () => {
    render(makeBook({ lastLocation: 'not-a-timestamp' }));

    const { seen, restore } = captureGoToTime();
    try {
      component.restoreProgress();
    } finally {
      restore();
    }

    expect(seen).toEqual([]);
    expect(booksServiceMock.get).not.toHaveBeenCalled();
  });

  it('builds the table of contents from the passed-in book chapters without a fetch', () => {
    render(
      makeBook({
        chapters: [
          { title: 'Book One', startTime: 0 },
          { title: 'Book Two', startTime: 3661 },
        ],
      }),
    );

    expect(component.toc()).toEqual([
      { label: 'Book One', target: 0, children: [] },
      { label: 'Book Two', target: 3661, children: [] },
    ]);
    expect(booksServiceMock.get).not.toHaveBeenCalled();
  });

  it('shows the loading state while Howl initializes and clears it on load', () => {
    render(makeBook());

    const howl = howlerState.instances[0];
    expect(howl).toBeDefined();
    expect(component.loading()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Loading audio');

    howl.config.onload();
    fixture.detectChanges();

    expect(component.loading()).toBe(false);
    expect(component.duration()).toBe(7200);
    expect(fixture.nativeElement.textContent).not.toContain('Loading audio');
  });

  it('clears the loading state and surfaces an error on load failure', () => {
    render(makeBook());

    const howl = howlerState.instances[0];
    expect(howl).toBeDefined();
    expect(component.loading()).toBe(true);

    howl.config.onloaderror();
    fixture.detectChanges();

    expect(component.loading()).toBe(false);
    expect(component.loadError()).toBe('Unable to load audio.');
    expect(fixture.nativeElement.textContent).toContain('Unable to load audio');
  });
});

describe('AudioReader sleep timer (issue #47)', () => {
  let fixture: ComponentFixture<AudioReader>;
  let component: AudioReader;
  const booksServiceMock = {
    get: vi.fn(),
    updateProgress: vi.fn(() => of(null)),
  };

  beforeEach(async () => {
    howlerState.instances.length = 0;
    booksServiceMock.get.mockReset();
    booksServiceMock.updateProgress.mockReset();

    await TestBed.configureTestingModule({
      imports: [AudioReader],
      providers: [{ provide: BooksService, useValue: booksServiceMock }],
    }).compileComponents();

    fixture = TestBed.createComponent(AudioReader);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('bookId', 'test-book-id');
    fixture.detectChanges();

    // Scope fake timers to this suite only (the other suites use real timers).
    // Fake just the timers the sleep timer uses; leave queueMicrotask real so
    // Angular's signal/effect machinery keeps flushing normally.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('arms a preset: sets the timer state and shows the remaining time', () => {
    expect(howlerState.instances[0]).toBeDefined();

    component.selectSleepTimer(30);

    expect(component.sleepTimerMinutes()).toBe(30);
    expect(component.sleepRemainingSeconds()).toBe(1800);

    fixture.detectChanges();
    const label = fixture.nativeElement.querySelector('[data-testid="sleep-timer-label"]');
    expect(label.textContent).toContain('30:00');

    // The countdown ticks down once per second.
    vi.advanceTimersByTime(60_000);
    expect(component.sleepRemainingSeconds()).toBe(1740);

    fixture.detectChanges();
    expect(label.textContent).toContain('29:00');
  });

  it('pauses playback and clears the armed state when the timer expires', () => {
    const howl = howlerState.instances[0];
    expect(howl).toBeDefined();

    component.selectSleepTimer(15);
    vi.advanceTimersByTime(15 * 60 * 1000);

    expect(howl.pause).toHaveBeenCalled();
    expect(component.sleepTimerMinutes()).toBeNull();
    expect(component.sleepDeadline()).toBeNull();
    expect(component.sleepRemainingSeconds()).toBe(0);
    expect(component.sleepStatusMessage()).toBe('Sleep timer finished. Playback paused.');

    fixture.detectChanges();
    const status = fixture.nativeElement.querySelector('[data-testid="sleep-status-message"]');
    expect(status).not.toBeNull();
    expect(status.textContent).toContain('Sleep timer finished');
  });

  it('resets the countdown when the preset is changed while armed', () => {
    component.selectSleepTimer(45);
    expect(component.sleepRemainingSeconds()).toBe(2700);

    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(component.sleepRemainingSeconds()).toBe(2100);

    component.selectSleepTimer(15);
    expect(component.sleepTimerMinutes()).toBe(15);
    expect(component.sleepRemainingSeconds()).toBe(900);

    // The countdown restarted from the new preset, not the old deadline.
    vi.advanceTimersByTime(60_000);
    expect(component.sleepRemainingSeconds()).toBe(840);
  });

  it("disarms immediately when 'Off' is selected", () => {
    const howl = howlerState.instances[0];
    expect(howl).toBeDefined();

    component.selectSleepTimer(30);
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(component.sleepRemainingSeconds()).toBe(1680);

    component.selectSleepTimer(null);

    expect(component.sleepTimerMinutes()).toBeNull();
    expect(component.sleepDeadline()).toBeNull();
    expect(component.sleepRemainingSeconds()).toBe(0);
    // Off just disarms — it must not pause playback.
    expect(howl.pause).not.toHaveBeenCalled();

    // No countdown continues after disarming.
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(component.sleepTimerMinutes()).toBeNull();
    expect(component.sleepRemainingSeconds()).toBe(0);
  });

  it('clears the countdown interval when the component is destroyed (no leaked timers)', () => {
    component.selectSleepTimer(30);
    const intervalId = (component as unknown as { sleepTimerInterval: number | null }).sleepTimerInterval;
    expect(intervalId).not.toBeNull();

    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    fixture.destroy();

    expect(clearSpy).toHaveBeenCalledWith(intervalId);

    // Advancing time after destroy must not throw or resurrect any tick.
    expect(() => vi.advanceTimersByTime(10 * 60 * 1000)).not.toThrow();
  });

  it('keeps counting down wall-clock time while playback is paused (wall-clock decision)', () => {
    const howl = howlerState.instances[0];
    expect(howl).toBeDefined();

    component.selectSleepTimer(30);
    // Simulate the user pausing playback (Howl fires onpause).
    howl.config.onpause();
    expect(component.isPlaying()).toBe(false);

    vi.advanceTimersByTime(5 * 60 * 1000);

    // The countdown kept running despite playback being paused — the timer is
    // a wall-clock sleep timer, not a play-time quota.
    expect(component.sleepTimerMinutes()).toBe(30);
    expect(component.sleepRemainingSeconds()).toBe(1500);
  });

  it('shows a brief status message on expiry and clears it after a few seconds', () => {
    component.selectSleepTimer(15);
    vi.advanceTimersByTime(15 * 60 * 1000);

    expect(component.sleepStatusMessage()).toBe('Sleep timer finished. Playback paused.');

    vi.advanceTimersByTime(5000);
    expect(component.sleepStatusMessage()).toBeNull();
  });

  it('offers the Off/15/30/45/60 presets in the sleep timer menu', () => {
    expect(component.sleepMenuOpen()).toBe(false);

    component.toggleSleepMenu();
    fixture.detectChanges();

    const menu = fixture.nativeElement.querySelector('.sleep-dropdown') as Element | null;
    expect(menu).not.toBeNull();
    const labels = Array.from(menu!.querySelectorAll('.sleep-option')).map((el: Element) =>
      el.textContent?.trim(),
    );
    expect(labels).toEqual(['Off', '15 min', '30 min', '45 min', '60 min']);

    // Re-selecting closes the menu and arms the chosen preset.
    component.selectSleepTimer(45);
    expect(component.sleepMenuOpen()).toBe(false);
    expect(component.sleepTimerMinutes()).toBe(45);
  });
});
