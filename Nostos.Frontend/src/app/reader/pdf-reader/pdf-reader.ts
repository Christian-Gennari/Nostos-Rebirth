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
import { debounceTime, distinctUntilChanged, filter } from 'rxjs/operators';

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
  initialLocation = input<string | undefined>();
  noteCreated = output<void>();

  pdfSrc = computed(() => `/api/books/${this.bookId()}/file`);
  savedHighlights: PageHighlight[] = [];

  // --- IReader Implementation ---
  toc = signal<TocItem[]>([]);
  progress = signal<ReaderProgress>({ label: '', percentage: 0 });

  // Internal State
  // CHANGE: Set default to 'page-fit' for the initial load
  zoomLevel = signal<string | number>('page-fit');
  currentPage = 1;
  totalPages = 0;

  private initialLoadComplete = false;

  private progressUpdater$ = new Subject<{ location: string; percentage: number }>();

  ngOnInit() {
    this.loadNotes();

    this.progressUpdater$
      .pipe(
        filter(() => this.initialLoadComplete),
        debounceTime(1000),
        distinctUntilChanged((prev, curr) => prev.location === curr.location)
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
    // CHANGE: If current zoom is a string (like 'page-fit'), default to 110% to start manual zooming
    this.zoomLevel.update((v) => (typeof v === 'number' ? v + 10 : 110));
  }

  zoomOut() {
    // CHANGE: If current zoom is a string, default to 90%
    this.zoomLevel.update((v) => (typeof v === 'number' ? Math.max(v - 10, 20) : 90));
  }

  // --- PDF Events ---

  onPagesLoaded(event: PagesLoadedEvent) {
    this.totalPages = event.pagesCount;
    this.loadNotes();

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

  async onPdfLoaded(event: PdfLoadedEvent) {
    const pdfDoc = (event as any).source?.pdfDocument ?? (event as any).pdfDocument;
    if (pdfDoc) {
      try {
        const outline = await pdfDoc.getOutline();
        if (outline) this.toc.set(this.mapPdfOutline(outline));
      } catch (err) {
        console.error('Error fetching PDF outline', err);
      }
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
    this.highlightService.paint(textLayerDiv, validHighlights);
  }

  // --- Selection Logic ---

  onTextSelection() {
    const highlight = this.highlightService.captureHighlight();
    if (!highlight) return;

    const tempId = `temp-${Date.now()}`;
    const newHighlight: PageHighlight = {
      id: tempId,
      pageNumber: highlight.pageNumber,
      rects: highlight.rects,
    };

    this.savedHighlights.push(newHighlight);
    this.repaintPage(highlight.pageNumber);

    const cfiPayload = { pageNumber: highlight.pageNumber, rects: highlight.rects };
    this.notesService
      .create(this.bookId(), {
        content: '',
        selectedText: highlight.selectedText,
        cfiRange: JSON.stringify(cfiPayload),
      })
      .subscribe({
        next: (createdNote) => {
          const index = this.savedHighlights.findIndex((h) => h.id === tempId);
          if (index !== -1) {
            this.savedHighlights[index].id = createdNote.id;
          }
          this.noteCreated.emit();
        },
        error: () => {
          this.savedHighlights = this.savedHighlights.filter((h) => h.id !== tempId);
          this.repaintPage(highlight.pageNumber);
        },
      });
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

  private repaintPage(pageNumber: number) {
    const textLayerSelector = `.page[data-page-number="${pageNumber}"] .textLayer`;
    const textLayer = document.querySelector(textLayerSelector) as HTMLElement;

    if (textLayer) {
      const pageHighlights = this.savedHighlights.filter((h) => h.pageNumber === pageNumber);
      const validHighlights = pageHighlights.filter((h) => h.rects && h.rects.length > 0);
      this.highlightService.paint(textLayer, validHighlights);
    }
  }

  private updateProgressState(page: number) {
    const percentage = this.totalPages > 0 ? Math.floor((page / this.totalPages) * 100) : 0;
    this.progress.set({ label: `Page ${page} of ${this.totalPages}`, percentage });
    const location = JSON.stringify({ pageNumber: page, yPercent: 0, rects: [] });
    this.progressUpdater$.next({ location, percentage });
  }

  private mapPdfOutline(outline: any[]): TocItem[] {
    return outline.map((item: any) => ({
      label: item.title,
      target: 0,
      children: item.items?.length ? this.mapPdfOutline(item.items) : [],
    }));
  }

  ngOnDestroy() {
    this.progressUpdater$.complete();
  }
}
