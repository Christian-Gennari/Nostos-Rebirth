import { Component, input, computed, inject, OnInit, output } from '@angular/core';
import {
  NgxExtendedPdfViewerModule,
  TextLayerRenderedEvent,
  PagesLoadedEvent, // <--- Import this
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

  // --- FIXED: Accept the event object, not a number ---
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
                rects: range.rects,
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

  // --- Internal Logic ---

  onTextLayerRendered(event: TextLayerRenderedEvent) {
    const textLayerDiv = event.source.textLayer?.div;
    if (!textLayerDiv) return;
    const pageHighlights = this.savedHighlights.filter((h) => h.pageNumber === event.pageNumber);
    this.highlightService.paint(textLayerDiv, pageHighlights);
  }

  onTextSelection() {
    const selection = this.highlightService.captureSelection();
    if (!selection) return;

    const rangeData = { pageNumber: selection.pageNumber, rects: selection.rects };

    this.notesService
      .create(this.bookId(), {
        content: '',
        selectedText: selection.text,
        cfiRange: JSON.stringify(rangeData),
      })
      .subscribe({
        next: (newNote) => {
          this.savedHighlights.push({
            id: newNote.id,
            pageNumber: selection.pageNumber,
            rects: selection.rects,
          });
          this.noteCreated.emit();
        },
      });
  }

  handleError(error: any) {
    console.error('PDF Viewer Error:', error);
  }
}
