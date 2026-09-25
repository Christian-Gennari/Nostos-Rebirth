import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { ProvidersService } from './providers.service';

describe('ProvidersService — unified discovery', () => {
  let service: ProvidersService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(ProvidersService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('searches all providers without sending a kind', () => {
    service.searchAll('pride').subscribe();

    const request = http.expectOne(
      (candidate) =>
        candidate.url === '/api/providers/search' &&
        candidate.params.get('query') === 'pride' &&
        candidate.params.get('limit') === '20',
    );

    expect(request.request.method).toBe('GET');
    expect(request.request.params.has('kind')).toBe(false);
    request.flush({ items: [], hasMore: false, sources: [] });
  });

  it('sends ebook and audiobook as aggregate kind filters', () => {
    service.searchAll('pride', 'ebook', 12).subscribe();

    const ebook = http.expectOne('/api/providers/search?query=pride&limit=12&kind=ebook');
    expect(ebook.request.method).toBe('GET');
    ebook.flush({ items: [], hasMore: false, sources: [] });

    service.searchAll('twain', 'audiobook').subscribe();

    const audiobook = http.expectOne(
      '/api/providers/search?query=twain&limit=20&kind=audiobook',
    );
    expect(audiobook.request.method).toBe('GET');
    audiobook.flush({ items: [], hasMore: false, sources: [] });
  });

  it('keeps item detail and acquisition provider-qualified', () => {
    service.item('wikisource', 'Pride and Prejudice').subscribe();

    const detail = http.expectOne(
      '/api/providers/wikisource/items/Pride%20and%20Prejudice',
    );
    expect(detail.request.method).toBe('GET');
    detail.flush({});

    service
      .acquire('wikisource', {
        externalId: 'Pride and Prejudice',
        assetId: 'pdf',
      })
      .subscribe();

    const acquire = http.expectOne('/api/providers/wikisource/acquire');
    expect(acquire.request.method).toBe('POST');
    expect(acquire.request.body).toEqual({
      externalId: 'Pride and Prejudice',
      assetId: 'pdf',
    });
    expect(JSON.stringify(acquire.request.body)).not.toMatch(/https?:\/\//);
    acquire.flush({});
  });
});
