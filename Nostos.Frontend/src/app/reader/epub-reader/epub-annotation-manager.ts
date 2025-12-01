// Nostos.Frontend/src/app/reader/epub-reader/epub-annotation-manager.ts
import { Rendition } from 'epubjs';
import { signal, Injector } from '@angular/core';
import { NotesService } from '../../services/notes.services';
import { Note } from '../../dtos/note.dtos';

export class EpubAnnotationManager {
  // Signal to track saved highlights (CFI strings)
  public highlights = signal<string[]>([]);

  private notesService: NotesService;

  constructor(
    private rendition: Rendition,
    private bookId: string, // <--- NEW: Required to link note to book
    private injector: Injector // <--- NEW: Allows using Service inside a helper class
  ) {
    // Manually inject the service since we are outside an Angular Component
    this.notesService = this.injector.get(NotesService);
  }

  /**
   * Initialize listeners for selection events.
   * Works for both Mouse (PC) and Touch (Mobile).
   */
  public init() {
    this.rendition.on('selected', (cfiRange: string, contents: any) => {
      this.handleSelection(cfiRange, contents);
    });
  }

  /**
   * Inject necessary CSS for highlights into the EPUB iframe.
   * Call this inside the rendition.hooks.content.register hook.
   */
  public injectHighlightStyles(contents: any) {
    const style = contents.document.createElement('style');
    style.innerHTML = `
      /* Custom Highlight Style (Yellow Marker) */
      .epubjs-hl {
        fill: yellow;
        fill-opacity: 0.3;
        mix-blend-mode: multiply;
      }

      /* Mobile/PC Native Selection Color (Match the highlight) */
      ::selection {
        background: rgba(255, 255, 0, 0.3);
      }
    `;
    contents.document.head.appendChild(style);
  }

  /**
   * Core logic when text is selected.
   */
  private handleSelection(cfiRange: string, contents: any) {
    console.log('Selection detected:', cfiRange);

    // 1. Extract the selected text using the CFI
    const range = this.rendition.getRange(cfiRange);
    const selectedText = range ? range.toString() : '';

    // 2. Visually add the highlight immediately (Optimistic UI)
    this.rendition.annotations.add('highlight', cfiRange);

    // 3. Clear the native browser selection
    const selection = contents.window.getSelection();
    selection?.removeAllRanges();

    // 4. Save to Backend
    this.notesService
      .create(this.bookId, {
        content: '', // User can add a comment later
        cfiRange: cfiRange,
        selectedText: selectedText,
      })
      .subscribe({
        next: (note) => {
          console.log('Highlight saved to DB:', note.id);
          this.highlights.update((current) => [...current, cfiRange]);
        },
        error: (err) => {
          console.error('Failed to save highlight:', err);
          // Rollback: Remove the highlight if the save failed
          this.rendition.annotations.remove(cfiRange, 'highlight');
        },
      });
  }

  /**
   * Restore previously saved highlights from the backend
   * Accepts Note[] objects (which contain the cfiRange)
   */
  public restoreHighlights(notes: Note[]) {
    notes.forEach((note) => {
      if (note.cfiRange) {
        this.rendition.annotations.add('highlight', note.cfiRange);
        this.highlights.update((current) => [...current, note.cfiRange!]);
      }
    });
  }
}
