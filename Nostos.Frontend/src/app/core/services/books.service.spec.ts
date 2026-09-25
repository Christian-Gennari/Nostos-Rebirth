import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { BookLookupError, BooksService } from './books.service';

describe('BooksService — ISBN lookup', () => {
  let service: BooksService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(BooksService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it.each([
    [400, 'Bad Request', 'invalid-isbn'],
    [404, 'Not Found', 'not-found'],
    [503, 'Service Unavailable', 'unavailable'],
  ] as const)('maps HTTP %s to %s lookup errors', (status, statusText, expectedReason) => {
    let seen: unknown;

    service.lookup('9780141183848').subscribe({
      error: (error) => {
        seen = error;
      },
    });

    const request = http.expectOne('/api/books/lookup/9780141183848');
    expect(request.request.method).toBe('GET');
    request.flush(
      { code: 'test_error' },
      {
        status,
        statusText,
      },
    );

    expect(seen).toBeInstanceOf(BookLookupError);
    expect((seen as BookLookupError).reason).toBe(expectedReason);
    expect((seen as BookLookupError).status).toBe(status);
  });
});
