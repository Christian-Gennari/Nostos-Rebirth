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
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

import { EpubAnnotationManager } from './epub-annotation-manager';
import { NotesService } from '../../core/services/notes.service';
import { BooksService } from '../../core/services/books.service';
import { ThemeService, Theme } from '../../core/services/theme.service';
import { IReader, ReaderProgress, TocItem } from '../reader.interface';

/**
 * epub.js theme name for each app theme. These are registered once per
 * rendition and selected reactively (ThemeService signal -> effect).
 */
const THEME_NAMES: Record<Theme, string> = {
  light: 'nostos-light',
  dark: 'nostos-dark',
  sepia: 'nostos-sepia',
};

/**
 * Color-only rules for the epub.js iframe, mirroring the Nostos tokens from
 * styles.css (the iframe is a separate document and cannot read the parent's
 * CSS variables). Only foreground, background, links, and selection colors
 * are overridden; book typography, layout, emphasis, and images are left
 * untouched (images are never inverted).
 */
const NOSTOS_THEME_RULES: Record<Theme, Record<string, Record<string, string>>> = {
  light: {
    html: { background: '#ffffff !important', color: '#1a1a1a !important' },
    body: { background: '#ffffff !important', color: '#1a1a1a !important' },
    // Publisher CSS often sets explicit text colors (e.g. h1 { color: #000 });
    // normalize every element to inherit the theme text color so headings and
    // body text stay readable in every theme. `a` comes AFTER `body *` so the
    // theme link color wins for links (and their descendants).
    'body *': { color: 'inherit !important' },
    a: { color: '#60a5fa !important' },
    '::selection': { background: 'rgba(96, 165, 250, 0.3) !important' },
  },
  dark: {
    html: { background: '#161a21 !important', color: '#e6e8ec !important' },
    body: { background: '#161a21 !important', color: '#e6e8ec !important' },
    'body *': { color: 'inherit !important' },
    a: { color: '#60a5fa !important' },
    '::selection': { background: 'rgba(96, 165, 250, 0.3) !important' },
  },
  sepia: {
    html: { background: '#faf5e8 !important', color: '#3a2f1d !important' },
    body: { background: '#faf5e8 !important', color: '#3a2f1d !important' },
    'body *': { color: 'inherit !important' },
    a: { color: '#3d7fd9 !important' },
    '::selection': { background: 'rgba(61, 127, 217, 0.3) !important' },
  },
};

@Component({
  selector: 'app-epub-reader',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './epub-reader.component.html',
  styleUrl: './epub-reader.component.css',
})
export class EpubReader implements OnInit, OnDestroy, IReader {
  bookId = input.required<string>();
  noteCreated = output<void>();
  highlightMode = input<boolean>(false);
  selectionCaptured = output<string>();
  commitFailed = output<void>();

  private notesService = inject(NotesService);
  private booksService = inject(BooksService);
  private themeService = inject(ThemeService);
  private injector = inject(Injector);
  private elementRef = inject(ElementRef);

  private book: Book | null = null;
  private rendition: Rendition | null = null;
  private annotationManager: EpubAnnotationManager | null = null;
  private currentCfi: string | null = null;

  // Track if locations are fully generated
  private locationsReady = signal(false);

  // --- IReader Interface Implementation ---
  toc = signal<TocItem[]>([]);
  progress = signal<ReaderProgress>({ label: '', percentage: 0 });
  currentHref = signal<string | null>(null);
  currentLocationTarget = computed(() => {
    const href = this.currentHref();
    if (!href) return null;
    const baseHref = href.split('#')[0];
    const toc = this.toc();
    if (toc.length === 0) return null;

    let activeTarget: string | number | null = null;

    const traverse = (items: TocItem[]): boolean => {
      for (const item of items) {
        if (item.target.toString().split('#')[0] === baseHref) {
          activeTarget = item.target;
          return true;
        }
        if (item.children && traverse(item.children)) {
          return true;
        }
      }
      return false;
    };

    traverse(toc);
    return activeTarget;
  });

  // Internal Zoom State
  private currentFontSize = signal(100); // 100%

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

    // Reactive theme propagation: any in-session theme toggle re-selects the
    // epub.js theme on the live rendition without reopening the book. The
    // initial selection is applied eagerly in loadBook() (before display) so
    // the first section never flashes white; this effect only reacts to
    // changes afterwards. Re-selecting the same theme is idempotent.
    effect(() => {
      const theme = this.themeService.theme();
      if (this.rendition) {
        this.rendition.themes.select(THEME_NAMES[theme]);
      }
    });
  }

  ngOnInit() {
    // Handle Window Resizing
    this.resizeSubject$.pipe(debounceTime(350)).subscribe(() => {
      if (this.rendition) {
        const viewerContainer = this.elementRef.nativeElement.querySelector('#epub-viewer');
        if (viewerContainer) {
          const { clientWidth, clientHeight } = viewerContainer;
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

    // Backend Progress Sync (Debounced)
    this.progressUpdater$
      .pipe(
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
  }

  // --- Book Loading & Setup ---

  loadBook(id: string) {
    if (this.book) {
      this.annotationManager?.destroy();
      this.annotationManager = null;
      this.book.destroy();
      this.book = null;
      this.rendition = null;
      this.currentCfi = null;
    }

    this.loading.set(true);
    this.locationsReady.set(false);

    // FIX 1: Append a dummy parameter ending in .epub
    // This tricks epub.js into treating the URL as a file, not a directory.
    const url = `/api/books/${id}/file?t=${Date.now()}.epub`;

    // FIX 2: Explicitly pass 'openAs: epub'
    this.book = ePub(url, { openAs: 'epub' });

    // 2. Setup Rendition Immediately
    const viewer = this.elementRef.nativeElement.querySelector('#epub-viewer');
    const width = viewer ? viewer.clientWidth : '100%';
    const height = viewer ? viewer.clientHeight : '100%';

    this.rendition = this.book.renderTo('epub-viewer', {
      width: width,
      height: height,
      flow: 'paginated',
      manager: 'default',
    });

    // Apply the reader theme at rendition creation: register the Nostos
    // themes once per rendition and select the current one BEFORE display,
    // so the first section is painted with the chosen palette (no white
    // flash). epub.js injects the selected theme into every contents it
    // creates afterwards, so later chapters inherit it.
    this.registerThemes();

    // 3. Register Hooks
    this.rendition.hooks.content.register((contents: Contents) => {
      this.injectCustomStyles(contents);
      this.annotationManager?.registerContents(contents);
    });

    // Initialize the annotation manager BEFORE the first display so the
    // opening section receives the injected styles and fallback listeners.
    this.annotationManager = new EpubAnnotationManager(
      this.rendition,
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

    this.rendition.on('relocated', (location: any) => {
      this.currentCfi = location.start.cfi;
      this.currentHref.set(location.start.href);
      this.updateProgressState(location.start.cfi);
    });

    // 4. Process Book Metadata (Async)
    this.book.ready
      .then(() => {
        if (this.book?.navigation) {
          const toc = this.mapTocItems(this.book.navigation.toc);
          this.toc.set(toc);
        }

        // --- OPTIMIZATION START ---
        // Try to fetch locations from backend first
        this.booksService.getLocations(id).subscribe({
          next: (dto) => {
            // Cache HIT: Load saved locations
            if (this.book && dto.locations) {
              this.book.locations.load(dto.locations);
              this.locationsReady.set(true);
              if (this.currentCfi) this.updateProgressState(this.currentCfi);
            }
          },
          error: () => {
            // Cache MISS: Generate locations (Expensive)
            this.book?.locations.generate(1000).then(() => {
              this.locationsReady.set(true);
              if (this.currentCfi) this.updateProgressState(this.currentCfi);

              // Save them for next time
              const json = this.book?.locations.save();
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

    // 5. Display Book (Starts the stream/rendering)
    this.rendition
      .display()
      .then(() => {
        this.loading.set(false);
        this.applyFontSize();

        this.notesService.list(id).subscribe({
          next: (notes) => this.annotationManager?.restoreHighlights(notes),
          error: (err) => console.error('Failed to load notes:', err),
        });

        this.booksService.get(id).subscribe((b) => {
          if (b.lastLocation) {
            this.rendition?.display(b.lastLocation);
          }
        });
      })
      .catch((err) => {
        console.error('Failed to render book:', err);
        this.loading.set(false);
      });
  }

  // --- Helpers ---

  private updateProgressState(cfi: string) {
    if (!this.book) return;

    if (!this.locationsReady()) {
      this.progress.set({ label: 'Calculating...', percentage: 0 });
      return;
    }

    let percent = 0;
    let label = '';
    let tooltip = '';

    if ((this.book.locations as any).length() > 0) {
      // 1. Percentage
      const val = this.book.locations.percentageFromCfi(cfi);
      percent = Math.floor(val * 100);

      // 2. Time Estimation
      const currentLoc = this.book.locations.locationFromCfi(cfi) as any;
      const totalLocs = this.book.locations.length();

      // Time Remaining
      const locsRemaining = Math.max(0, totalLocs - currentLoc);
      const minutesRemaining = locsRemaining;

      // Format "Time Left"
      let timeLeftStr = '';
      if (minutesRemaining < 60) {
        timeLeftStr = `${minutesRemaining} min left`;
      } else {
        const h = Math.floor(minutesRemaining / 60);
        const m = minutesRemaining % 60;
        timeLeftStr = `${h}h ${m}m left`;
      }

      // 3. Dynamic Tooltip Calculation (1% ≈ ???)
      const secondsPerPercent = (totalLocs * 60) / 100;
      let rateLabel = '';

      if (secondsPerPercent < 60) {
        rateLabel = `${Math.round(secondsPerPercent)} sec`;
      } else {
        rateLabel = `${Math.round(secondsPerPercent / 60)} min`;
      }

      label = `${percent}% • ${timeLeftStr}`;
      tooltip = `1% ≈ ${rateLabel}`;
    } else {
      label = 'Calculating...';
    }

    this.progress.set({ label, percentage: percent, tooltip });
    this.progressUpdater$.next({ location: cfi, percentage: percent });
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
      'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Lora:wght@400;500;600&display=swap';
    const link = contents.document.createElement('link');
    link.setAttribute('rel', 'stylesheet');
    link.setAttribute('href', fontUrl);
    contents.document.head.appendChild(link);
  }

  private registerThemes() {
    const themes = this.rendition?.themes;
    if (!themes) return;

    (['light', 'dark', 'sepia'] as const).forEach((theme) => {
      themes.register(THEME_NAMES[theme], NOSTOS_THEME_RULES[theme]);
    });

    // Select the persisted/current theme so the first section is rendered
    // with it (the reactive effect covers later in-session toggles).
    themes.select(THEME_NAMES[this.themeService.theme()]);
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
    this.annotationManager?.destroy();
    this.annotationManager = null;
    if (this.book) {
      this.book.destroy();
    }
  }
}
