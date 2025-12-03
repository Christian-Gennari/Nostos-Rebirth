// Nostos.Frontend/src/app/reader/epub-reader/epub-reader.ts
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

@Component({
  selector: 'app-epub-reader',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './epub-reader.html',
  styleUrl: './epub-reader.css',
})
export class EpubReader implements OnInit, OnDestroy {
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

  // [FIX] Track the current CFI so we can update percentage after generation finishes
  private currentCfi: string | null = null;

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

    // [FIX] Updated distinctUntilChanged to allow updates if percentage changes (e.g., 0% -> 5% on same page)
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

        // --- FIX: Wait for location generation to finish ---
        this.book.ready
          .then(() => {
            // 1. Start generation (async)
            return this.book?.locations.generate(1000);
          })
          .then(() => {
            // 2. Generation Complete: Recalculate percentage for current page
            // This fixes the issue where it stays at 0% initially
            if (this.currentCfi && this.book) {
              const percentage = this.book.locations.percentageFromCfi(this.currentCfi);
              const percentInt = Math.floor(percentage * 100);
              this.progressUpdater$.next({ location: this.currentCfi, percentage: percentInt });
            }
          })
          .catch((err) => console.error('Location generation failed:', err));

        this.rendition = this.book.renderTo('epub-viewer', {
          width: '100%',
          height: '100%',
          flow: 'paginated',
          manager: 'default',
        });

        this.annotationManager = new EpubAnnotationManager(this.rendition, id, this.injector, () =>
          this.noteCreated.emit()
        );

        this.rendition.hooks.content.register((contents: any) => {
          const fontUrl =
            'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Lora:wght@400;500;600&display=swap';
          const link = contents.document.createElement('link');
          link.setAttribute('rel', 'stylesheet');
          link.setAttribute('href', fontUrl);
          contents.document.head.appendChild(link);

          this.annotationManager?.injectHighlightStyles(contents);
        });

        this.rendition.display().then(() => {
          this.loading.set(false);
          this.applyTheme();
          this.annotationManager?.init();

          this.booksService.get(id).subscribe((b) => {
            if (b.lastLocation) {
              this.rendition?.display(b.lastLocation);
            } else {
              this.rendition?.display();
            }
          });

          this.notesService.list(id).subscribe({
            next: (notes) => {
              this.annotationManager?.restoreHighlights(notes);
            },
            error: (err) => console.error('Failed to load existing notes:', err),
          });
        });

        // Track Location Changes
        this.rendition.on('relocated', (location: any) => {
          const cfi = location.start.cfi;
          this.currentCfi = cfi; // Update current tracked CFI

          let percent = 0;

          // [FIX] Try to get precise percentage from generated locations first
          // This will work after the generation promise resolves
          if (this.book && (this.book.locations as any).length() > 0) {
            const val = this.book.locations.percentageFromCfi(cfi);
            percent = Math.floor(val * 100);
          }
          // Fallback if locations aren't ready yet
          else if (location.start.percentage) {
            percent = Math.floor(location.start.percentage * 100);
          }

          this.progressUpdater$.next({ location: cfi, percentage: percent });
        });
      },
      error: (err) => {
        console.error('Failed to load EPUB file:', err);
        this.loading.set(false);
      },
    });
  }

  prevPage() {
    this.rendition?.prev();
  }

  nextPage() {
    this.rendition?.next();
  }

  public getCurrentLocationCfi(): string | null {
    if (!this.rendition) return null;
    const location = this.rendition.currentLocation() as any;
    if (location && location.start) {
      return location.start.cfi;
    }
    return null;
  }

  public goToLocation(cfi: string) {
    this.rendition?.display(cfi);
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
        'font-size': '1.1rem',
      },
      p: {
        'font-family': "'Lora', serif",
        'line-height': '1.6',
        'margin-bottom': '1em',
      },
      'h1, h2, h3, h4': {
        'font-family': "'Lora', serif",
        color: text,
        'font-weight': '600',
      },
    });

    this.rendition?.themes.select('default');
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    if (this.book) {
      this.book.destroy();
    }
  }

  public deleteHighlight(cfiRange: string) {
    if (this.annotationManager) {
      this.annotationManager.removeHighlight(cfiRange);
    }
  }
}
