// Nostos.Frontend/src/app/reader/epub-reader/epub-annotation-manager.ts
import { Rendition, Contents } from 'epubjs';
import { signal, Injector } from '@angular/core';
import { NotesService } from '../../core/services/notes.service';
import { Note } from '../../core/dtos/note.dtos';

interface PendingEpubHighlight {
  cfiRange: string;
  selectedText: string;
  contents: Contents;
  temporaryAnnotation?: PendingHighlightAnnotation;
}

/**
 * Shape of the annotation object returned at runtime by epub.js
 * `rendition.annotations.highlight(...)`. The bundled 0.3.93 typings declare
 * that method as `void`, so the returned object is carried as this local
 * shape and removed by object identity (never by re-derived cfiRange).
 */
interface PendingHighlightAnnotation {
  type: string;
  cfiRange: string;
  sectionIndex?: number;
  mark?: { element?: HTMLElement };
}

export class EpubAnnotationManager {
  public highlights = signal<string[]>([]);

  private notesService: NotesService;

  private highlightMode = false;
  private pendingHighlight: PendingEpubHighlight | null = null;
  private lastCapturedKey: string | null = null;
  private readonly documentCleanups = new Map<Document, () => void>();
  private selectedHandler: ((cfiRange: string, contents: Contents) => void) | null = null;
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

  setHighlightMode(enabled: boolean): void {
    this.highlightMode = enabled;

    const contents = this.rendition.getContents() as unknown as Contents[];
    for (const item of contents) {
      this.applyModeToContents(item);
    }

    if (!enabled) {
      this.discardHighlight();
    }
  }

  setOnSelectionCaptured(callback: (text: string) => void) {
    this.onSelectionCaptured = callback;
  }

  public init() {
    this.selectedHandler = (cfiRange: string, contents: Contents) =>
      this.handleSelected(cfiRange, contents);
    this.rendition.on('selected', this.selectedHandler);
  }

  /**
   * Wires one epub.js Contents document: injects styles, registers the
   * mode-scoped callout suppression and early selection capture listeners,
   * and applies the current highlight mode. Registered through
   * `rendition.hooks.content` so every newly rendered document is covered.
   */
  public registerContents(contents: Contents): void {
    this.injectHighlightStyles(contents);

    const document = contents.document;
    if (this.documentCleanups.has(document)) {
      this.applyModeToContents(contents);
      return;
    }

    const onContextMenu = (event: Event) => {
      if (this.highlightMode) {
        event.preventDefault();
      }
    };

    const captureSelection = () => {
      if (!this.highlightMode || this.pendingHighlight) {
        return;
      }

      const selection = contents.window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return;
      }

      const range = selection.getRangeAt(0);
      const selectedText = selection.toString().trim();

      if (!selectedText) {
        return;
      }

      const cfiRange = contents.cfiFromRange(range.cloneRange());
      this.capturePendingHighlight(cfiRange, selectedText, contents);
    };

    const onSelectionChange = () => {
      queueMicrotask(captureSelection);
    };

    const onTouchEnd = () => {
      requestAnimationFrame(captureSelection);
    };

    document.addEventListener('contextmenu', onContextMenu, {
      capture: true,
    });
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('touchend', onTouchEnd, {
      passive: true,
    });

    this.documentCleanups.set(document, () => {
      document.removeEventListener('contextmenu', onContextMenu, true);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('touchend', onTouchEnd);
    });

    this.applyModeToContents(contents);
  }

  public injectHighlightStyles(contents: Contents) {
    const style = contents.document.createElement('style');
    style.innerHTML = `
      .epubjs-hl {
        fill: yellow;
        fill-opacity: 0.3;
        mix-blend-mode: multiply;
      }
      body.nostos-highlight-mode,
      body.nostos-highlight-mode * {
        -webkit-touch-callout: none !important;
        -webkit-user-select: text !important;
        user-select: text !important;
      }
      .epubjs-hl-pending {
        fill: var(--highlight-color, #facc15);
        fill-opacity: 0.38;
        mix-blend-mode: multiply;
      }
    `;
    contents.document.head.appendChild(style);
  }

  /**
   * Standard epub.js path: `rendition.on('selected')`. Routes into the same
   * capture/deduplication pipeline as the iframe-level fallback.
   */
  private handleSelected(cfiRange: string, contents: Contents): void {
    if (!this.highlightMode) {
      return;
    }

    const text = contents.window.getSelection()?.toString().trim() ?? '';
    if (!text) {
      return;
    }

    this.capturePendingHighlight(cfiRange, text, contents);
  }

  /**
   * Central capture: derives the temporary annotation, stores the pending
   * highlight, clears the native selection and reports the capture.
   * Deduplicated against `pendingHighlight` and the last captured key so the
   * iframe fallback and epub.js `selected` never double-fire.
   */
  private capturePendingHighlight(
    cfiRange: string,
    selectedText: string,
    contents: Contents,
  ): void {
    const key = `${cfiRange}\u0000${selectedText}`;

    if (this.pendingHighlight || this.lastCapturedKey === key) {
      return;
    }

    const temporaryAnnotation = this.rendition.annotations.highlight(
      cfiRange,
      { nostosPending: true },
      undefined,
      'epubjs-hl-pending',
    ) as unknown as PendingHighlightAnnotation;

    this.pendingHighlight = {
      cfiRange,
      selectedText,
      contents,
      temporaryAnnotation,
    };
    this.lastCapturedKey = key;

    contents.window.getSelection()?.removeAllRanges();
    this.onSelectionCaptured?.(selectedText);
  }

  /**
   * Persists the note first; only on success swaps the temporary annotation
   * for the normal persisted one and reports success. On failure the pending
   * highlight and its temporary annotation are retained so the shell can keep
   * the confirmation bar open — the user never loses a difficult selection to
   * a transient request failure.
   */
  commitHighlight(): Promise<boolean> {
    const pending = this.pendingHighlight;
    if (!pending) {
      return Promise.resolve(false);
    }

    const snapshot: PendingEpubHighlight = {
      cfiRange: pending.cfiRange,
      selectedText: pending.selectedText,
      contents: pending.contents,
      temporaryAnnotation: pending.temporaryAnnotation,
    };

    return new Promise<boolean>((resolve) => {
      this.notesService
        .create(this.bookId, {
          content: '',
          cfiRange: snapshot.cfiRange,
          selectedText: snapshot.selectedText,
        })
        .subscribe({
          next: () => {
            // Persisted: swap the temporary annotation for the permanent one,
            // then report success so the shell closes the bar.
            this.rendition.annotations.add('highlight', snapshot.cfiRange);
            this.removeAnnotation(snapshot.temporaryAnnotation);
            this.pendingHighlight = null;
            this.lastCapturedKey = null;
            this.highlights.update((current) => [...current, snapshot.cfiRange]);
            this.onNoteCreated?.();
            resolve(true);
          },
          error: () => {
            // Failed: keep the pending highlight and its visual feedback.
            if (this.pendingHighlight?.cfiRange !== snapshot.cfiRange) {
              this.pendingHighlight = null;
              this.lastCapturedKey = null;
            }
            this.onCommitFailed?.();
            resolve(false);
          },
        });
    });
  }

  discardHighlight(): void {
    this.removePendingAnnotation();
    this.pendingHighlight?.contents.window.getSelection()?.removeAllRanges();
    this.pendingHighlight = null;
    this.lastCapturedKey = null;
  }

  private removePendingAnnotation(): void {
    this.removeAnnotation(this.pendingHighlight?.temporaryAnnotation);
  }

  /**
   * Removes the temporary annotation by object identity (its mark element on
   * the matching view's pane), never by cfiRange: `annotations.remove(cfi,
   * 'highlight')` is keyed by cfiRange and could remove a persisted annotation
   * at the same CFI.
   */
  private removeAnnotation(annotation?: PendingHighlightAnnotation): void {
    if (!annotation) {
      return;
    }

    const views = this.rendition.views() as unknown as ReadonlyArray<{
      index?: number;
      pane?: { removeMark?: (mark: unknown) => void };
    }>;

    for (const view of views) {
      if (view.index !== annotation.sectionIndex) {
        continue;
      }
      const mark = annotation.mark;
      if (mark && typeof view.pane?.removeMark === 'function') {
        view.pane.removeMark(mark);
      }
    }

    annotation.mark = undefined;
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

  /**
   * Removes document listeners, the rendition `selected` listener and any
   * pending temporary annotation. Called before the rendition is destroyed.
   */
  public destroy(): void {
    this.discardHighlight();

    if (this.selectedHandler) {
      this.rendition.off('selected', this.selectedHandler);
      this.selectedHandler = null;
    }

    for (const cleanup of this.documentCleanups.values()) {
      cleanup();
    }
    this.documentCleanups.clear();
  }

  private applyModeToContents(contents: Contents): void {
    contents.document.body?.classList.toggle('nostos-highlight-mode', this.highlightMode);
  }
}
