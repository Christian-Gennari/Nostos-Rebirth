// src/app/reader/pdf-reader/pdf-reader.ts
import {
  Component,
  input,
  computed,
  inject,
  OnInit,
  output,
  ViewChild,
  OnDestroy,
  signal,
} from '@angular/core';
import {
  NgxExtendedPdfViewerModule,
  NgxExtendedPdfViewerComponent,
  TextLayerRenderedEvent,
  PagesLoadedEvent,
  PdfLoadedEvent,
} from 'ngx-extended-pdf-viewer';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

import { PdfAnnotationManager, PageHighlight } from './pdf-annotation-manager';
import { NotesService } from '../../services/notes.services';
import { BooksService } from '../../services/books.services';
import { IReader, ReaderProgress, TocItem } from '../reader.interface';

@Component({
  selector: 'app-pdf-reader',
  standalone: true,
  imports: [NgxExtendedPdfViewerModule],
  templateUrl: './pdf-reader.html',
  styleUrl: './pdf-reader.css',
})
export class PdfReader implements OnInit, OnDestroy, IReader {
  private highlightService = inject(PdfAnnotationManager);
  private notesService = inject(NotesService);
  private booksService = inject(BooksService);

  @ViewChild(NgxExtendedPdfViewerComponent) pdfViewer!: NgxExtendedPdfViewerComponent;

  bookId = input.required<string>();
  noteCreated = output<void>();

  pdfSrc = computed(() => `/api/books/${this.bookId()}/file`);
  savedHighlights: PageHighlight[] = [];

  // --- IReader Implementation ---
  toc = signal<TocItem[]>([]);
  progress = signal<ReaderProgress>({ label: '', percentage: 0 });

  // Internal State
  zoomLevel = signal<string | number>('auto');
  currentPage: number | undefined;
  totalPages = 0;

  // Subject to handle debounced progress updates
  private progressUpdater$ = new Subject<{ location: string; percentage: number }>();

  ngOnInit() {
    this.loadNotes();

    this.progressUpdater$
      .pipe(
        debounceTime(1000),
        distinctUntilChanged((prev, curr) => prev.location === curr.location)
      )
      .subscribe((data) => {
        this.booksService.updateProgress(this.bookId(), data.location, data.percentage).subscribe();
      });
  }

  // --- IReader Methods ---

  next() {
    const current = this.currentPage ?? this.pdfViewer?.page ?? 1;
    if (current < this.totalPages) {
      this.pdfViewer.page = current + 1;
    }
  }

  previous() {
    const current = this.currentPage ?? this.pdfViewer?.page ?? 1;
    if (current > 1) {
      this.pdfViewer.page = current - 1;
    }
  }

  goTo(target: string | number) {
    try {
      if (typeof target === 'number') {
        this.pdfViewer.page = target;
        return;
      }

      if (target.trim().startsWith('{')) {
        const range = JSON.parse(target);
        if (range.pageNumber) {
          this.pdfViewer.page = range.pageNumber;
        }
      } else {
        const page = parseInt(target, 10);
        if (!isNaN(page)) this.pdfViewer.page = page;
      }
    } catch (e) {
      console.error('Invalid PDF location target', e);
    }
  }

  getCurrentLocation(): string {
    const loc = this.highlightService.captureNoteLocation();

    if (loc) {
      return JSON.stringify({
        pageNumber: loc.pageNumber,
        yPercent: loc.yPercent,
        rects: [],
      });
    }

    const pageNum = this.currentPage ?? this.pdfViewer?.page ?? 1;
    return JSON.stringify({
      pageNumber: pageNum,
      yPercent: 0,
      rects: [],
    });
  }

  zoomIn() {
    this.zoomLevel.update((v) => {
      if (v === 'auto') return 110;
      if (typeof v === 'number') return v + 10;
      return 100;
    });
  }

  zoomOut() {
    this.zoomLevel.update((v) => {
      if (v === 'auto') return 90;
      if (typeof v === 'number') return Math.max(v - 10, 20);
      return 100;
    });
  }

  // --- PDF Specific Events ---

  onPagesLoaded(event: PagesLoadedEvent) {
    this.totalPages = event.pagesCount;

    setTimeout(() => {
      if (this.pdfViewer) {
        this.currentPage = this.pdfViewer.page;
        // [FIX] Ensure currentPage is a number (default to 1)
        this.updateProgressState(this.currentPage ?? 1);
      }
    });

    this.loadNotes();
    this.restoreProgress();
  }

  /**
   * Capture the outline (TOC) when PDF is fully parsed
   */
  async onPdfLoaded(event: PdfLoadedEvent) {
    // [FIX] Cast event to any to access the 'source' or hidden properties
    const pdfDoc = (event as any).source?.pdfDocument ?? (event as any).pdfDocument;

    if (pdfDoc) {
      try {
        const outline = await pdfDoc.getOutline();
        if (outline) {
          this.toc.set(this.mapPdfOutline(outline));
        }
      } catch (err) {
        console.error('Error fetching PDF outline', err);
      }
    }
  }

  onPageChange(newPage: number) {
    this.currentPage = newPage;
    this.updateProgressState(newPage);
  }

  // --- Helpers ---

  private updateProgressState(page: number) {
    const percentage = this.totalPages > 0 ? Math.floor((page / this.totalPages) * 100) : 0;

    this.progress.set({
      label: `Page ${page} of ${this.totalPages}`,
      percentage,
    });

    const location = JSON.stringify({ pageNumber: page, yPercent: 0, rects: [] });
    this.progressUpdater$.next({ location, percentage });
  }

  private mapPdfOutline(outline: any[]): TocItem[] {
    return outline.map((item: any) => {
      return {
        label: item.title,
        target: 0,
        children: item.items && item.items.length > 0 ? this.mapPdfOutline(item.items) : [],
      };
    });
  }

  restoreProgress() {
    this.booksService.get(this.bookId()).subscribe((book) => {
      if (book.lastLocation) {
        this.goTo(book.lastLocation);
      }
    });
  }

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

  onTextLayerRendered(event: TextLayerRenderedEvent) {
    const textLayerDiv = event.source.textLayer?.div;
    if (!textLayerDiv) return;
    const pageHighlights = this.savedHighlights.filter((h) => h.pageNumber === event.pageNumber);
    const validHighlights = pageHighlights.filter((h) => h.rects && h.rects.length > 0);
    this.highlightService.paint(textLayerDiv, validHighlights);
  }

  onTextSelection() {
    const highlight = this.highlightService.captureHighlight();
    if (!highlight) return;

    const cfiPayload = {
      pageNumber: highlight.pageNumber,
      rects: highlight.rects,
    };

    this.notesService
      .create(this.bookId(), {
        content: '',
        selectedText: highlight.selectedText,
        cfiRange: JSON.stringify(cfiPayload),
      })
      .subscribe({
        next: (newNote) => {
          this.savedHighlights.push({
            id: newNote.id,
            pageNumber: highlight.pageNumber,
            rects: highlight.rects,
          });
          this.noteCreated.emit();
          this.repaintPage(highlight.pageNumber);
        },
      });
  }

  private repaintPage(pageNumber: number) {
    const textLayerSelector = `.page[data-page-number="${pageNumber}"] .textLayer`;
    const textLayer = document.querySelector(textLayerSelector) as HTMLElement;

    if (textLayer) {
      const pageHighlights = this.savedHighlights.filter((h) => h.pageNumber === pageNumber);
      const validHighlights = pageHighlights.filter((h) => h.rects && h.rects.length > 0);
      this.highlightService.paint(textLayer, validHighlights);
    }
  }

  ngOnDestroy() {
    this.progressUpdater$.complete();
  }
}
