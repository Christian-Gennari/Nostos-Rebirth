import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import {
  AssistantCaptureResult,
  AssistantCaptureService,
  QUOTE_FIDELITY_NOTE,
} from './assistant-capture.service';
import { Note } from '../../core/dtos/note.dtos';

const savedNote: Note = {
  id: 'n1',
  bookId: 'b1',
  content: 'A thought',
  createdAt: '2026-01-01T00:00:00Z',
};

describe('AssistantCaptureService', () => {
  let service: AssistantCaptureService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AssistantCaptureService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('attaches an app-known anchor and marks it verified', () => {
    let result: AssistantCaptureResult | undefined;
    service
      .capture({
        bookId: 'b1',
        text: 'A thought',
        anchor: { kind: 'pdf_page', value: '183', verified: true },
      })
      .subscribe((value) => (result = value));

    const request = http.expectOne('/api/books/b1/notes');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      content: 'A thought',
      rawContent: 'A thought',
      captureSource: 'text',
      processingMode: 'verbatim',
      sourceAnchorKind: 'pdf_page',
      sourceAnchorValue: '183',
      anchorVerified: true,
    });

    request.flush(savedNote);
    expect(result).toEqual({
      note: savedNote,
      anchorKind: 'pdf_page',
      anchorValue: '183',
      verified: true,
    });
  });

  it('carries an EPUB CFI in cfiRange as well as the anchor columns', () => {
    service
      .capture({
        bookId: 'b1',
        text: 'A thought',
        anchor: { kind: 'epub_cfi', value: 'epubcfi(/6/4!/2/2)', verified: true },
      })
      .subscribe();

    const request = http.expectOne('/api/books/b1/notes');
    expect(request.request.body.cfiRange).toBe('epubcfi(/6/4!/2/2)');
    expect(request.request.body.sourceAnchorKind).toBe('epub_cfi');
    expect(request.request.body.sourceAnchorValue).toBe('epubcfi(/6/4!/2/2)');
    request.flush(savedNote);
  });

  it('still saves when the anchor is unknown — a thought is never lost', () => {
    service.capture({ bookId: 'b1', text: 'A thought' }).subscribe();

    const request = http.expectOne('/api/books/b1/notes');
    expect(request.request.body.sourceAnchorKind).toBe('unknown');
    expect(request.request.body.sourceAnchorValue).toBeNull();
    expect(request.request.body.anchorVerified).toBe(false);
    request.flush(savedNote);
  });

  it('marks a hand-typed quote and appends the fidelity note', () => {
    service
      .capture({
        bookId: 'b1',
        text: 'The snow was general all over Ireland.',
        selectedText: 'The snow was general all over Ireland.',
        anchor: { kind: 'physical_page', value: '42', verified: false },
      })
      .subscribe();

    const request = http.expectOne('/api/books/b1/notes');
    expect(request.request.body.anchorVerified).toBe(false);
    expect(request.request.body.content).toContain(QUOTE_FIDELITY_NOTE);
    expect(request.request.body.selectedText).toBe('The snow was general all over Ireland.');
    request.flush(savedNote);
  });

  it('does not add the fidelity note to a passage the app read itself', () => {
    service
      .capture({
        bookId: 'b1',
        text: 'The snow was general all over Ireland.',
        selectedText: 'The snow was general all over Ireland.',
        anchor: { kind: 'epub_cfi', value: 'epubcfi(/6/4!/2/2)', verified: true },
      })
      .subscribe();

    const request = http.expectOne('/api/books/b1/notes');
    expect(request.request.body.content).toBe('The snow was general all over Ireland.');
    expect(request.request.body.content).not.toContain(QUOTE_FIDELITY_NOTE);
    request.flush(savedNote);
  });
});
