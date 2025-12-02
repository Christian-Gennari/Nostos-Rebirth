import { Component, input, computed, inject, OnInit, output } from '@angular/core';
import {
  NgxExtendedPdfViewerModule,
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

  bookId = input.required<string>();
  noteCreated = output<void>();

  pdfSrc = computed(() => `/api/books/${this.bookId()}/file`);
  savedHighlights: PageHighlight[] = [];

  currentPage = 1;
  totalPages = 0;

  ngOnInit() {
    this.loadNotes();
  }

  onPagesLoaded(event: PagesLoadedEvent) {
    this.totalPages = event.pagesCount;
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
                rects: range.rects || [], // Handle cases without rects (quick notes)
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
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }

  nextPage() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
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

  /** * 👇 NEW: Called by ReaderShell when saving a Quick Note.
   * Attempts to get exact location, falls back to current page.
   */
  getCurrentLocation(): string {
    // 1. Try to get a precise location (if user clicked somewhere in PDF recently)
    const loc = this.highlightService.captureNoteLocation();

    if (loc) {
      return JSON.stringify({
        pageNumber: loc.pageNumber,
        yPercent: loc.yPercent,
        rects: [], // Empty rects for note-only
      });
    }

    // 2. Fallback: Just return the current page number
    return JSON.stringify({
      pageNumber: this.currentPage,
      yPercent: 0,
      rects: [],
    });
  }

  // --- Internal Logic ---

  onTextLayerRendered(event: TextLayerRenderedEvent) {
    const textLayerDiv = event.source.textLayer?.div;
    if (!textLayerDiv) return;
    const pageHighlights = this.savedHighlights.filter((h) => h.pageNumber === event.pageNumber);

    // Only paint if there are actual rects to paint
    const validHighlights = pageHighlights.filter((h) => h.rects && h.rects.length > 0);

    this.highlightService.paint(textLayerDiv, validHighlights);
  }

  onTextSelection() {
    // Use the highlight capture specifically for selections
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
        },
      });
  }

  handleError(error: any) {
    console.error('PDF Viewer Error:', error);
  }
}
