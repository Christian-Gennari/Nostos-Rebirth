import { Component, input, computed, inject, OnInit, output } from '@angular/core'; // <--- Add output
import { NgxExtendedPdfViewerModule, TextLayerRenderedEvent } from 'ngx-extended-pdf-viewer';
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

  // Inputs
  bookId = input.required<string>();

  // Outputs (Connects to Shell)
  noteCreated = output<void>(); // <--- NEW: Signal the parent

  // State
  pdfSrc = computed(() => `/api/books/${this.bookId()}/file`);
  savedHighlights: PageHighlight[] = [];

  // Page Control (Two-way binding with viewer)
  currentPage = 1; // <--- NEW: Tracks current page

  ngOnInit() {
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

  // --- External API for Shell ---

  /**
   * Called by ReaderShell when clicking a note in the sidebar
   */
  goToLocation(rangeJson: string) {
    try {
      const range = JSON.parse(rangeJson);
      if (range.pageNumber) {
        this.currentPage = range.pageNumber; // <--- Triggers viewer to scroll
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

  /**
   * Listen for text selection (MouseUp) to auto-save highlights.
   * Bound in the HTML template.
   */
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
          // 1. Add visual highlight immediately
          this.savedHighlights.push({
            id: newNote.id,
            pageNumber: selection.pageNumber,
            rects: selection.rects,
          });

          // 2. Notify Shell to update sidebar
          this.noteCreated.emit();
        },
      });
  }
  handleError(error: any) {
    console.error('PDF Viewer Error:', error);
  }
}
