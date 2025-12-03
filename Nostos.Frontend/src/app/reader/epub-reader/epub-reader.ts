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
import { HttpClient } from '@angular/common/http';
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

  private http = inject(HttpClient);
  private notesService = inject(NotesService);
  private booksService = inject(BooksService);
  private injector = inject(Injector);
  private elementRef = inject(ElementRef);

  private book: Book | null = null;
  private rendition: Rendition | null = null;
  private annotationManager: EpubAnnotationManager | null = null;
  private currentCfi: string | null = null;

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
          this.rendition.resize(clientWidth, clientHeight);
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
          (prev, curr) => prev.location === curr.location && prev.percentage === curr.percentage
        )
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
    const location = this.rendition.currentLocation() as any;
    if (location && location.start) {
      return location.start.cfi;
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
    const url = `/api/books/${id}/file`;

    this.http.get(url, { responseType: 'arraybuffer' }).subscribe({
      next: (arrayBuffer) => {
        this.book = ePub(arrayBuffer);

        // 1. Generate Locations (Async)
        this.book.ready
          .then(() => {
            // Load TOC
            if (this.book?.navigation) {
              const toc = this.mapTocItems(this.book.navigation.toc);
              this.toc.set(toc);
            }
            return this.book?.locations.generate(1000);
          })
          .then(() => {
            // Initial Progress Update after generation
            if (this.currentCfi) this.updateProgressState(this.currentCfi);
          })
          .catch((err) => console.error('Book setup failed:', err));

        // 2. Render
        this.rendition = this.book.renderTo('epub-viewer', {
          width: '100%',
          height: '100%',
          flow: 'paginated',
          manager: 'default',
        });

        // 3. Register Hooks (Styles & Highlights)
        this.rendition.hooks.content.register((contents: any) => {
          this.injectCustomStyles(contents);
          this.annotationManager?.injectHighlightStyles(contents);
        });

        // 4. Display & Restore State
        this.rendition.display().then(() => {
          this.loading.set(false);
          this.applyTheme();
          this.applyFontSize(); // Restore font size if persisted (optional)

          // Init Annotation Manager
          this.annotationManager = new EpubAnnotationManager(
            this.rendition!,
            id,
            this.injector,
            () => this.noteCreated.emit()
          );
          this.annotationManager.init();

          // Restore Notes
          this.notesService.list(id).subscribe({
            next: (notes) => this.annotationManager?.restoreHighlights(notes),
            error: (err) => console.error('Failed to load notes:', err),
          });

          // Restore Position
          this.booksService.get(id).subscribe((b) => {
            if (b.lastLocation) {
              this.rendition?.display(b.lastLocation);
            }
          });
        });

        // 5. Track Location Changes
        this.rendition.on('relocated', (location: any) => {
          this.currentCfi = location.start.cfi;
          this.updateProgressState(location.start.cfi);
        });
      },
      error: (err) => {
        console.error('Failed to load EPUB file:', err);
        this.loading.set(false);
      },
    });
  }

  // --- Helpers ---

  private updateProgressState(cfi: string) {
    if (!this.book) return;

    let percent = 0;
    let label = '';

    // Calculate Percentage
    if ((this.book.locations as any).length() > 0) {
      const val = this.book.locations.percentageFromCfi(cfi);
      percent = Math.floor(val * 100);

      // Calculate Label (e.g., "Loc 15 of 300")
      // Note: EpubJS locations are roughly "screens" of text
      const currentLoc = this.book.locations.locationFromCfi(cfi);
      const totalLocs = this.book.locations.length();
      label = `Loc ${currentLoc} of ${totalLocs}`;
    } else {
      // Fallback if locations aren't generated yet
      label = 'Calculating...';
    }

    // Update UI Signal
    this.progress.set({ label, percentage: percent });

    // Notify Backend (Debounced via Subject)
    this.progressUpdater$.next({ location: cfi, percentage: percent });
  }

  private mapTocItems(items: any[]): TocItem[] {
    return items.map((item) => ({
      label: item.label.trim(),
      target: item.href, // EpubJS handles HREFs automatically in display()
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
        // Font size is handled by .fontSize(), not here, to avoid conflicts
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
