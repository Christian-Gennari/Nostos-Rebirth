// Nostos.Frontend/src/app/reader/epub-reader/epub-annotation-manager.ts
import { Rendition } from 'epubjs';
import { signal, Injector } from '@angular/core';
import { NotesService } from '../../core/services/notes.service';
import { Note } from '../../core/dtos/note.dtos';

interface PendingEpubHighlight {
  cfiRange: string;
  selectedText: string;
}

export class EpubAnnotationManager {
  public highlights = signal<string[]>([]);

  private notesService: NotesService;

  private highlightMode = false;
  private pendingHighlight: PendingEpubHighlight | null = null;
  private pendingContents: any = null;
  private onSelectionCaptured?: (text: string) => void;

  constructor(
    private rendition: Rendition,
    private bookId: string,
    private injector: Injector,
    private onNoteCreated?: () => void,
    private onCommitFailed?: () => void,
  ) {
    this.notesService = this.injector.get(NotesService);
  }

  setHighlightMode(enabled: boolean) {
    this.highlightMode = enabled;
  }

  setOnSelectionCaptured(callback: (text: string) => void) {
    this.onSelectionCaptured = callback;
  }

  public init() {
    this.rendition.on('selected', (cfiRange: string, contents: any) => {
      this.handleSelection(cfiRange, contents);
    });
  }

  public injectHighlightStyles(contents: any) {
    const style = contents.document.createElement('style');
    style.innerHTML = `
      .epubjs-hl {
        fill: yellow;
        fill-opacity: 0.3;
        mix-blend-mode: multiply;
      }
    `;
    contents.document.head.appendChild(style);
  }

  private handleSelection(cfiRange: string, contents: any) {
    if (!this.highlightMode || !cfiRange) return;

    const range = this.rendition.getRange(cfiRange);
    const selectedText = range ? range.toString().trim() : '';
    if (!selectedText) return;

    this.pendingHighlight = { cfiRange, selectedText };
    this.pendingContents = contents;
    this.onSelectionCaptured?.(selectedText);
  }

  commitHighlight() {
    if (!this.pendingHighlight) return;

    const p = this.pendingHighlight;

    this.rendition.annotations.add('highlight', p.cfiRange);

    if (this.pendingContents) {
      const selection = this.pendingContents.window.getSelection();
      if (selection) selection.removeAllRanges();
    }

    this.notesService
      .create(this.bookId, {
        content: '',
        cfiRange: p.cfiRange,
        selectedText: p.selectedText,
      })
      .subscribe({
        next: (note) => {
          this.highlights.update((current) => [...current, p.cfiRange]);
          this.pendingHighlight = null;
          this.pendingContents = null;
          if (this.onNoteCreated) this.onNoteCreated();
        },
        error: () => {
          this.rendition.annotations.remove(p.cfiRange, 'highlight');
          this.pendingHighlight = null;
          this.pendingContents = null;
          this.onCommitFailed?.();
        },
      });
  }

  discardHighlight() {
    if (!this.pendingHighlight) return;

    if (this.pendingContents) {
      const selection = this.pendingContents.window.getSelection();
      if (selection) selection.removeAllRanges();
    }

    this.pendingHighlight = null;
    this.pendingContents = null;
  }

  public restoreHighlights(notes: Note[]) {
    notes.forEach((note) => {
      if (note.cfiRange) {
        this.rendition.annotations.add('highlight', note.cfiRange);
        this.highlights.update((current) => [...current, note.cfiRange!]);
      }
    });
  }

  public removeHighlight(cfiRange: string) {
    this.rendition.annotations.remove(cfiRange, 'highlight');
    this.highlights.update((current) => current.filter((cfi) => cfi !== cfiRange));
  }
}