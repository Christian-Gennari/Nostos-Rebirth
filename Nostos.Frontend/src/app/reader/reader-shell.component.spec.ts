import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Component, forwardRef, input, output, signal } from '@angular/core';
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
  // The shell passes the loaded Book down so the reader can restore the saved
  // position without a second GET (issue #225 §1.2).
  book = input<unknown>(null);
  highlightMode = input(false);
  noteCreated = output<void>();
  selectionCaptured = output<unknown>();
  commitFailed = output<unknown>();
  // Typography surface the shell panel binds (mirrors EpubReader).
  typography = signal({ fontFamily: 'default', lineHeight: 1.6, margin: 'normal' });
  fontOptions = [
    { value: 'default', label: 'Publisher' },
    { value: 'serif', label: 'Serif' },
  ];
  lineOptions = [1.4, 1.6];
  marginOptions = [{ value: 'normal', label: 'Normal' }];
  // Text size: the toolbar's two steps moved into the Aa panel, so the shell now
  // binds the reader's size signal and zoom methods directly.
  fontSizePercent = signal(100);
  zoomIn = vi.fn();
  zoomOut = vi.fn();
  setTypography = vi.fn();
  resetTypography = vi.fn();
  next = vi.fn();
  previous = vi.fn();
  // IReader surface the shell reads once the reader is active.
  toc = signal<unknown[]>([]);
  progress = signal({ label: '', percentage: 0 });
  currentLocationTarget = signal<unknown>(null);
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
  collectionIds: [],
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
// Called per-test so each spec starts from a clean state.
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

    // Deterministic boot state for every test.
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

describe('ReaderShell toolbar contract (theme system removed)', () => {
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

  it('renders no theme toggle and no data-theme binding anywhere in the shell', async () => {
    fixture = await configureReaderShell();
    render();

    expect(fixture.debugElement.query(By.css('.theme-toggle'))).toBeNull();
    expect(fixture.debugElement.query(By.css('.theme-toggle-btn'))).toBeNull();
    const layout = fixture.debugElement.query(By.css('.reader-layout'));
    expect(layout.nativeElement.hasAttribute('data-theme')).toBe(false);
  });

  it('splits the chrome: configuration in the header, page turns in the pager', async () => {
    // Non-audio book. Every control that CONFIGURES the reader belongs to the
    // surface header now; the bottom bar is the pager and nothing else.
    const epubBook = { ...audiobook, id: 'book-epub', fileName: 'iliad.epub' } as Book;
    booksGetSpy.mockReturnValue(of(epubBook));

    fixture = await configureReaderShell();
    render();

    const titlesOf = (selector: string) =>
      fixture.debugElement
        .queryAll(By.css(selector))
        .map((b) => b.nativeElement.getAttribute('title'))
        .filter((t): t is string => !!t);

    const header = titlesOf('.reader-header .icon-btn');
    expect(header.filter((t) => t === 'Table of Contents')).toHaveLength(1);
    expect(header.filter((t) => t === 'Notes & Highlights')).toHaveLength(1);
    expect(header.filter((t) => t === 'Highlight mode')).toHaveLength(1);
    expect(header.filter((t) => t === 'Typography')).toHaveLength(1);
    // Back lives with the title it returns to, not with the page keys.
    expect(header.filter((t) => t === 'Back to Library')).toHaveLength(1);
    // And nothing about turning pages is up here.
    expect(header.filter((t) => t === 'Previous' || t === 'Next')).toHaveLength(0);

    const pager = titlesOf('.reader-toolbar .icon-btn');
    expect(pager.filter((t) => t === 'Previous')).toHaveLength(1);
    expect(pager.filter((t) => t === 'Next')).toHaveLength(1);
    expect(pager.filter((t) => t === 'Highlight mode' || t === 'Typography')).toHaveLength(0);

    // The progress cluster sits between prev and next in the center group.
    const center = fixture.debugElement.query(By.css('.toolbar-center'));
    expect(center).not.toBeNull();
    expect(center.query(By.css('.progress-display'))).not.toBeNull();
  });

  it('has no overflow menu left to reach the desktop-only controls', async () => {
    // The mobile "More" menu existed only because ten controls could not share
    // one 44px row. The header holds them, so the menu and its CSS hook are gone
    // — this test is what stops them creeping back in.
    const epubBook = { ...audiobook, id: 'book-epub', fileName: 'iliad.epub' } as Book;
    booksGetSpy.mockReturnValue(of(epubBook));

    fixture = await configureReaderShell();
    render();

    expect(fixture.debugElement.queryAll(By.css('.overflow-toggle'))).toHaveLength(0);
    expect(fixture.debugElement.queryAll(By.css('.overflow-menu'))).toHaveLength(0);
    expect(fixture.nativeElement.querySelector('.reader-back')).not.toBeNull();
  });

  /**
   * `.desktop-only` is a CSS HOOK, not decoration: it is hidden at mobile widths.
   * The buttons were migrated to `appIconButton`, which adds its own
   * `icon-btn--<rung>` class to the host, so a mistake here would silently change
   * the responsive behaviour — the kind of thing a desktop-only screenshot cannot
   * see. A bare `desktop-only` ATTRIBUTE instead of `class="desktop-only"` is
   * exactly the bug this guards: it is valid HTML, compiles, and matches nothing.
   */
  it('keeps the CSS hook classes on the migrated controls', async () => {
    // A PDF book, the one format that still carries the render-scale pair: an
    // EPUB's text size lives in the Aa panel instead.
    const pdfBook = { ...audiobook, id: 'book-pdf', fileName: 'being-and-time.pdf' } as Book;
    booksGetSpy.mockReturnValue(of(pdfBook));

    fixture = await configureReaderShell();
    render();

    const desktopOnly = fixture.debugElement.queryAll(By.css('button.desktop-only'));
    expect(desktopOnly.length).toBe(2); // zoom out + zoom in

    const controls = fixture.debugElement.queryAll(
      By.css('.reader-header button.icon-btn, .reader-toolbar button.icon-btn')
    );
    expect(controls.length).toBeGreaterThan(0);
    for (const b of controls) {
      const el = b.nativeElement as HTMLButtonElement;
      expect(el.tagName).toBe('BUTTON');
      expect(el.classList.contains('icon-btn')).toBe(true);
    }
  });
});

describe('ReaderShell note delete (no window.confirm)', () => {
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

  it('opens ConfirmModal and only deletes on confirm', async () => {
    fixture = await configureReaderShell();
    render();

    const notes = TestBed.inject(NotesService) as unknown as { delete: ReturnType<typeof vi.fn> };
    notes.delete.mockReset();
    notes.delete.mockReturnValue(of(undefined));

    const component = fixture.componentInstance;
    component.onDeleteNote('n1');
    expect(component.pendingNoteDelete()).toBe('n1');
    expect(notes.delete).not.toHaveBeenCalled();

    render();
    expect(fixture.nativeElement.querySelector('.confirm-modal-card')).toBeTruthy();

    component.confirmNoteDelete();
    expect(notes.delete).toHaveBeenCalledWith('n1');
    expect(component.pendingNoteDelete()).toBeNull();
  });

  it('cancelling performs nothing', async () => {
    fixture = await configureReaderShell();
    render();

    const notes = TestBed.inject(NotesService) as unknown as { delete: ReturnType<typeof vi.fn> };
    notes.delete.mockReset();
    notes.delete.mockReturnValue(of(undefined));

    const component = fixture.componentInstance;
    component.onDeleteNote('n1');
    component.cancelNoteDelete();
    expect(component.pendingNoteDelete()).toBeNull();
    expect(notes.delete).not.toHaveBeenCalled();
  });
});

describe('ReaderShell typography panel (EPUB)', () => {
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

  it('offers the Aa toggle for epubs and opens the panel', async () => {
    const epubBook = { ...audiobook, id: 'book-epub', fileName: 'iliad.epub' } as Book;
    booksGetSpy.mockReturnValue(of(epubBook));

    fixture = await configureReaderShell();
    render();

    const toggle = fixture.nativeElement.querySelector('[data-testid="typo-toggle"]');
    expect(toggle).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="typo-panel"]')).toBeNull();

    toggle.click();
    render();
    expect(fixture.nativeElement.querySelector('[data-testid="typo-panel"]')).toBeTruthy();
  });

  it('shows no Aa toggle for audiobooks', async () => {
    fixture = await configureReaderShell();
    render();

    expect(fixture.nativeElement.querySelector('[data-testid="typo-toggle"]')).toBeNull();
  });

  it('forwards a typeface choice to the epub reader', async () => {
    const epubBook = { ...audiobook, id: 'book-epub', fileName: 'iliad.epub' } as Book;
    booksGetSpy.mockReturnValue(of(epubBook));

    fixture = await configureReaderShell();
    render();

    fixture.componentInstance.toggleTypo();
    render();

    const serif = Array.from(
      fixture.nativeElement.querySelectorAll(
        '[data-testid="typo-panel"] .typo-opt',
      ) as NodeListOf<HTMLButtonElement>,
    ).find((el) => el.textContent?.trim() === 'Serif');
    expect(serif).toBeTruthy();
    serif!.click();

    const stub = fixture.debugElement.query(By.directive(EpubReaderStub));
    expect(stub.componentInstance.setTypography).toHaveBeenCalledWith({ fontFamily: 'serif' });
  });

  /**
   * Issue #225 §1.5. The shell owns the document-level half of the binding; the
   * EPUB reader owns the half inside the book's iframe.
   */
  it('turns pages from the keyboard, ignoring chords and text fields', async () => {
    const epubBook = { ...audiobook, id: 'book-epub', fileName: 'iliad.epub' } as Book;
    booksGetSpy.mockReturnValue(of(epubBook));

    fixture = await configureReaderShell();
    render();
    // The shell unlocks the reader after a short settle, so activeReader() is
    // only non-null once that has run.
    await new Promise((resolve) => setTimeout(resolve, 120));
    render();

    const stub = fixture.debugElement.query(By.directive(EpubReaderStub))
      .componentInstance as EpubReaderStub;

    const press = (key: string, init: KeyboardEventInit = {}) =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
      );

    press('ArrowRight');
    press(' ');
    expect(stub.next).toHaveBeenCalledTimes(2);

    press('ArrowLeft');
    press('PageUp');
    expect(stub.previous).toHaveBeenCalledTimes(2);

    // A chord belongs to the browser, and a text field keeps its own keys.
    press('ArrowRight', { ctrlKey: true });
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(stub.next).toHaveBeenCalledTimes(2);
    textarea.remove();
  });
});
