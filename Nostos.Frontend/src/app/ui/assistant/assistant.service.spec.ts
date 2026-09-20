import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import {
  AssistantService,
  TRANSCRIPT_AUTO_SEND_DELAY_MS,
  TRANSCRIPT_SEND_POLICY,
} from './assistant.service';
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

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  it('defaults to auto-send', () => {
    expect(TRANSCRIPT_SEND_POLICY).toBe('auto');
  });

  it('auto-sends a transcript after the grace window with no user action', () => {
    vi.useFakeTimers();
    service.open();

    service.insertTranscript('The Magic Mountain');

    // While the window is open the text is in the composer and nothing is sent.
    expect(service.draft()).toBe('The Magic Mountain');
    expect(service.autoSendPending()).toBe(true);
    http.expectNone('/api/books/b1/notes');

    vi.advanceTimersByTime(TRANSCRIPT_AUTO_SEND_DELAY_MS);

    expect(service.autoSendPending()).toBe(false);
    const request = http.expectOne('/api/books/b1/notes');
    expect(request.request.body.rawContent).toBe('The Magic Mountain');
    request.flush(savedNote);
  });

  it('Undo inside the window results in NO send at all, text still editable', () => {
    vi.useFakeTimers();
    service.open();
    service.insertTranscript('The Magic Mountain');
    expect(service.autoSendPending()).toBe(true);

    service.undoTranscript();

    expect(service.autoSendPending()).toBe(false);
    // Well past the window: the cancelled dispatch must never fire.
    vi.advanceTimersByTime(TRANSCRIPT_AUTO_SEND_DELAY_MS * 4);
    http.expectNone('/api/books/b1/notes');
    expect(service.draft()).toBe('The Magic Mountain');
  });

  it('sends a transcribed message through the IDENTICAL request as a typed one', () => {
    const text = 'The Magic Mountain';
    vi.useFakeTimers();

    service.open();
    service.updateDraft(text);
    service.submit();
    const typed = http.expectOne('/api/books/b1/notes');
    const typedRequest = typed.request;
    typed.flush(savedNote);

    service.insertTranscript(text);
    vi.advanceTimersByTime(TRANSCRIPT_AUTO_SEND_DELAY_MS);
    const transcribed = http.expectOne('/api/books/b1/notes');

    expect(transcribed.request.method).toBe(typedRequest.method);
    expect(transcribed.request.url).toBe(typedRequest.url);
    expect(transcribed.request.body).toEqual(typedRequest.body);
    transcribed.flush(savedNote);
  });

  it('auto-sends a voice answer to a pending follow-up in the same conversation', () => {
    vi.useFakeTimers();
    fake.set({ bookFormat: 'physical' });
    service.open();
    service.updateDraft('A thought I cannot place');
    service.submit();

    expect(service.pendingAnchor()?.question).toBe('What page are you on?');
    http.expectNone('/api/books/b1/notes');

    service.insertTranscript('247');
    expect(service.draft()).toBe('247');
    expect(service.autoSendPending()).toBe(true);
    http.expectNone('/api/books/b1/notes');

    vi.advanceTimersByTime(TRANSCRIPT_AUTO_SEND_DELAY_MS);

    const request = http.expectOne('/api/books/b1/notes');
    expect(request.request.body.sourceAnchorKind).toBe('physical_page');
    expect(request.request.body.sourceAnchorValue).toBe('247');
    expect(request.request.body.content).toBe('A thought I cannot place');
    request.flush(savedNote);
  });
});
