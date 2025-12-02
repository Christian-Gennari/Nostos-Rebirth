import { Component, input, computed, inject, OnInit } from '@angular/core';
import { NgxExtendedPdfViewerModule, TextLayerRenderedEvent } from 'ngx-extended-pdf-viewer';
import { PdfAnnotationManager, PageHighlight } from './pdf-annotation-manager';
import { NotesService } from '../../services/notes.services';
import { Note } from '../../dtos/note.dtos';

@Component({
  selector: 'app-pdf-reader',
  standalone: true,
  imports: [NgxExtendedPdfViewerModule],
  templateUrl: './pdf-reader.html',
  styleUrl: './pdf-reader.css',
})
export class PdfReader implements OnInit {
  // Services
  private highlightService = inject(PdfAnnotationManager);
  private notesService = inject(NotesService);

  // Inputs
  bookId = input.required<string>();

  // State
  pdfSrc = computed(() => `/api/books/${this.bookId()}/file`);
  savedHighlights: PageHighlight[] = [];

  ngOnInit() {
    this.loadNotes();
  }

  loadNotes() {
    //
    this.notesService.list(this.bookId()).subscribe({
      next: (notes) => {
        // Map backend Notes to frontend PageHighlights
        this.savedHighlights = notes
          .filter((n) => n.cfiRange) // Only process notes with range data
          .map((n) => {
            try {
              // Parse the stored JSON string back into coordinates
              //
              const range = JSON.parse(n.cfiRange!);
              return {
                id: n.id,
                pageNumber: range.pageNumber,
                rects: range.rects,
              } as PageHighlight;
            } catch (e) {
              console.warn('Failed to parse range for note:', n.id);
              return null;
            }
          })
          .filter((h) => h !== null) as PageHighlight[];
      },
      error: (err) => console.error('Error loading notes:', err),
    });
  }

  onPdfLoaded() {
    console.log('PDF Loaded');
  }

  /**
   * Fires every time a page is rendered (scrolling or zooming).
   * We use this to repaint our custom highlight layer.
   */
  onTextLayerRendered(event: TextLayerRenderedEvent) {
    const pageNumber = event.pageNumber;

    // Access the specific text layer div for this page
    const textLayerDiv = event.source.textLayer?.div;

    if (!textLayerDiv) return;

    // Find highlights that belong to this page
    const pageHighlights = this.savedHighlights.filter((h) => h.pageNumber === pageNumber);

    // Paint them
    this.highlightService.paint(textLayerDiv, pageHighlights);
  }

  /**
   * Call this method when the user clicks a "Highlight" button
   * (You can bind this to a temporary button in HTML or a context menu)
   */
  createHighlight() {
    const selection = this.highlightService.captureSelection();
    if (!selection) return;

    // 1. Prepare the JSON payload for the database
    const rangeData = {
      pageNumber: selection.pageNumber,
      rects: selection.rects,
    };

    // 2. Send to Backend
    this.notesService
      .create(this.bookId(), {
        content: '', // Empty content = just a highlight
        selectedText: selection.text,
        cfiRange: JSON.stringify(rangeData), // Store coordinates as JSON string
      })
      .subscribe({
        next: (newNote) => {
          console.log('Highlight saved:', newNote);

          // 3. Optimistically update the UI so we see it immediately
          this.savedHighlights.push({
            id: newNote.id,
            pageNumber: selection.pageNumber,
            rects: selection.rects,
          });

          // (Optional) Trigger a repaint if you want instant feedback without scrolling
          // But usually, the user moves on, and it paints on next render.
        },
        error: (err) => console.error('Failed to save highlight', err),
      });
  }

  handleError(error: any) {
    console.error('PDF Viewer Error:', error);
  }
}
