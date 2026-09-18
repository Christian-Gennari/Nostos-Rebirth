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

/**
 * `rendition.views()` returns epub.js's `Views` *collection*, not an array: it
 * exposes `all()`, `forEach()` and `get()`, and it is NOT iterable. Iterating
 * it with `for…of` throws `TypeError: views is not iterable` at runtime — and
 * because the spec stubbed it with a plain array, the suite stayed green while
 * every highlight save failed in the browser (issue #225 §1.1). `all()` is the
 * collection's own array accessor.
 */
interface EpubViews {
  all?: () => EpubView[];
}

interface EpubView {
  index?: number;
  pane?: { removeMark?: (mark: unknown) => void };
}

/**
 * `--color-highlight` from styles.css in its light rendering, used when the
 * token cannot be resolved (unit tests, or a document that is not yet styled).
 */
const DEFAULT_HIGHLIGHT_FILL = '#ffda00';

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
    // Only the selection-mode rules belong here. The `.epubjs-hl*` fill rules
    // that used to live in this block were DEAD CODE: epub.js builds the
    // highlight marks in a pane SVG it appends to the view element in the
    // PARENT document (`new Pane(this.iframe, this.element)`), never inside
    // this contents document. The colour is therefore passed to epub.js as an
    // explicit fill — see highlightFill() — instead of being styled here.
    const style = contents.document.createElement('style');
    style.innerHTML = `
      body.nostos-highlight-mode,
      body.nostos-highlight-mode * {
        -webkit-touch-callout: none !important;
        -webkit-user-select: text !important;
        user-select: text !important;
      }
    `;
    contents.document.head.appendChild(style);
  }

  /**
   * The highlight colour, read from the app's `--color-highlight` token.
   * epub.js defaults the SVG fill to the raw keyword `yellow`, which could not
   * follow the theme and disagreed with the PDF reader's
   * `var(--color-highlight)`. The pane SVG is in the parent document (see
   * injectHighlightStyles), where the token is readable, so it is resolved here
   * and handed to epub.js as an explicit fill.
   */
  private highlightFill(): string {
    try {
      const value = getComputedStyle(document.documentElement)
        .getPropertyValue('--color-highlight')
        .trim();
      if (value) return value;
    } catch {
      // No parent document (unit tests) or unreadable styles — use the token's
      // light value rather than epub.js's keyword.
    }
    return DEFAULT_HIGHLIGHT_FILL;
  }

  /** Adds a persisted highlight with the reader's own colour. */
  private addPersistedHighlight(cfiRange: string): void {
    this.rendition.annotations.add('highlight', cfiRange, {}, undefined, undefined, {
      fill: this.highlightFill(),
    });
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
      { fill: this.highlightFill() },
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
            this.addPersistedHighlight(snapshot.cfiRange);
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

    // `all()` is the collection's array accessor; the collection itself is not
    // iterable, which is what broke every committed highlight (see EpubViews).
    const views = this.rendition.views() as unknown as EpubViews;
    const rendered = typeof views.all === 'function' ? views.all() : [];

    for (const view of rendered) {
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
        this.addPersistedHighlight(note.cfiRange);
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
