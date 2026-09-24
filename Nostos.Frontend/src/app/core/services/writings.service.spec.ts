import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { WritingsService } from './writings.service';
import { WritingSourceDto } from '../dtos/writing.dtos';

describe('WritingsService (kept sources)', () => {
  let service: WritingsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [WritingsService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(WritingsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('lists kept sources for a writing', () => {
    const mockSources: WritingSourceDto[] = [
      {
        id: 'note-1',
        bookId: 'book-1',
        bookTitle: 'Book One',
        content: 'Content 1',
        createdAt: '2026-09-01T00:00:00Z',
        addedAt: '2026-09-02T00:00:00Z',
        sourceAnchorKind: 'epub_cfi',
        anchorVerified: true,
      },
    ];

    service.listSources('writing-1').subscribe((sources) => {
      expect(sources).toEqual(mockSources);
    });

    const req = httpMock.expectOne('/api/writings/writing-1/notes');
    expect(req.request.method).toBe('GET');
    req.flush(mockSources);
  });

  it('adds a kept source to a writing', () => {
    const mockSource: WritingSourceDto = {
      id: 'note-2',
      bookId: 'book-2',
      content: 'Content 2',
      createdAt: '2026-09-01T00:00:00Z',
      addedAt: '2026-09-02T00:00:00Z',
      sourceAnchorKind: 'pdf_page',
      anchorVerified: false,
    };

    service.addSource('writing-1', 'note-2').subscribe((source) => {
      expect(source).toEqual(mockSource);
    });

    const req = httpMock.expectOne('/api/writings/writing-1/notes');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ noteId: 'note-2' });
    req.flush(mockSource);
  });

  it('removes a kept source from a writing', () => {
    service.removeSource('writing-1', 'note-2').subscribe();

    const req = httpMock.expectOne('/api/writings/writing-1/notes/note-2');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });
});
