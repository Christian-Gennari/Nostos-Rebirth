import {
  Component,
  input,
  output,
  OnInit,
  OnDestroy,
  signal,
  computed,
  effect,
  inject,
  Injector,
  ElementRef,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import ePub, { Book, Rendition, Contents } from 'epubjs';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, filter } from 'rxjs/operators';

import { EpubAnnotationManager } from './epub-annotation-manager';
import { NotesService } from '../../core/services/notes.service';
import { BooksService } from '../../core/services/books.service';
import { ThemeService, Theme } from '../../core/services/theme.service';
import { Book as BookDto } from '../../core/dtos/book.dtos';
import { IReader, ReaderProgress, TocItem } from '../reader.interface';
import { isTypingTarget, pageActionForKey } from '../reader-keyboard';

/**
 * Rendition theme names. Both Nostos normalizations are registered once per
 * rendition; the selected one always mirrors the app theme (ThemeService),
 * so the page never renders white inside a dark UI or vice versa.
 */
const NOSTOS_LIGHT_THEME = 'nostos-light';
const NOSTOS_DARK_THEME = 'nostos-dark';
/**
 * Color-only rules for the epub.js iframe, mirroring the Nostos light tokens
 * from styles.css (the iframe is a separate document and cannot read the
 * parent's CSS variables). Only foreground, background, links, and selection
 * colors are overridden; book typography, layout, emphasis, and images are
 * left untouched (images are never inverted).
 */
const NOSTOS_LIGHT_RULES: Record<string, Record<string, string>> = {
  html: { background: '#ffffff !important', color: '#1a1a1a !important' },
  body: { background: '#ffffff !important', color: '#1a1a1a !important' },
  // Publisher CSS often sets explicit text colors (e.g. h1 { color: #000 });
  // normalize every element to inherit the theme text color so headings and
  // body text stay readable. `a` comes AFTER `body *` so the link color wins
  // for links (and their descendants).
  'body *': { color: 'inherit !important' },
  a: { color: '#60a5fa !important' },
  '::selection': { background: 'rgba(96, 165, 250, 0.3) !important' },
};

/**
 * Color-only rules for the dark UI, mirroring the `:root[data-theme='dark']`
 * tokens from styles.css (ground #121318, ink #f0f1f4). Same contract as the
 * light rules: colors only, book typography and images untouched.
 */
const NOSTOS_DARK_RULES: Record<string, Record<string, string>> = {
  html: { background: '#121318 !important', color: '#f0f1f4 !important' },
  body: { background: '#121318 !important', color: '#f0f1f4 !important' },
  'body *': { color: 'inherit !important' },
  a: { color: '#8fbfae !important' },
  '::selection': { background: 'rgba(143, 191, 174, 0.35) !important' },
};

/** Reading typefaces offered by the typography panel. */
export type EpubFontFamily = 'default' | 'serif' | 'sans' | 'mono';

export type EpubMargin = 'narrow' | 'normal' | 'wide';

export interface EpubTypography {
  fontFamily: EpubFontFamily;
  lineHeight: number;
  margin: EpubMargin;
}

export const EPUB_FONT_OPTIONS: { value: EpubFontFamily; label: string }[] = [
  { value: 'default', label: 'Publisher' },
  { value: 'serif', label: 'Serif' },
  { value: 'sans', label: 'Sans' },
  { value: 'mono', label: 'Mono' },
];

export const EPUB_LINE_OPTIONS = [1.4, 1.6, 1.8, 2.0];

export const EPUB_MARGIN_OPTIONS: { value: EpubMargin; label: string }[] = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'normal', label: 'Normal' },
  { value: 'wide', label: 'Wide' },
];

export const DEFAULT_TYPOGRAPHY: EpubTypography = {
  fontFamily: 'default',
  lineHeight: 1.6,
  margin: 'normal',
};

const FONT_STACKS: Record<Exclude<EpubFontFamily, 'default'>, string> = {
  serif: 'Newsreader, Georgia, serif',
  sans: '"Hanken Grotesk", system-ui, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, monospace',
};

/**
 * Margin presets, as a percentage of the reader's own width. These are OUTER
 * margins around the epub.js page: `narrow` leaves epub.js's own gutter as the
 * only inset, so it reads as "the book as published".
 *
 * They are applied to our own container rather than to the contents body on
 * purpose. epub.js writes its own inline `padding: 42px !important` on every
 * contents body while it lays a section out; that out-ranks any stylesheet rule
 * and is not ordered against our events, so a body-padding margin was either
 * inert or won only by race. Padding our container and resizing the rendition
 * means epub.js simply paginates into a narrower page — nothing to race.
 */
const MARGIN_INSET_PERCENT: Record<EpubMargin, number> = {
  narrow: 0,
  normal: 4,
  wide: 8,
};

export function marginInsetPercent(margin: EpubMargin): number {
  return MARGIN_INSET_PERCENT[margin];
}

const TYPOGRAPHY_STYLE_ID = 'nostos-typography';

/**
 * Reader-wide typography preference: one key for every EPUB, because the reader
 * should remember the setting rather than the book. Earlier versions wrote
 * `nostos.epub-typography.<bookId>`; `restoreSavedTypography` adopts that value
 * once so an existing choice is not lost.
 */
const TYPOGRAPHY_STORAGE_KEY = 'nostos.epub-typography';

/**
 * The injected typography rules for one contents document. Pure for
 * testability. `default` keeps the publisher's typeface (no font-family
 * override); line height always applies.
 *
 * Margins are deliberately NOT here — see {@link marginInsetPercent}: they are
 * padding on our own viewer, because epub.js's own inline-important body
 * padding cannot be beaten from a stylesheet.
 */
export function typographyCss(t: EpubTypography): string {
  const family =
    t.fontFamily === 'default' ? '' : `font-family:${FONT_STACKS[t.fontFamily]} !important;`;
  return `body{${family}line-height:${t.lineHeight} !important;}`;
}
/**
 * The TOC entry the displayed section belongs to, or null when the TOC cannot
 * place it. Targets are `href#fragment` (EPUB), so only the part before the
 * fragment is compared; depth-first, first match wins.
 */
export function findTocItemForHref(items: TocItem[], href: string | null): TocItem | null {
  if (!href) return null;
  const baseHref = href.split('#')[0];
  for (const item of items) {
    if (item.target.toString().split('#')[0] === baseHref) return item;
    const child = findTocItemForHref(item.children ?? [], href);
    if (child) return child;
  }
  return null;
}

/**
 * Coarse position used until epub.js's locations exist: how far the current
 * spine section is through the spine. It under-reports (a section boundary, not
 * a character offset) and exists so a large book is never left on
 * "Calculating…" with no position at all (issue #225 §1.4).
 */
export function spinePercentFrom(
  spineIndex: number | null | undefined,
  spineLength: number | null | undefined,
): number {
  if (spineIndex == null || spineLength == null || spineLength <= 0) return 0;
  return Math.floor((spineIndex / spineLength) * 100);
}

/**
 * The progress pill's text: a percentage, plus the chapter it belongs to when
 * the TOC can place us. It deliberately carries no time estimate — the previous
 * "3h 43m left" was one 1,000-character location treated as one minute, so it
 * was fiction presented with minute precision (issue #225 §1.3).
 */
export function progressLabel(percent: number, chapter: string | null): string {
  return chapter ? `${percent}% • ${chapter}` : `${percent}%`;
}

@Component({
  selector: 'app-epub-reader',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './epub-reader.component.html',
  styleUrl: './epub-reader.component.css',
})
export class EpubReader implements OnInit, OnDestroy, IReader {
  bookId = input.required<string>();
  /**
   * The Book the shell has already loaded. Passing it down is what makes the
   * saved position reliable: the reader no longer issues a second
   * `GET /api/books/{id}` whose answer arrives after the first page has been
   * laid out and persisted (issue #225 §1.2). Same contract as AudioReader.
   */
  book = input<BookDto | null>(null);
  noteCreated = output<void>();
  highlightMode = input<boolean>(false);
  selectionCaptured = output<string>();
  commitFailed = output<void>();

  private notesService = inject(NotesService);
  private booksService = inject(BooksService);
  private themeService = inject(ThemeService);
  private injector = inject(Injector);
  private elementRef = inject(ElementRef);

  private epubBook: Book | null = null;
  private rendition: Rendition | null = null;
  private annotationManager: EpubAnnotationManager | null = null;
  private currentCfi: string | null = null;

  /** Keydown listeners registered inside each iframe's contents document. */
  private readonly keyboardDocuments = new Map<Document, () => void>();

  /**
   * Progress writes stay closed until the saved position has been applied. The
   * rendition reports its opening section as soon as it lays out, and writing
   * that used to overwrite the reader's real position whenever the restore
   * arrived second (issue #225 §1.2). Unlock happens in unlockProgress().
   */
  private progressUnlocked = false;

  /** Spine index of the displayed section — the coarse fallback position. */
  private spineIndex = signal<number | null>(null);

  // Track if locations are fully generated
  private locationsReady = signal(false);

  // --- IReader Interface Implementation ---
  toc = signal<TocItem[]>([]);
  progress = signal<ReaderProgress>({ label: '', percentage: 0 });
  currentHref = signal<string | null>(null);
  /** The TOC entry the displayed section belongs to, or null. */
  private activeTocItem = computed<TocItem | null>(() =>
    findTocItemForHref(this.toc(), this.currentHref()),
  );
  currentLocationTarget = computed(() => this.activeTocItem()?.target ?? null);

  // Internal Zoom State (restored per book — see fontSizeStorageKey)
  private currentFontSize = signal(100); // 100%

  /** Reader typography (typeface, line height, margins), persisted per book. */
  readonly typography = signal<EpubTypography>({ ...DEFAULT_TYPOGRAPHY });
  /** Outer margin for the current preset, as a percentage of the reader width. */
  readonly marginInset = computed(() => marginInsetPercent(this.typography().margin));
  readonly fontOptions = EPUB_FONT_OPTIONS;
  readonly lineOptions = EPUB_LINE_OPTIONS;
  readonly marginOptions = EPUB_MARGIN_OPTIONS;

  // RxJS Subjects
  private progressUpdater$ = new Subject<{ location: string; percentage: number }>();
  private resizeSubject$ = new Subject<void>();
  private resizeObserver: ResizeObserver | null = null;

  loading = signal(true);

  constructor() {
    effect(() => {
      if (this.bookId()) {
        // loadBook reads highlightMode() to sync the manager before display;
        // untracked keeps that read out of this effect's dependencies so a
        // mode toggle never re-triggers a full book reload.
        untracked(() => this.loadBook(this.bookId()));
      }
    });

    effect(() => {
      const mode = this.highlightMode();
      if (this.annotationManager) {
        this.annotationManager.setHighlightMode(mode);
      }
    });

    // The rendition is a separate document: re-select the matching Nostos
    // theme whenever the app theme changes, so the page follows light/dark
    // without a reload.
    effect(() => {
      const theme = this.themeService.theme();
      if (this.rendition) {
        this.selectReaderTheme(theme);
      }
    });
  }

  ngOnInit() {
    // Handle Window Resizing
    this.resizeSubject$.pipe(debounceTime(350)).subscribe(() => {
      if (this.rendition) {
        const page = this.elementRef.nativeElement.querySelector('#epub-page');
        if (page) {
          const { clientWidth, clientHeight } = page;
          try {
            this.rendition.resize(clientWidth, clientHeight);
          } catch (e) {
            console.warn('Rendition resize failed (book might not be ready):', e);
          }
        }
      }
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.resizeSubject$.next();
    });
    this.resizeObserver.observe(this.elementRef.nativeElement);

    // Backend Progress Sync (Debounced). The filter is the write barrier: see
    // progressUnlocked / unlockProgress().
    this.progressUpdater$
      .pipe(
        filter(() => this.progressUnlocked),
        debounceTime(1000),
        distinctUntilChanged(
          (prev, curr) => prev.location === curr.location && prev.percentage === curr.percentage,
        ),
      )
      .subscribe((data) => {
        this.booksService.updateProgress(this.bookId(), data.location, data.percentage).subscribe();
      });
  }

  // --- IReader Methods ---

  next() {
    this.rendition?.next();
  }

  previous() {
    this.rendition?.prev();
  }

  goTo(target: string | number) {
    this.rendition?.display(target.toString());
  }

  getCurrentLocation(): string | null {
    if (!this.rendition) return null;
    try {
      const location = this.rendition.currentLocation() as any;
      if (location && location.start) {
        return location.start.cfi;
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  zoomIn() {
    this.currentFontSize.update((s) => Math.min(s + 10, 200)); // Max 200%
    this.applyFontSize();
  }

  zoomOut() {
    this.currentFontSize.update((s) => Math.max(s - 10, 50)); // Min 50%
    this.applyFontSize();
  }

  private applyFontSize() {
    if (this.rendition) {
      this.rendition.themes.fontSize(`${this.currentFontSize()}%`);
    }
    try {
      localStorage.setItem(this.fontSizeStorageKey(), String(this.currentFontSize()));
    } catch {
      // Private-mode storage can throw — the size still applies for the session.
    }
  }

  private fontSizeStorageKey(): string {
    return `nostos.epub-font-size.${this.bookId()}`;
  }

  private restoreSavedFontSize(): void {
    try {
      const raw = localStorage.getItem(this.fontSizeStorageKey());
      const parsed = raw == null ? NaN : parseInt(raw, 10);
      if (!isNaN(parsed)) this.currentFontSize.set(Math.min(200, Math.max(50, parsed)));
    } catch {
      // Storage unreadable — fall back to 100%.
    }
  }

  // --- Book Loading & Setup ---

  loadBook(id: string) {
    if (this.epubBook) {
      this.annotationManager?.destroy();
      this.annotationManager = null;
      this.epubBook.destroy();
      this.epubBook = null;
      this.rendition = null;
      this.currentCfi = null;
    }

    this.loading.set(true);
    this.locationsReady.set(false);

    // FIX 1: Append a dummy parameter ending in .epub
    // This tricks epub.js into treating the URL as a file, not a directory.
    const url = `/api/books/${id}/file?t=${Date.now()}.epub`;

    // FIX 2: Explicitly pass 'openAs: epub'
    const epubBook = ePub(url, { openAs: 'epub' });
    this.epubBook = epubBook;

    // 2. Setup Rendition Immediately
    // Render into the padded page box: the margin preset is padding on
    // #epub-viewer, so epub.js should paginate into what is left of it.
    const page = this.elementRef.nativeElement.querySelector('#epub-page');
    const width = page ? page.clientWidth : '100%';
    const height = page ? page.clientHeight : '100%';

    const rendition = epubBook.renderTo('epub-page', {
      width: width,
      height: height,
      flow: 'paginated',
      manager: 'default',
    });
    this.rendition = rendition;

    // Register both Nostos normalizations at rendition creation and select
    // the one matching the app theme BEFORE display, so the first section
    // is painted with the right palette (no white flash in dark mode, no
    // dark flash in light mode). epub.js injects the selected theme into
    // every contents it creates afterwards, so later chapters inherit it.
    this.restoreSavedFontSize();
    this.registerReaderThemes();
    this.applyFontSize();
    this.restoreSavedTypography();

    // 3. Register Hooks
    rendition.hooks.content.register((contents: Contents) => {
      this.injectCustomStyles(contents);
      this.annotationManager?.registerContents(contents);
      this.registerContentsKeyboard(contents);
    });

    // Initialize the annotation manager BEFORE the first display so the
    // opening section receives the injected styles and fallback listeners.
    this.annotationManager = new EpubAnnotationManager(
      rendition,
      id,
      this.injector,
      () => this.noteCreated.emit(),
      () => this.commitFailed.emit(),
    );
    this.annotationManager.setHighlightMode(this.highlightMode());
    this.annotationManager.setOnSelectionCaptured((text) =>
      this.selectionCaptured.emit(text),
    );
    this.annotationManager.init();

    rendition.on('relocated', (location: any) => {
      this.currentCfi = location.start.cfi;
      this.currentHref.set(location.start.href);
      this.spineIndex.set(typeof location.start.index === 'number' ? location.start.index : null);
      this.updateProgressState(location.start.cfi);
    });

    // 4. Process Book Metadata (Async)
    epubBook.ready
      .then(() => {
        if (epubBook.navigation) {
          const toc = this.mapTocItems(epubBook.navigation.toc);
          this.toc.set(toc);
        }

        // --- OPTIMIZATION START ---
        // Try to fetch locations from backend first
        this.booksService.getLocations(id).subscribe({
          next: (dto) => {
            // Cache HIT: Load saved locations
            if (dto.locations) {
              epubBook.locations.load(dto.locations);
              this.locationsReady.set(true);
              if (this.currentCfi) this.updateProgressState(this.currentCfi);
            }
          },
          error: () => {
            // Cache MISS: Generate locations (Expensive). The progress pill
            // shows a spine-based percentage while this runs, so a large book
            // is never left on "Calculating…" with no position at all
            // (issue #225 §1.4).
            epubBook.locations.generate(1000).then(() => {
              this.locationsReady.set(true);
              if (this.currentCfi) this.updateProgressState(this.currentCfi);

              // Save them for next time
              const json = epubBook.locations.save();
              if (json) {
                this.booksService.saveLocations(id, json).subscribe();
              }
            });
          },
        });
        // --- OPTIMIZATION END ---
      })
      .catch((err) => {
        console.error('Book metadata setup failed:', err);
        this.loading.set(false);
      });

    // 5. Display Book (Starts the stream/rendering). The saved position comes
    // from the Book the shell already holds — no second GET, whose late answer
    // used to lose the race against the first progress write.
    const restoreLocation = this.book()?.lastLocation ?? null;

    rendition
      .display()
      .then(() => {
        this.loading.set(false);
        this.applyFontSize();

        this.notesService.list(id).subscribe({
          next: (notes) => this.annotationManager?.restoreHighlights(notes),
          error: (err) => console.error('Failed to load notes:', err),
        });

        if (!restoreLocation) return undefined;

        return rendition.display(restoreLocation).catch((err: unknown) => {
          console.warn('Could not restore the saved reading position:', err);
        });
      })
      .catch((err) => {
        console.error('Failed to render book:', err);
        this.loading.set(false);
      })
      .finally(() => this.unlockProgress());
  }

  // --- Helpers ---

  private updateProgressState(cfi: string) {
    if (!this.epubBook) return;

    // Locations give the precise percentage. Until they exist — generation can
    // take a while on a large book — fall back to how far the current spine
    // section is through the spine: coarse, but real, and never a stuck
    // "Calculating…" with no position at all (issue #225 §1.3, §1.4).
    const percent =
      this.locationsReady() && this.epubBook.locations.length() > 0
        ? Math.floor(this.epubBook.locations.percentageFromCfi(cfi) * 100)
        : spinePercentFrom(this.spineIndex(), this.spineLength());

    this.progress.set({
      label: progressLabel(percent, this.activeChapterLabel()),
      percentage: percent,
    });

    this.progressUpdater$.next({ location: cfi, percentage: percent });
  }

  /**
   * Opens the progress stream and reports where the reader actually is. Called
   * once the opening display (and the restore, when there is one) has settled,
   * so the opening section can never overwrite the saved position
   * (issue #225 §1.2).
   */
  private unlockProgress(): void {
    this.progressUnlocked = true;
    const cfi = this.getCurrentLocation() ?? this.currentCfi;
    if (cfi) this.updateProgressState(cfi);
  }

  /** Label of the TOC entry the displayed section belongs to, for the pill. */
  private activeChapterLabel(): string | null {
    const label = this.activeTocItem()?.label?.trim();
    if (!label) return null;
    return label.length > 32 ? `${label.slice(0, 31)}…` : label;
  }

  /**
   * Number of sections in the spine. The bundled 0.3.93 typings for `Spine` do
   * not declare `spineItems`, which is what the implementation actually holds.
   */
  private spineLength(): number | null {
    const spine = this.epubBook?.spine as unknown as { spineItems?: unknown[] } | undefined;
    return spine?.spineItems?.length ?? null;
  }

  /**
   * Page keys pressed while the book itself has focus. The contents live in an
   * iframe, so those events never reach the shell's document listener; the same
   * helpers decide the action on both sides, so the binding cannot drift.
   */
  private registerContentsKeyboard(contents: Contents): void {
    const doc = contents.document;
    if (this.keyboardDocuments.has(doc)) return;

    const onKeydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      const action = pageActionForKey(event);
      if (!action) return;

      if (action === 'next') this.next();
      else this.previous();
      event.preventDefault();
    };

    doc.addEventListener('keydown', onKeydown);
    this.keyboardDocuments.set(doc, () => doc.removeEventListener('keydown', onKeydown));
  }

  private mapTocItems(items: any[]): TocItem[] {
    return items.map((item) => ({
      label: item.label.trim(),
      target: item.href,
      children: item.subitems ? this.mapTocItems(item.subitems) : [],
    }));
  }

  private injectCustomStyles(contents: any) {
    const fontUrl =
      'https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@300;400;500;600&family=Newsreader:wght@400;500;600&display=swap';
    const link = contents.document.createElement('link');
    link.setAttribute('rel', 'stylesheet');
    link.setAttribute('href', fontUrl);
    contents.document.head.appendChild(link);
    this.upsertTypographyStyle(contents.document);
  }

  /** Merge a patch into the typography, persist it, and repaint open sections. */
  setTypography(patch: Partial<EpubTypography>): void {
    const next = { ...this.typography(), ...patch };
    this.typography.set(next);
    try {
      // One preference for the whole reader, not per book — you should not have
      // to pick your typeface again for every new EPUB you open.
      localStorage.setItem(TYPOGRAPHY_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private-mode storage can throw — the setting still applies for the session.
    }
    this.applyTypographyToOpenContents();
    // The margin is padding on our own container; the binding updates in the
    // next change-detection pass, so measure the page after that.
    setTimeout(() => this.applyMarginInset(), 0);
  }

  resetTypography(): void {
    this.setTypography({ ...DEFAULT_TYPOGRAPHY });
  }

  /**
   * A stored typography preference, or null when there is none to read. Values
   * are validated against the presets, so a stale or hand-edited entry cannot
   * put the reader into an unsupported state.
   */
  private readStoredTypography(key: string): EpubTypography | null {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<EpubTypography>;
      return {
        fontFamily:
          parsed.fontFamily === 'serif' ||
          parsed.fontFamily === 'sans' ||
          parsed.fontFamily === 'mono'
            ? parsed.fontFamily
            : 'default',
        lineHeight:
          typeof parsed.lineHeight === 'number' && EPUB_LINE_OPTIONS.includes(parsed.lineHeight)
            ? parsed.lineHeight
            : DEFAULT_TYPOGRAPHY.lineHeight,
        margin:
          parsed.margin === 'narrow' || parsed.margin === 'wide' ? parsed.margin : 'normal',
      };
    } catch {
      // Corrupt or unreadable storage — treat it as "nothing stored".
      return null;
    }
  }

  /**
   * Load the reader-wide typography preference.
   *
   * Earlier versions stored it per book (`nostos.epub-typography.<bookId>`); that
   * value is adopted once, for the book it belongs to, so a setting already
   * chosen is not lost when the preference becomes reader-wide.
   */
  private restoreSavedTypography(): void {
    const stored = this.readStoredTypography(TYPOGRAPHY_STORAGE_KEY);
    if (stored) {
      this.typography.set(stored);
      return;
    }

    const legacy = this.readStoredTypography(this.legacyTypographyKey());
    if (!legacy) return;
    this.typography.set(legacy);
    try {
      localStorage.setItem(TYPOGRAPHY_STORAGE_KEY, JSON.stringify(legacy));
    } catch {
      // Adopting in memory is enough — the next change persists it.
    }
  }

  private legacyTypographyKey(): string {
    return `nostos.epub-typography.${this.bookId()}`;
  }

  /** Rewrite the typography style element in every already-rendered section. */
  private applyTypographyToOpenContents(): void {
    try {
      const raw = this.rendition?.getContents?.();
      const contents = Array.isArray(raw) ? raw : raw ? [raw] : [];
      for (const c of contents) {
        if (c?.document) this.upsertTypographyStyle(c.document);
      }
    } catch {
      // Best-effort repaint — the content hook covers newly rendered sections.
    }
  }

  /**
   * The margin preset is padding on our own viewer (see the binding in the
   * template), so the rendition has to be told the page got smaller — epub.js
   * paginates to the box it is given. Nothing is written into the book.
   */
  private applyMarginInset(): void {
    const page = this.elementRef.nativeElement.querySelector('#epub-page') as HTMLElement | null;
    if (!page || !this.rendition) return;
    const { clientWidth, clientHeight } = page;
    // A page box that has not been laid out yet measures 0 — resizing the
    // rendition to 0 would collapse it, so wait for the next pass instead.
    if (clientWidth <= 0 || clientHeight <= 0) return;
    try {
      this.rendition.resize(clientWidth, clientHeight);
    } catch {
      // Not laid out yet — the ResizeObserver path will catch up.
    }
  }

  private upsertTypographyStyle(doc: Document): void {
    try {
      let style = doc.getElementById(TYPOGRAPHY_STYLE_ID);
      if (!style) {
        style = doc.createElement('style');
        style.id = TYPOGRAPHY_STYLE_ID;
        doc.head.appendChild(style);
      }
      style.textContent = typographyCss(this.typography());
    } catch {
      // A section mid-teardown has no head to write to — skip it.
    }
  }

  private registerReaderThemes() {
    const themes = this.rendition?.themes;
    if (!themes) return;

    themes.register(NOSTOS_LIGHT_THEME, NOSTOS_LIGHT_RULES);
    themes.register(NOSTOS_DARK_THEME, NOSTOS_DARK_RULES);

    // Select the matching theme so the first section is rendered with it.
    this.selectReaderTheme(this.themeService.theme());
  }

  private selectReaderTheme(theme: Theme) {
    const themes = this.rendition?.themes;
    if (!themes) return;
    themes.select(theme === 'dark' ? NOSTOS_DARK_THEME : NOSTOS_LIGHT_THEME);
  }

  public deleteHighlight(cfiRange: string) {
    this.annotationManager?.removeHighlight(cfiRange);
  }

  removeHighlight(identifier: string): void {
    this.deleteHighlight(identifier);
  }

  commitHighlight(): void {
    this.annotationManager?.commitHighlight();
  }

  discardHighlight(): void {
    this.annotationManager?.discardHighlight();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeSubject$.complete();
    this.progressUpdater$.complete();
    for (const cleanup of this.keyboardDocuments.values()) {
      cleanup();
    }
    this.keyboardDocuments.clear();
    this.annotationManager?.destroy();
    this.annotationManager = null;
    if (this.epubBook) {
      this.epubBook.destroy();
    }
  }
}
