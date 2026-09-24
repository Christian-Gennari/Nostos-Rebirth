import { TestBed } from '@angular/core/testing';

import { PdfAnnotationManager } from './pdf-annotation-manager';

describe('PdfAnnotationManager #478 cross-page provenance', () => {
  it('rejects a cross-page selection instead of persisting one-page geometry', () => {
    const service = TestBed.inject(PdfAnnotationManager);
    const host = document.createElement('div');

    const page1 = document.createElement('div');
    page1.className = 'page';
    page1.setAttribute('data-page-number', '4');
    const layer1 = document.createElement('div');
    layer1.className = 'textLayer';
    const start = document.createTextNode('start');
    layer1.appendChild(start);
    page1.appendChild(layer1);

    const page2 = document.createElement('div');
    page2.className = 'page';
    page2.setAttribute('data-page-number', '5');
    const layer2 = document.createElement('div');
    layer2.className = 'textLayer';
    const end = document.createTextNode('end');
    layer2.appendChild(end);
    page2.appendChild(layer2);

    host.append(page1, page2);
    document.body.appendChild(host);

    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, end.textContent?.length ?? 0);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    try {
      const capture = service.captureHighlight(true);
      expect(capture?.status).toBe('cross-page');
    } finally {
      selection.removeAllRanges();
      host.remove();
    }
  });
});
