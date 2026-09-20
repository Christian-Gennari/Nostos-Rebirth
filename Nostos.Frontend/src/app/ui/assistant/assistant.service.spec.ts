import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AssistantService, TRANSCRIPT_SEND_POLICY } from './assistant.service';
import { AssistantContext, AssistantContextService } from './assistant-context.service';
import { Note } from '../../core/dtos/note.dtos';

/**
 * This suite exercises the REAL capture path (AssistantCaptureService ->
 * NotesService -> HttpClient), so "typed" and "transcribed" are compared on the
 * wire, not on a mock's arguments.
 */

function context(overrides: Partial<AssistantContext> = {}): AssistantContext {
  return {
    surface: 'reader',
    route: '/read/b1',
    bookId: 'b1',
    bookTitle: 'The Magic Mountain',
    bookFormat: null,
    readerType: null,
    epubCfi: null,
    pdfPage: null,
    audioTimestamp: null,
    audioChapter: null,
    selectedText: null,
    readingTarget: 'b1',
    brainReviewNoteId: null,
    concept: null,
    collectionId: null,
    anchor: null,
    ...overrides,
  };
}

function fakeContextService(initial: Partial<AssistantContext>) {
  const state = signal<AssistantContext>(context(initial));
  return {
    context: state.asReadonly(),
    set: (overrides: Partial<AssistantContext>) => state.set(context(overrides)),
  };
}

const savedNote: Note = {
  id: 'n1',
  bookId: 'b1',
  content: 'A thought',
  createdAt: '2026-01-01T00:00:00Z',
};

describe('AssistantService voice transcript alignment', () => {
  let service: AssistantService;
  let http: HttpTestingController;
  let fake: ReturnType<typeof fakeContextService>;

  beforeEach(() => {
    fake = fakeContextService({});
    TestBed.configureTestingModule({
      providers: [
        { provide: AssistantContextService, useValue: fake },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(AssistantService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends a transcribed message through the IDENTICAL request as a typed one', () => {
    const text = 'The Magic Mountain';

    service.open();
    service.updateDraft(text);
    service.submit();
    const typed = http.expectOne('/api/books/b1/notes');
    const typedRequest = typed.request;
    typed.flush(savedNote);

    service.insertTranscript(text);
    expect(service.draft()).toBe(text);
    service.submit();
    const transcribed = http.expectOne('/api/books/b1/notes');

    expect(transcribed.request.method).toBe(typedRequest.method);
    expect(transcribed.request.url).toBe(typedRequest.url);
    expect(transcribed.request.body).toEqual(typedRequest.body);
    transcribed.flush(savedNote);
  });

  it('parks a transcript in the composer for review and sends nothing by itself', () => {
    expect(TRANSCRIPT_SEND_POLICY).toBe('review');

    service.insertTranscript('the magic mountain');

    expect(service.draft()).toBe('the magic mountain');
    http.expectNone('/api/books/b1/notes');
  });

  it('lets a second voice turn answer a pending follow-up in the same conversation', () => {
    fake.set({ bookFormat: 'physical' });
    service.open();
    service.updateDraft('A thought I cannot place');
    service.submit();

    expect(service.pendingAnchor()?.question).toBe('What page are you on?');
    http.expectNone('/api/books/b1/notes');

    service.insertTranscript('42');
    expect(service.draft()).toBe('42');
    service.submit();

    const request = http.expectOne('/api/books/b1/notes');
    expect(request.request.body.sourceAnchorKind).toBe('physical_page');
    expect(request.request.body.sourceAnchorValue).toBe('42');
    expect(request.request.body.content).toBe('A thought I cannot place');
    request.flush(savedNote);
  });
});
