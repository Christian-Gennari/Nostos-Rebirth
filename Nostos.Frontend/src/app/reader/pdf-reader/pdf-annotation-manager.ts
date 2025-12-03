import { Injectable } from '@angular/core';

export interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PageHighlight {
  pageNumber: number;
  rects: HighlightRect[];
  id?: string;
}

@Injectable({
  providedIn: 'root',
})
export class PdfAnnotationManager {
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
      // --- NEW: Create a group container for this specific note ---
      const group = document.createElement('div');
      group.className = 'highlight-group';

      // We can attach the ID here for easier lookup later
      if (h.id) group.setAttribute('data-note-id', h.id);

      h.rects.forEach((rect) => {
        const div = document.createElement('div');
        div.className = 'highlight-box';
        div.style.left = `${rect.left * 100}%`;
        div.style.top = `${rect.top * 100}%`;
        div.style.width = `${rect.width * 100}%`;
        div.style.height = `${rect.height * 100}%`;
        group.appendChild(div);
      });

      highlightLayer.appendChild(group);
    });
  }

  // ... (Keep the captureHighlight and captureNoteLocation methods exactly as they were before) ...
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

    selection.removeAllRanges();

    return {
      pageNumber,
      rects,
      selectedText,
    };
  }

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

    return { pageNumber, yPercent };
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
    const pageDiv = textLayer.closest('.page');
    if (pageDiv && pageDiv.hasAttribute('data-page-number')) {
      return parseInt(pageDiv.getAttribute('data-page-number')!, 10);
    }
    return null;
  }
}
