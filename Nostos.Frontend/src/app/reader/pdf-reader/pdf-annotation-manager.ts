import { Injectable } from '@angular/core';

export interface HighlightRect {
  left: number; // Percentage (0-1)
  top: number; // Percentage (0-1)
  width: number; // Percentage (0-1)
  height: number; // Percentage (0-1)
}

export interface PageHighlight {
  pageNumber: number;
  rects: HighlightRect[];
  id?: string; // Optional: to link back to a note ID
}

@Injectable({
  providedIn: 'root',
})
export class PdfAnnotationManager {
  /**
   * Creates a transparent overlay layer on top of the text layer
   * and paints the provided highlights into it.
   */
  paint(textLayerDiv: HTMLElement, highlights: PageHighlight[]) {
    let highlightLayer = textLayerDiv.querySelector('.custom-highlight-layer') as HTMLElement;

    if (!highlightLayer) {
      highlightLayer = document.createElement('div');
      highlightLayer.className = 'custom-highlight-layer';
      textLayerDiv.appendChild(highlightLayer);
    } else {
      highlightLayer.innerHTML = '';
    }

    highlights.forEach((h) => {
      h.rects.forEach((rect) => {
        const div = document.createElement('div');
        div.className = 'highlight-box';
        div.style.left = `${rect.left * 100}%`;
        div.style.top = `${rect.top * 100}%`;
        div.style.width = `${rect.width * 100}%`;
        div.style.height = `${rect.height * 100}%`;
        highlightLayer.appendChild(div);
      });
    });
  }

  /**
   * Capture a text highlight (selected text + highlight rectangles).
   * Returns null if no valid text was selected.
   * Mirrors EPUB highlight behavior.
   */
  captureHighlight(): {
    pageNumber: number;
    rects: HighlightRect[];
    selectedText: string;
  } | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const selectedText = selection.toString().trim();
    if (!selectedText) return null;

    const textLayer = this.getClosestTextLayer(range.startContainer);
    if (!textLayer) return null;

    const pageNumber = this.getPageNumberFromLayer(textLayer);
    if (!pageNumber) return null;

    const pageRect = textLayer.getBoundingClientRect();
    const rects = Array.from(range.getClientRects()).map((r) => ({
      left: (r.left - pageRect.left) / pageRect.width,
      top: (r.top - pageRect.top) / pageRect.height,
      width: r.width / pageRect.width,
      height: r.height / pageRect.height,
    }));

    return {
      pageNumber,
      rects,
      selectedText,
    };
  }

  /**
   * Capture a note location even when NO TEXT is selected.
   * Returns a stable pageNumber + Y-position (percent).
   * Mirrors EPUB behavior of always providing a cfiRange.
   */
  captureNoteLocation(): {
    pageNumber: number;
    yPercent: number;
  } | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);

    const textLayer = this.getClosestTextLayer(range.startContainer);
    if (!textLayer) return null;

    const pageNumber = this.getPageNumberFromLayer(textLayer);
    if (!pageNumber) return null;

    const pageRect = textLayer.getBoundingClientRect();
    const rect = range.getBoundingClientRect();

    const yPercent = (rect.top - pageRect.top) / pageRect.height;

    return {
      pageNumber,
      yPercent,
    };
  }

  // -----------------------------------------------------------
  // Helper functions
  // -----------------------------------------------------------

  private getClosestTextLayer(node: Node): HTMLElement | null {
    let current: Node | null = node;
    while (current) {
      if (current instanceof Element && current.classList.contains('textLayer')) {
        return current as HTMLElement;
      }
      current = current.parentNode;
    }
    return null;
  }

  private getPageNumberFromLayer(textLayer: HTMLElement): number | null {
    const pageDiv = textLayer.closest('.page');
    if (pageDiv && pageDiv.hasAttribute('data-page-number')) {
      return parseInt(pageDiv.getAttribute('data-page-number')!, 10);
    }
    return null;
  }
}
