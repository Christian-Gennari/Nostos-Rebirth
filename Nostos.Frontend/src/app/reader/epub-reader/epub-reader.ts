import {
  Component,
  input,
  output,
  OnInit,
  OnDestroy,
  signal,
  effect,
  inject,
  Injector,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import ePub, { Book, Rendition } from 'epubjs';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

import { EpubAnnotationManager } from './epub-annotation-manager';
import { NotesService } from '../../services/notes.services';
import { BooksService } from '../../services/books.services';
import { IReader, ReaderProgress, TocItem } from '../reader.interface';

@Component({
  selector: 'app-epub-reader',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './epub-reader.html',
  styleUrl: './epub-reader.css',
})
export class EpubReader implements OnInit, OnDestroy, IReader {
  bookId = input.required<string>();
  noteCreated = output<void>();

  private notesService = inject(NotesService);
  private booksService = inject(BooksService);
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
        this.loadBook(this.bookId());
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
      this.book.destroy();
      this.book = null;
      this.rendition = null;
      this.annotationManager = null;
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

    // 3. Register Hooks
    this.rendition.hooks.content.register((contents: any) => {
      this.injectCustomStyles(contents);
      this.annotationManager?.injectHighlightStyles(contents);
    });

    this.rendition.on('relocated', (location: any) => {
      this.currentCfi = location.start.cfi;
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
        this.applyTheme();
        this.applyFontSize();

        this.annotationManager = new EpubAnnotationManager(this.rendition!, id, this.injector, () =>
          this.noteCreated.emit(),
        );
        this.annotationManager.init();

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

  private applyTheme() {
    const style = getComputedStyle(document.documentElement);
    const bg = style.getPropertyValue('--bg-body').trim();
    const text = style.getPropertyValue('--color-text-main').trim();

    this.rendition?.themes.register('default', {
      body: {
        'font-family': "'Lora', serif",
        color: text,
        background: bg,
        'line-height': '1.6',
      },
      'h1, h2, h3, h4': {
        'font-family': "'Lora', serif",
        color: text,
        'font-weight': '600',
      },
    });

    this.rendition?.themes.select('default');
  }

  public deleteHighlight(cfiRange: string) {
    this.annotationManager?.removeHighlight(cfiRange);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    if (this.book) {
      this.book.destroy();
    }
  }
}
