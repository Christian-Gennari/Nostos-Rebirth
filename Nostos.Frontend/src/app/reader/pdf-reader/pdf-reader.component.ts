// src/app/reader/pdf-reader/pdf-reader.ts
import {
  Component,
  ElementRef,
  input,
  computed,
  inject,
  OnInit,
  output,
  ViewChild,
  OnDestroy,
  signal,
  HostListener,
} from '@angular/core';
import {
  NgxExtendedPdfViewerModule,
  NgxExtendedPdfViewerComponent,
  TextLayerRenderedEvent,
  PagesLoadedEvent,
  PdfLoadedEvent,
  ScrollModeType,
} from 'ngx-extended-pdf-viewer';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, filter } from 'rxjs/operators';

import { PdfAnnotationManager, PageHighlight } from './pdf-annotation-manager';
import { DEFAULT_HIGHLIGHT_COLOUR, HighlightColour } from '../highlight-colours';
import { NotesService } from '../../core/services/notes.service';
import { BooksService } from '../../core/services/books.service';
import { ThemeService } from '../../core/services/theme.service';
import { IReader, ReaderProgress, TocItem } from '../reader.interface';

/**
 * Surround colours for the pdf.js viewer canvas, mirroring the Nostos tokens
 * from styles.css. Light keeps the established near-white; dark follows
 * `--bg-body` (#0d0e11). The library's `[theme]` input adds a CSS-variable
 * sheet that themes its own toolbar/sidebar/find bar chrome.
 */
const PDF_LIGHT_SURROUND = '#fefeff';
const PDF_DARK_SURROUND = '#0d0e11';

/**
 * Page fits a fixed-layout document can be read at, offered in the shell's view
 * panel. A phone default of a fitted whole page renders a 512-page book at about
 * 9.5px, so 'page-width' leads; 100 is actual size (issue #226 §9).
 */
export const PDF_ZOOM_PRESETS: { value: string | number; label: string }[] = [
  { value: 'page-width', label: 'Fit width' },
  { value: 'page-fit', label: 'Whole page' },
  { value: 100, label: 'Actual size' },
];

interface PendingPdfHighlight {
  tempId: string;
  pageNumber: number;
  rects: { left: number; top: number; width: number; height: number }[];
  selectedText: string;
}

@Component({
  selector: 'app-pdf-reader',
  standalone: true,
  // `NgxExtendedPdfViewerModule` supplies the viewer itself. It used to be
  // imported alongside `IconButtonComponent`, which was only ever there for the
  // find bar's close control; with that gone the module is the whole list.
  imports: [NgxExtendedPdfViewerModule],
  templateUrl: './pdf-reader.component.html',
  styleUrl: './pdf-reader.component.css',
})
export class PdfReader implements OnInit, OnDestroy, IReader {
  private highlightService = inject(PdfAnnotationManager);
  private notesService = inject(NotesService);
  private booksService = inject(BooksService);
  private themeService = inject(ThemeService);
  /**
   * This component's own host element. The library renders the find bar inside
   * it, so a query scoped here reaches the fields we need to focus without
   * touching the rest of the document.
   */
  private host = inject(ElementRef<HTMLElement>);

  // --- Theme-following surround (issue #259) ---

  /** Whether the app is currently in dark mode. */
  isDark = computed(() => this.themeService.theme() === 'dark');

  /** The library's own theme — 'dark' activates `<pdf-dark-theme>`. */
  pdfTheme = computed(() => (this.isDark() ? 'dark' : 'light'));

  /** Surround colour for the viewer canvas. */
  pdfBgColor = computed(() => (this.isDark() ? PDF_DARK_SURROUND : PDF_LIGHT_SURROUND));

  // --- Page-colour inversion (issue #259) ---

  /**
   * Whether the rendered page pixels are inverted. In dark mode the default is
   * `true` so the page looks like a native dark surface (matching how the EPUB
   * reader injects dark rules); the user can flip it in the View-settings panel.
   * Persisted per book.
   */
  pageInverted = signal(false);

  /** Toggle the inversion and persist the choice. */
  setPageInverted(value: boolean): void {
    this.pageInverted.set(value);
    try {
      localStorage.setItem(this.invertStorageKey(), JSON.stringify(value));
    } catch {
      // Private-mode storage — the mode still applies for the session.
    }
  }

  private invertStorageKey(): string {
    return `nostos.pdf-invert.${this.bookId()}`;
  }

  private restoreSavedInversion(): void {
    try {
      const raw = localStorage.getItem(this.invertStorageKey());
      if (raw !== null) {
        this.pageInverted.set(JSON.parse(raw) === true);
        return;
      }
    } catch {
      // fall through
    }
    // Default: inverted in dark, as-printed in light.
    this.pageInverted.set(this.isDark());
  }

  @ViewChild(NgxExtendedPdfViewerComponent) pdfViewer!: NgxExtendedPdfViewerComponent;

  bookId = input.required<string>();
  initialLocation = input<string | undefined>();
  noteCreated = output<void>();
  highlightMode = input<boolean>(false);
  /** The book's highlighter pen (issue #208), owned by the shell. */
  highlightColour = input<HighlightColour>(DEFAULT_HIGHLIGHT_COLOUR);
  selectionCaptured = output<string>();
  commitFailed = output<void>();

  sidebarVisible = input<boolean>(false);
  sidebarVisibleChange = output<boolean>();

  /**
   * Search bar visibility, opened by Ctrl/Cmd+F from anywhere in the reader.
   * Before this the bar was never opened and no other search path existed, so
   * Ctrl+F did nothing at all in a PDF (issue #226 §2).
   */
  findBarVisible = signal(false);

  /**
   * Open the find bar and put the caret in the field. Called by the shell's
   * header control, so search is reachable by touch — a keyboard shortcut alone
   * left it undiscoverable on a phone (issue #226 §2/§9). The Ctrl/Cmd+F handler
   * calls the same method.
   */
  openSearch(): void {
    this.findBarVisible.set(true);
    this.focusFindInput();
  }

  /**
   * Close the bar. The library's find bar renders no close control of its own —
   * its only buttons are prev/next — so dismissal comes from the header's Search
   * toggle (which is a toggle, `aria-expanded`) and from Escape. A close control
   * inside the bar was removed: it duplicated the toggle, and pdf.js's
   * `button:focus { border: 1px solid blue }` painted a blue border on it that no
   * `.icon-btn` rule could out-specify.
   */
  closeSearch(): void {
    this.findBarVisible.set(false);
  }

  /**
   * Toggle, so the header control that OPENED the bar also closes it. Pressing it
   * again used to be a no-op, which left Escape as the only way out of a bar with
   * no visible close (a #226 follow-up).
   */
  toggleSearch(): void {
    if (this.findBarVisible()) this.closeSearch();
    else this.openSearch();
  }

  /**
   * Focus the find field. The bar is rendered by the library, so it reaches the
   * DOM one change-detection pass after `findBarVisible` flips — a single
   * synchronous query can run before the element exists, so retry briefly
   * instead of assuming one frame is enough.
   */
  private focusFindInput(attempt = 0): void {
    const input: HTMLInputElement | null = this.host.nativeElement.querySelector('#findInput');
    if (input) {
      input.focus();
      return;
    }
    if (attempt < 6) setTimeout(() => this.focusFindInput(attempt + 1), 30);
  }

  /**
   * Ctrl/Cmd+F opens the library's find bar; Escape closes it first, without
   * letting the event reach the shell (which would close a rail instead).
   * The shell's page-key handler ignores modifier chords, so page turns are
   * unaffected.
   */
  @HostListener('document:keydown', ['$event'])
  onShortcutKeydown(event: KeyboardEvent): void {
    if (this.findBarVisible() && event.key === 'Escape') {
      this.findBarVisible.set(false);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    if (event.key.toLowerCase() !== 'f') return;
    event.preventDefault();
    this.openSearch();
  }

  pdfSrc = computed(() => `/api/books/${this.bookId()}/file`);
  savedHighlights: PageHighlight[] = [];

  private pendingHighlight: PendingPdfHighlight | null = null;

  // --- IReader Implementation ---
  toc = signal<TocItem[]>([]);
  progress = signal<ReaderProgress>({ label: '', percentage: 0 });
  currentLocationTarget = computed(() => {
    const page = this.progress()?.pageNumber ?? 1;
    const toc = this.toc();
    if (toc.length === 0) return null;

    let activeTarget: string | number | null = null;
    let maxPage = -1;

    const traverse = (items: TocItem[]) => {
      for (const item of items) {
        const itemPage = typeof item.target === 'number' ? item.target : parseInt(item.target, 10);
        if (!isNaN(itemPage) && itemPage <= page && itemPage > maxPage) {
          maxPage = itemPage;
          activeTarget = item.target;
        }
        if (item.children) {
          traverse(item.children);
        }
      }
    };

    traverse(toc);
    return activeTarget;
  });

  // Internal State
  // `page-width` on a phone: a fitted full page renders a 512-page book at about
  // 9.5px, which is not reading, it is squinting. Desktop keeps the full-page fit.
  zoomLevel = signal<string | number>(this.initialZoom());
  currentPage = 1;
  totalPages = 0;
  private pdfDocRef: any = null;

  /**
   * Continuous vertical scrolling instead of one page at a time.
   *
   * The viewer was pinned to `ScrollModeType.page` (= 3), so a page could only be
   * left by clicking Next — there was no way to scroll on, which is what a reader
   * does by reflex in a 512-page book (issue #226 §3). The pager still jumps whole
   * pages, and progress still follows `pageChange`.
   *
   * Note there are two enums in this library: the `scrollMode` INPUT is typed
   * `ScrollModeType` (lowercase members) from `options/pdf-viewer`, while
   * `ScrollMode` (uppercase) is a different export. Binding the wrong one is a
   * template type error, not a silent no-op.
   */
  scrollMode = signal<ScrollModeType>(ScrollModeType.vertical);

  /**
   * The two reading modes, offered in the shell's view panel. Continuous is the
   * default (§3); page-by-page stays available because §9 asks for both.
   */
  readonly readingModes: { value: ScrollModeType; label: string }[] = [
    { value: ScrollModeType.vertical, label: 'Scroll' },
    { value: ScrollModeType.page, label: 'Page' },
  ];

  /** Set the reading mode and remember it for this book. */
  setScrollMode(mode: ScrollModeType): void {
    this.scrollMode.set(mode);
    try {
      localStorage.setItem(
        this.scrollStorageKey(),
        mode === ScrollModeType.page ? 'page' : 'scroll',
      );
    } catch {
      // Private-mode storage can throw — the mode still applies for the session.
    }
  }

  isScrollMode(mode: ScrollModeType): boolean {
    return this.scrollMode() === mode;
  }

  /** The viewer can change the mode itself (its own controls or keys). */
  onScrollModeChange(mode: ScrollModeType): void {
    this.setScrollMode(mode);
  }

  private scrollStorageKey(): string {
    return `nostos.pdf-scroll.${this.bookId()}`;
  }

  private restoreSavedScrollMode(): void {
    try {
      const saved = localStorage.getItem(this.scrollStorageKey());
      if (saved === 'page') this.scrollMode.set(ScrollModeType.page);
      else if (saved === 'scroll') this.scrollMode.set(ScrollModeType.vertical);
    } catch {
      // Unreadable storage keeps the continuous default.
    }
  }

  private initialZoom(): string {
    return typeof window !== 'undefined' && window.innerWidth <= 768 ? 'page-width' : 'page-fit';
  }

  private initialLoadComplete = false;

  private progressUpdater$ = new Subject<{ location: string; percentage: number }>();

  ngOnInit() {
    // Zoom and reading mode are per-book preferences; the viewport default is only
    // a starting point (issue #226 §3, §9).
    this.restoreSavedZoom();
    this.restoreSavedScrollMode();
    this.restoreSavedInversion();
    this.loadNotes();

    this.progressUpdater$
      .pipe(
        filter(() => this.initialLoadComplete),
        debounceTime(1000),
        distinctUntilChanged((prev, curr) => prev.location === curr.location),
      )
      .subscribe((data) => {
        this.booksService.updateProgress(this.bookId(), data.location, data.percentage).subscribe();
      });
  }

  // --- IReader Methods ---

  next() {
    if (this.currentPage < this.totalPages) {
      this.goTo(this.currentPage + 1);
    }
  }

  previous() {
    if (this.currentPage > 1) {
      this.goTo(this.currentPage - 1);
    }
  }

  goTo(target: string | number) {
    let targetPage = this.currentPage;

    try {
      if (typeof target === 'number') {
        targetPage = target;
      } else if (typeof target === 'string' && target.trim().startsWith('{')) {
        const range = JSON.parse(target);
        if (range.pageNumber) targetPage = range.pageNumber;
      } else if (typeof target === 'string') {
        const page = parseInt(target, 10);
        if (!isNaN(page)) targetPage = page;
      }
    } catch (e) {
      console.error('Invalid PDF location target', e);
    }

    if (targetPage > 0 && targetPage <= this.totalPages) {
      this.currentPage = targetPage;
      this.updateProgressState(targetPage);
    }
  }

  getCurrentLocation(): string {
    const loc = this.highlightService.captureNoteLocation();
    if (loc) {
      return JSON.stringify({ pageNumber: loc.pageNumber, yPercent: loc.yPercent, rects: [] });
    }
    return JSON.stringify({ pageNumber: this.currentPage, yPercent: 0, rects: [] });
  }

  zoomIn() {
    // From a named fit, the first step lands on a concrete percentage so the
    // reader is never stuck on a fit it cannot enlarge.
    const current = this.zoomLevel();
    this.setZoom(typeof current === 'number' ? Math.min(current + 10, 400) : 110);
  }

  zoomOut() {
    const current = this.zoomLevel();
    this.setZoom(typeof current === 'number' ? Math.max(current - 10, 20) : 90);
  }

  /**
   * Set the zoom and remember it for THIS book (issue #226 §9: "zoom persists
   * per book"). A named fit is stored as the name, so it keeps adapting when the
   * window changes; a chosen percentage is stored as the number picked.
   */
  setZoom(zoom: string | number): void {
    this.zoomLevel.set(zoom);
    try {
      localStorage.setItem(this.zoomStorageKey(), JSON.stringify(zoom));
    } catch {
      // Private-mode storage can throw — the zoom still applies for the session.
    }
  }

  /** Whether a preset is the zoom currently in effect (drives the active chip). */
  isZoomPreset(preset: string | number): boolean {
    const current = this.zoomLevel();
    if (typeof current === 'number' || typeof preset === 'number') return current === preset;
    return String(current).toLowerCase() === String(preset).toLowerCase();
  }

  /**
   * What to show beside the zoom steps. A named fit reads as a percentage of the
   * page it is fitting, which is the only honest number available before the
   * rendition has measured anything.
   */
  zoomLabel(): string {
    const current = this.zoomLevel();
    if (typeof current === 'number') return `${current}%`;
    return current === 'page-width' ? 'Fit width' : 'Whole page';
  }

  readonly zoomPresets = PDF_ZOOM_PRESETS;

  private zoomStorageKey(): string {
    return `nostos.pdf-zoom.${this.bookId()}`;
  }

  private restoreSavedZoom(): void {
    try {
      const raw = localStorage.getItem(this.zoomStorageKey());
      if (raw === null) return;
      const parsed = JSON.parse(raw) as string | number;
      if (typeof parsed === 'number' || typeof parsed === 'string') this.zoomLevel.set(parsed);
    } catch {
      // Unreadable storage falls back to the viewport default.
    }
  }

  // --- PDF Events ---

  onPagesLoaded(event: PagesLoadedEvent) {
    this.totalPages = event.pagesCount;
    this.loadNotes();

    // The outline needs the PDFDocumentProxy, and `pdfLoaded` cannot provide it:
    // the library's PdfLoadedEvent is `{ pagesCount }` and nothing else, so the
    // old `if (pdfDoc)` guard was always false and the contents rail stayed
    // empty for every PDF — a 512-page book with 129 bookmarks rendered
    // "No Table of Contents available." (issue #226 §1). `pagesLoaded.source`
    // IS the viewer application, and it carries the document.
    const doc = (event as any).source?.pdfDocument ?? null;
    if (doc && doc !== this.pdfDocRef) {
      this.pdfDocRef = doc;
      void this.loadPdfOutline(doc);
    }

    if (!this.initialLoadComplete) {
      const startLoc = this.initialLocation();

      if (startLoc) {
        this.goTo(startLoc);
      } else {
        this.updateProgressState(1);
      }

      setTimeout(() => (this.initialLoadComplete = true), 500);
    }
  }

  /** Best-effort second path: some loads fire this with the document attached. */
  async onPdfLoaded(event: PdfLoadedEvent) {
    const doc = (event as any).source?.pdfDocument ?? (event as any).pdfDocument ?? null;
    if (doc && doc !== this.pdfDocRef) {
      this.pdfDocRef = doc;
      await this.loadPdfOutline(doc);
    }
  }

  /** Map the embedded PDF outline into the contents rail the shell renders. */
  private async loadPdfOutline(pdfDoc: any): Promise<void> {
    try {
      const outline = await pdfDoc.getOutline();
      if (!outline || outline.length === 0) {
        this.toc.set([]);
        return;
      }
      this.toc.set(await this.mapPdfOutline(outline, pdfDoc));
    } catch (err) {
      console.error('Error fetching PDF outline', err);
      this.toc.set([]);
    }
  }

  onPageChange(newPage: number) {
    this.currentPage = newPage;
    this.updateProgressState(newPage);
  }

  onTextLayerRendered(event: TextLayerRenderedEvent) {
    const textLayerDiv = event.source.textLayer?.div;
    if (!textLayerDiv) return;

    const pageHighlights = this.savedHighlights.filter((h) => h.pageNumber === event.pageNumber);
    const validHighlights = pageHighlights.filter((h) => h.rects && h.rects.length > 0);
    this.highlightService.paint(textLayerDiv, validHighlights, this.highlightColour());
  }

  // --- Selection Logic ---

  onTextSelection() {
    if (!this.highlightMode()) return;

    const highlight = this.highlightService.captureHighlight(true);
    if (!highlight) return;

    if (this.pendingHighlight) {
      const old = this.pendingHighlight;
      this.savedHighlights = this.savedHighlights.filter((h) => h.id !== old.tempId);
      this.repaintPage(old.pageNumber);
    }

    const tempId = `temp-${Date.now()}`;

    this.pendingHighlight = {
      tempId,
      pageNumber: highlight.pageNumber,
      rects: highlight.rects,
      selectedText: highlight.selectedText,
    };

    this.selectionCaptured.emit(highlight.selectedText);
  }

  // --- Helpers ---

  loadNotes() {
    this.notesService.list(this.bookId()).subscribe({
      next: (notes) => {
        this.savedHighlights = notes
          .filter((n) => n.cfiRange)
          .map((n) => {
            try {
              const range = JSON.parse(n.cfiRange!);
              return {
                id: n.id,
                pageNumber: range.pageNumber,
                rects: range.rects || [],
              } as PageHighlight;
            } catch {
              return null;
            }
          })
          .filter((h) => h !== null) as PageHighlight[];

        const pagesToRepaint = [...new Set(this.savedHighlights.map((h) => h.pageNumber))];
        pagesToRepaint.forEach((pageNum) => this.repaintPage(pageNum));
      },
    });
  }

  removeHighlight(id: string) {
    const index = this.savedHighlights.findIndex((h) => h.id === id);
    if (index !== -1) {
      const pageNumber = this.savedHighlights[index].pageNumber;
      this.savedHighlights.splice(index, 1);
      this.repaintPage(pageNumber);
    }
  }

  commitHighlight() {
    if (!this.pendingHighlight) return;

    const p = this.pendingHighlight;
    const newHighlight: PageHighlight = {
      id: p.tempId,
      pageNumber: p.pageNumber,
      rects: p.rects,
    };
    this.savedHighlights.push(newHighlight);
    this.repaintPage(p.pageNumber);

    const selection = window.getSelection();
    if (selection) selection.removeAllRanges();

    const cfiPayload = { pageNumber: p.pageNumber, rects: p.rects };

    this.notesService
      .create(this.bookId(), {
        content: '',
        selectedText: p.selectedText,
        cfiRange: JSON.stringify(cfiPayload),
      })
      .subscribe({
        next: (createdNote) => {
          const index = this.savedHighlights.findIndex((h) => h.id === p.tempId);
          if (index !== -1) {
            this.savedHighlights[index].id = createdNote.id;
          }
          this.pendingHighlight = null;
          this.noteCreated.emit();
        },
        error: () => {
          this.savedHighlights = this.savedHighlights.filter((h) => h.id !== p.tempId);
          this.repaintPage(p.pageNumber);
          this.pendingHighlight = null;
          this.commitFailed.emit();
        },
      });
  }

  discardHighlight() {
    if (!this.pendingHighlight) return;

    const selection = window.getSelection();
    if (selection) selection.removeAllRanges();

    this.pendingHighlight = null;
  }

  private repaintPage(pageNumber: number) {
    const textLayerSelector = `.page[data-page-number="${pageNumber}"] .textLayer`;
    const textLayer = document.querySelector(textLayerSelector) as HTMLElement;

    if (textLayer) {
      const pageHighlights = this.savedHighlights.filter((h) => h.pageNumber === pageNumber);
      const validHighlights = pageHighlights.filter((h) => h.rects && h.rects.length > 0);
      this.highlightService.paint(textLayer, validHighlights, this.highlightColour());
    }
  }

  private updateProgressState(page: number) {
    const percentage = this.totalPages > 0 ? Math.floor((page / this.totalPages) * 100) : 0;

    // Update the signal with the specific page numbers
    this.progress.set({
      label: `Page ${page} of ${this.totalPages}`,
      percentage,
      pageNumber: page,
      pageCount: this.totalPages,
    });

    const location = JSON.stringify({ pageNumber: page, yPercent: 0, rects: [] });
    this.progressUpdater$.next({ location, percentage });
  }

  private async mapPdfOutline(outline: any[], pdfDoc: any): Promise<TocItem[]> {
    const items: TocItem[] = [];
    for (const item of outline) {
      let pageNumber = 1;
      try {
        if (item.dest) {
          let dest = item.dest;
          // Named destination — resolve to explicit destination array
          if (typeof dest === 'string') {
            dest = await pdfDoc.getDestination(dest);
          }
          if (Array.isArray(dest) && dest.length > 0) {
            // dest[0] is a page reference object — resolve to 0-based page index
            const pageIndex = await pdfDoc.getPageIndex(dest[0]);
            pageNumber = pageIndex + 1; // convert to 1-based
          }
        }
      } catch {
        // If resolution fails, fall back to page 1
        pageNumber = 1;
      }
      const children = item.items?.length ? await this.mapPdfOutline(item.items, pdfDoc) : [];
      items.push({ label: item.title, target: pageNumber, children });
    }
    return items;
  }

  ngOnDestroy() {
    this.progressUpdater$.complete();
  }
}
