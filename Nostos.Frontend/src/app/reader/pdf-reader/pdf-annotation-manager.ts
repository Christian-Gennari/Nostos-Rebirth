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
    // 1. Check if our custom layer already exists; if so, clear it.
    let highlightLayer = textLayerDiv.querySelector('.custom-highlight-layer') as HTMLElement;

    if (!highlightLayer) {
      highlightLayer = document.createElement('div');
      highlightLayer.className = 'custom-highlight-layer';
      // Insert it before the text content so it doesn't block text selection
      textLayerDiv.appendChild(highlightLayer);
    } else {
      highlightLayer.innerHTML = '';
    }

    // 2. Render each highlight box
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
   * Captures the current user selection and converts it to
   * page-relative coordinates (percentages).
   */
  captureSelection(): { pageNumber: number; rects: HighlightRect[]; text: string } | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const selectedText = selection.toString().trim();
    if (!selectedText) return null;

    // Find the PDF page container that holds this selection
    const textLayer = this.getClosestTextLayer(range.startContainer);
    if (!textLayer) return null;

    // Get the page number from the DOM attribute (ngx-extended-pdf-viewer standard)
    // The textLayer usually has a sibling or parent with `data-page-number`
    const pageNumber = this.getPageNumberFromLayer(textLayer);
    if (!pageNumber) return null;

    // Calculate rectangles relative to the page dimensions
    const pageRect = textLayer.getBoundingClientRect();
    const clientRects = Array.from(range.getClientRects());

    const rects: HighlightRect[] = clientRects.map((r) => ({
      left: (r.left - pageRect.left) / pageRect.width,
      top: (r.top - pageRect.top) / pageRect.height,
      width: r.width / pageRect.width,
      height: r.height / pageRect.height,
    }));

    return {
      pageNumber,
      rects,
      text: selectedText,
    };
  }

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
    // ngx-extended-pdf-viewer structure: .page[data-page-number] > .textLayer
    // Or sometimes the textLayer itself has the data.
    // We check the parent element which is usually the ".page" div.
    const pageDiv = textLayer.closest('.page');
    if (pageDiv && pageDiv.hasAttribute('data-page-number')) {
      return parseInt(pageDiv.getAttribute('data-page-number')!, 10);
    }
    return null;
  }
}
