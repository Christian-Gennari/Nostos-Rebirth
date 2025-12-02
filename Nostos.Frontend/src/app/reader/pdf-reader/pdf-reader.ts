import { Component, input, computed, inject, OnInit, output, ViewChild } from '@angular/core';
import {
  NgxExtendedPdfViewerModule,
  NgxExtendedPdfViewerComponent,
  TextLayerRenderedEvent,
  PagesLoadedEvent,
} from 'ngx-extended-pdf-viewer';
import { PdfAnnotationManager, PageHighlight } from './pdf-annotation-manager';
import { NotesService } from '../../services/notes.services';

@Component({
  selector: 'app-pdf-reader',
  standalone: true,
  imports: [NgxExtendedPdfViewerModule],
  templateUrl: './pdf-reader.html',
  styleUrl: './pdf-reader.css',
})
export class PdfReader implements OnInit {
  private highlightService = inject(PdfAnnotationManager);
  private notesService = inject(NotesService);

  @ViewChild(NgxExtendedPdfViewerComponent) pdfViewer!: NgxExtendedPdfViewerComponent;

  bookId = input.required<string>();
  noteCreated = output<void>();

  pdfSrc = computed(() => `/api/books/${this.bookId()}/file`);
  savedHighlights: PageHighlight[] = [];

  currentPage: number | undefined;
  totalPages = 0;

  ngOnInit() {
    this.loadNotes();
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

  prevPage() {
    const current = this.currentPage ?? this.pdfViewer?.page ?? 1;
    if (current > 1) {
      this.currentPage = current - 1;
    }
  }

  nextPage() {
    const current = this.currentPage ?? this.pdfViewer?.page ?? 1;
    if (current < this.totalPages) {
      this.currentPage = current + 1;
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

  /**
   * 👇 NEW: Called by ReaderShell to remove a highlight visually
   */
  removeHighlight(id: string) {
    const index = this.savedHighlights.findIndex((h) => h.id === id);
    if (index !== -1) {
      const pageNumber = this.savedHighlights[index].pageNumber;
      // 1. Remove from local array
      this.savedHighlights.splice(index, 1);
      // 2. Repaint that page immediately
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

          // 👇 NEW: Paint the new highlight immediately
          this.repaintPage(highlight.pageNumber);
        },
      });
  }

  /**
   * 👇 NEW: Helper to find the DOM element for a page and force a repaint
   */
  private repaintPage(pageNumber: number) {
    // We look for the specific textLayer in the DOM for the given page number
    const textLayerSelector = `.page[data-page-number="${pageNumber}"] .textLayer`;
    const textLayer = document.querySelector(textLayerSelector) as HTMLElement;

    // If the page is currently in the DOM (visible or cached), we repaint it.
    if (textLayer) {
      const pageHighlights = this.savedHighlights.filter((h) => h.pageNumber === pageNumber);
      const validHighlights = pageHighlights.filter((h) => h.rects && h.rects.length > 0);

      this.highlightService.paint(textLayer, validHighlights);
    }
  }

  handleError(error: any) {
    console.error('PDF Viewer Error:', error);
  }
}
