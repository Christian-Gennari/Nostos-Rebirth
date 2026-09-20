import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { NotesService } from './notes.service';

/**
 * The note post-processing surface (issue #262 §7, §8) as the client sees it:
 * three routes, at the exact URLs the backend maps, with the mode in the body.
 */
describe('NotesService post-processing', () => {
  let service: NotesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(NotesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reprocesses a note with the chosen mode', () => {
    service.reprocess('note-1', 'clarify').subscribe();

    const request = http.expectOne('/api/notes/note-1/reprocess');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ processingMode: 'clarify' });
    request.flush({ id: 'note-1' });
  });

  it('reprocesses back to the original with verbatim', () => {
    service.reprocess('note-2', 'verbatim').subscribe();

    const request = http.expectOne('/api/notes/note-2/reprocess');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ processingMode: 'verbatim' });
    request.flush({ id: 'note-2' });
  });

  it('reads a note raw transcript', () => {
    let result: { rawContent: string | null } | undefined;
    service.raw('note-3').subscribe((raw) => (result = raw));

    const request = http.expectOne('/api/notes/note-3/raw');
    expect(request.request.method).toBe('GET');
    request.flush({
      id: 'note-3',
      rawContent: 'the original words',
      content: 'The original words.',
      processingMode: 'light_polish',
    });

    expect(result?.rawContent).toBe('the original words');
  });

  it('restores a note from its raw transcript', () => {
    service.restoreRaw('note-4').subscribe();

    const request = http.expectOne('/api/notes/note-4/raw/restore');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});
    request.flush({ id: 'note-4' });
  });
});
