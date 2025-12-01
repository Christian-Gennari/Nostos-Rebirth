// Nostos.Frontend/src/app/reader/epub-reader/epub-annotation-manager.ts
import { Rendition } from 'epubjs';
import { signal } from '@angular/core';

export class EpubAnnotationManager {
  // Signal to track saved highlights (CFI strings)
  public highlights = signal<string[]>([]);

  constructor(private rendition: Rendition) {}

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

    // 1. Visually add the highlight to the book
    // 'highlight' is the default annotation type in epub.js
    this.rendition.annotations.add('highlight', cfiRange, {}, (e: any) => {
      console.log('Highlight clicked', e);
    });

    // 2. Clear the native browser selection (blue box)
    // This is crucial for Mobile to prevent the native context menu from interfering
    const selection = contents.window.getSelection();
    selection?.removeAllRanges();

    // 3. Update state (to be saved to backend later)
    this.highlights.update((current) => [...current, cfiRange]);
  }

  /**
   * Restore previously saved highlights from the backend
   */
  public restoreHighlights(savedCfis: string[]) {
    savedCfis.forEach((cfi) => {
      this.rendition.annotations.add('highlight', cfi);
      this.highlights.update((current) => [...current, cfi]);
    });
  }
}
