import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Component, forwardRef, input, output } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { ReaderShell } from './reader-shell.component';
import { AudioReader } from './audio-reader/audio-reader.component';
import { PdfReader } from './pdf-reader/pdf-reader.component';
import { EpubReader } from './epub-reader/epub-reader.component';
import { ConceptInputComponent } from '../ui/concept-input.component/concept-input.component';
import { NoteCardComponent } from '../ui/note-card.component/note-card.component';
import { BooksService } from '../core/services/books.service';
import { NotesService } from '../core/services/notes.service';
import { ConceptsService } from '../core/services/concepts.service';
import { ConceptAutocompleteService } from '../ui/concept-autocomplete-panel/concept-autocomplete.service';
import { ThemeService, THEME_STORAGE_KEY, READER_THEME_STORAGE_KEY } from '../core/services/theme.service';
import { Book } from '../core/dtos/book.dtos';

// The AudioReader is kept real so this spec guards the reader page's total
// GET /api/books/{id} count; Howl is mocked to avoid real media loading.
vi.mock('howler', () => ({
  // Regular function (not an arrow) so `new Howl(...)` works.
  Howl: vi.fn(function () {
    return {
      unload: vi.fn(),
      seek: vi.fn(() => 0),
      playing: vi.fn(() => false),
      duration: vi.fn(() => 0),
      play: vi.fn(),
      pause: vi.fn(),
      rate: vi.fn(),
    };
  }),
}));

// Stand-ins for the other reader children (epub.js / pdf.js are heavy and
// irrelevant to the audiobook single-fetch regression). They declare the exact
// inputs/outputs the shell template binds, so template compilation is real.
@Component({ selector: 'app-pdf-reader', standalone: true, template: '' })
class PdfReaderStub {
  bookId = input.required<string>();
  theme = input<string | null>(null);
  initialLocation = input<string | null>(null);
  sidebarVisible = input(false);
  highlightMode = input(false);
  sidebarVisibleChange = output<boolean>();
  noteCreated = output<void>();
  selectionCaptured = output<unknown>();
  commitFailed = output<unknown>();
}

@Component({ selector: 'app-epub-reader', standalone: true, template: '' })
class EpubReaderStub {
  bookId = input.required<string>();
  theme = input<string | null>(null);
  highlightMode = input(false);
  noteCreated = output<void>();
  selectionCaptured = output<unknown>();
  commitFailed = output<unknown>();
}

// The shell binds [(ngModel)] to app-concept-input; the stub must be a
// ControlValueAccessor so the ngModel directive resolves.
@Component({
  selector: 'app-concept-input',
  standalone: true,
  template: '',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ConceptInputStub),
      multi: true,
    },
  ],
})
class ConceptInputStub implements ControlValueAccessor {
  placeholder = input('');
  rows = input(1);
  submitTrigger = output<void>();
  writeValue(): void {}
  registerOnChange(): void {}
  registerOnTouched(): void {}
}

@Component({ selector: 'app-note-card', standalone: true, template: '' })
class NoteCardStub {
  note = input<unknown>(null);
  conceptMap = input<unknown>(null);
  showNavigation = input(false);
  update = output<unknown>();
  delete = output<unknown>();
  cardClick = output<unknown>();
}

const audiobook = {
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
  lastLocation: '3721.5',
  progressPercent: 10,
  lastReadAt: null,
  rating: 0,
  isFavorite: false,
  personalReview: null,
  finishedAt: null,
  chapters: [{ title: 'Book One', startTime: 0 }],
} as Book;

const booksGetSpy = vi.fn();

// jsdom does not implement matchMedia; the shell registers a change listener.
function mockMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// Builds a fresh TestBed module with the heavy reader children stubbed out.
// Called per-test so localStorage can be primed (theme hydration) BEFORE the
// component (and its root-provided ThemeService) is constructed.
async function configureReaderShell(): Promise<ComponentFixture<ReaderShell>> {
  TestBed.overrideComponent(ReaderShell, {
    remove: {
      imports: [PdfReader, EpubReader, ConceptInputComponent, NoteCardComponent],
    },
    add: { imports: [PdfReaderStub, EpubReaderStub, ConceptInputStub, NoteCardStub] },
  });

  await TestBed.configureTestingModule({
    imports: [ReaderShell],
    providers: [
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap({ id: 'book-1' }) } },
      },
      {
        provide: BooksService,
        useValue: { get: booksGetSpy, updateProgress: vi.fn(() => of(null)) },
      },
      {
        provide: NotesService,
        useValue: {
          list: vi.fn(() => of([])),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        },
      },
      { provide: ConceptsService, useValue: { list: vi.fn(() => of([])) } },
      { provide: ConceptAutocompleteService, useValue: { setConcepts: vi.fn() } },
    ],
  }).compileComponents();

  return TestBed.createComponent(ReaderShell);
}

describe('ReaderShell audiobook load (issue #7)', () => {
  let fixture: ComponentFixture<ReaderShell>;

  beforeEach(async () => {
    booksGetSpy.mockReset();
    booksGetSpy.mockReturnValue(of(audiobook));

    // Deterministic theme state for every test (ThemeService hydrates from
    // localStorage on construction).
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');

    mockMatchMedia();

    fixture = await configureReaderShell();
  });

  function render() {
    fixture.detectChanges();
    fixture.detectChanges();
  }

  it('fetches the audiobook exactly once on the reader page (no duplicate GET from the audio reader)', () => {
    render();

    expect(booksGetSpy).toHaveBeenCalledTimes(1);
    expect(booksGetSpy).toHaveBeenCalledWith('book-1');
  });

  it('passes the loaded book into the audio reader as an input', () => {
    render();

    const audioReaderEl = fixture.debugElement.query(By.directive(AudioReader));
    expect(audioReaderEl).not.toBeNull();
    expect(audioReaderEl.componentInstance.bookId()).toBe('book-1');
    expect(audioReaderEl.componentInstance.book()).toBe(audiobook);
  });
});

describe('ReaderShell reader-local theme (no global spill)', () => {
  let fixture: ComponentFixture<ReaderShell>;

  beforeEach(() => {
    booksGetSpy.mockReset();
    booksGetSpy.mockReturnValue(of(audiobook));

    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');

    mockMatchMedia();
  });

  function render() {
    fixture.detectChanges();
    fixture.detectChanges();
  }

  function toggleButtons() {
    return fixture.debugElement.queryAll(By.css('.theme-toggle-btn'));
  }

  function readerLayout() {
    return fixture.debugElement.query(By.css('.reader-layout'));
  }

  it('renders the theme toggle with the current theme and switches it on click', async () => {
    fixture = await configureReaderShell();
    render();

    const toggle = fixture.debugElement.query(By.css('.theme-toggle'));
    expect(toggle).not.toBeNull();

    const buttons = toggleButtons();
    expect(buttons.length).toBe(3);
    // Light is the default and starts active.
    expect(buttons[0].classes['active']).toBe(true);
    expect(buttons[1].classes['active']).toBeUndefined();
    expect(buttons[2].classes['active']).toBeUndefined();

    buttons[2].nativeElement.click(); // sepia
    fixture.detectChanges();

    // The reader-local theme changed and persisted...
    expect(fixture.componentInstance.readerTheme()).toBe('sepia');
    expect(localStorage.getItem(READER_THEME_STORAGE_KEY)).toBe('sepia');
    expect(buttons[2].classes['active']).toBe(true);
    expect(buttons[0].classes['active']).toBeUndefined();
    // ...and the GLOBAL theme was never touched: no 'nostos.theme' write and
    // no documentElement attribute change.
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('initializes from the global theme when no reader theme is stored, then stays independent', async () => {
    // Global theme is dark (as if set app-wide via Settings). Priming the
    // stored global key BEFORE the fixture is created makes the root
    // ThemeService hydrate 'dark' when the shell first injects it — the same
    // boot path a real user hits.
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    fixture = await configureReaderShell();
    render();

    // The reader was seeded from the global theme...
    expect(fixture.componentInstance.readerTheme()).toBe('dark');
    // ...and the scoped host attribute mirrors the READER theme.
    expect(readerLayout().nativeElement.getAttribute('data-theme')).toBe('dark');
    // The global theme is applied app-wide (by ThemeService hydration), not
    // by the reader.
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    // Toggling inside the reader must NOT change the global theme.
    toggleButtons()[0].nativeElement.click(); // light
    fixture.detectChanges();

    expect(fixture.componentInstance.readerTheme()).toBe('light');
    expect(localStorage.getItem(READER_THEME_STORAGE_KEY)).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(readerLayout().nativeElement.getAttribute('data-theme')).toBe('light');
  });

  it('restores a persisted reader theme independently of the global theme', async () => {
    localStorage.setItem(READER_THEME_STORAGE_KEY, 'sepia');
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    // The fixture is created AFTER storage is primed, so the shell hydrates
    // its reader-local theme from 'nostos.readerTheme' on construction.
    fixture = await configureReaderShell();
    render();

    expect(fixture.componentInstance.readerTheme()).toBe('sepia');
    expect(readerLayout().nativeElement.getAttribute('data-theme')).toBe('sepia');
    // The global theme stays dark and untouched by the reader.
    expect(TestBed.inject(ThemeService).theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    const buttons = toggleButtons();
    expect(buttons[2].classes['active']).toBe(true);
    expect(buttons[0].classes['active']).toBeUndefined();
  });

  it('passes the reader theme into the epub reader as an input', async () => {
    const epubBook = { ...audiobook, id: 'book-epub', fileName: 'iliad.epub' } as Book;
    booksGetSpy.mockReturnValue(of(epubBook));

    fixture = await configureReaderShell();
    render();

    const epubEl = fixture.debugElement.query(By.directive(EpubReaderStub));
    expect(epubEl).not.toBeNull();
    expect(epubEl.componentInstance.theme()).toBe('light');

    // Toggling the reader theme flows into the epub reader input.
    toggleButtons()[1].nativeElement.click(); // dark
    fixture.detectChanges();

    expect(epubEl.componentInstance.theme()).toBe('dark');
    expect(fixture.componentInstance.readerTheme()).toBe('dark');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
