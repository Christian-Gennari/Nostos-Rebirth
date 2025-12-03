import {
  Component,
  input,
  computed,
  inject,
  OnInit,
  output,
  ViewChild,
  OnDestroy,
} from '@angular/core';
import {
  NgxExtendedPdfViewerModule,
  NgxExtendedPdfViewerComponent,
  TextLayerRenderedEvent,
  PagesLoadedEvent,
} from 'ngx-extended-pdf-viewer';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

import { PdfAnnotationManager, PageHighlight } from './pdf-annotation-manager';
import { NotesService } from '../../services/notes.services';
import { BooksService } from '../../services/books.services';

@Component({
  selector: 'app-pdf-reader',
  standalone: true,
  imports: [NgxExtendedPdfViewerModule],
  templateUrl: './pdf-reader.html',
  styleUrl: './pdf-reader.css',
})
export class PdfReader implements OnInit, OnDestroy {
  private highlightService = inject(PdfAnnotationManager);
  private notesService = inject(NotesService);
  private booksService = inject(BooksService);

  @ViewChild(NgxExtendedPdfViewerComponent) pdfViewer!: NgxExtendedPdfViewerComponent;

  bookId = input.required<string>();
  noteCreated = output<void>();

  pdfSrc = computed(() => `/api/books/${this.bookId()}/file`);
  savedHighlights: PageHighlight[] = [];

  currentPage: number | undefined;
  totalPages = 0;

  // Subject to handle debounced progress updates
  private progressUpdater$ = new Subject<{ location: string; percentage: number }>();

  ngOnInit() {
    this.loadNotes();

    // Subscribe to progress updates
    this.progressUpdater$
      .pipe(
        debounceTime(1000),
        distinctUntilChanged((prev, curr) => prev.location === curr.location)
      )
      .subscribe((data) => {
        this.booksService.updateProgress(this.bookId(), data.location, data.percentage).subscribe();
      });
  }

  onPagesLoaded(event: PagesLoadedEvent) {
    this.totalPages = event.pagesCount;

    // Sync restored page number to variable
    setTimeout(() => {
      if (this.pdfViewer) {
        this.currentPage = this.pdfViewer.page;
      }
    });

    this.loadNotes();
    this.restoreProgress();
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

  // --- Navigation Logic ---

  /**
   * Called by the HTML (pageChange) event AND manual navigation
   */
  onPageChange(newPage: number) {
    this.currentPage = newPage;

    // Calculate percentage
    const percentage = this.totalPages > 0 ? Math.floor((newPage / this.totalPages) * 100) : 0;

    // Create a JSON location string
    const location = JSON.stringify({
      pageNumber: newPage,
      yPercent: 0,
      rects: [],
    });

    this.progressUpdater$.next({ location, percentage });
  }

  prevPage() {
    const current = this.currentPage ?? this.pdfViewer?.page ?? 1;
    if (current > 1) {
      // Use onPageChange to ensure we trigger the save logic
      this.onPageChange(current - 1);
    }
  }

  nextPage() {
    const current = this.currentPage ?? this.pdfViewer?.page ?? 1;
    if (current < this.totalPages) {
      // Use onPageChange to ensure we trigger the save logic
      this.onPageChange(current + 1);
    }
  }

  // --- External API for Shell ---

  goToLocation(rangeJson: string) {
    try {
      const range = JSON.parse(rangeJson);
      if (range.pageNumber) {
        this.currentPage = range.pageNumber;
      }
    } catch (e) {
      console.error('Invalid PDF range', e);
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

  restoreProgress() {
    this.booksService.get(this.bookId()).subscribe((book) => {
      if (book.lastLocation) {
        this.goToLocation(book.lastLocation);
      }
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

  // --- Internal Logic ---

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

  handleError(error: any) {
    console.error('PDF Viewer Error:', error);
  }

  ngOnDestroy() {
    this.progressUpdater$.complete();
  }
}
