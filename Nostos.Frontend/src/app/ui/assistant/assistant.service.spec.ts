import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import {
  AssistantService,
  AssistantTurnResponse,
  DEFAULT_PROCESSING_MODE,
  TRANSCRIPT_AUTO_SEND_DELAY_MS,
  TRANSCRIPT_SEND_POLICY,
} from './assistant.service';
import { AssistantContext, AssistantContextService } from './assistant-context.service';

/**
 * The conversation now flows through the assistant bridge
 * (`POST /api/assistant/turn`), so "typed" and "transcribed" are compared on the
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

/** A minimal successful turn: a short reply and nothing else. */
function turn(overrides: Partial<AssistantTurnResponse> = {}): AssistantTurnResponse {
  return {
    reply: 'Noted.',
    acknowledgement: null,
    anchorPrompt: null,
    suggestions: [],
    pendingPlan: null,
    capturedNoteId: null,
    ...overrides,
  };
}

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
    http.expectNone('/api/assistant/turn');

    vi.advanceTimersByTime(TRANSCRIPT_AUTO_SEND_DELAY_MS);

    expect(service.autoSendPending()).toBe(false);
    const request = http.expectOne('/api/assistant/turn');
    expect(request.request.method).toBe('POST');
    expect(request.request.body.message).toBe('The Magic Mountain');
    request.flush(turn());
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
    http.expectNone('/api/assistant/turn');
    expect(service.draft()).toBe('The Magic Mountain');
  });

  it('sends a transcribed message through the IDENTICAL request as a typed one', () => {
    const text = 'The Magic Mountain';
    vi.useFakeTimers();

    service.open();
    service.updateDraft(text);
    service.submit();
    const typed = http.expectOne('/api/assistant/turn');
    const typedRequest = typed.request;
    typed.flush(turn());

    service.insertTranscript(text);
    vi.advanceTimersByTime(TRANSCRIPT_AUTO_SEND_DELAY_MS);
    const transcribed = http.expectOne('/api/assistant/turn');

    // The idempotency key is unique per turn by design; everything that carries
    // meaning — the endpoint, the message and the resolved context — is identical.
    expect(transcribed.request.method).toBe(typedRequest.method);
    expect(transcribed.request.url).toBe(typedRequest.url);
    expect(transcribed.request.body.message).toBe(typedRequest.body.message);
    expect(transcribed.request.body.context).toEqual(typedRequest.body.context);
    expect(transcribed.request.body.clientId).toBe(typedRequest.body.clientId);
    transcribed.flush(turn());
  });

  it('auto-sends a voice answer to a pending follow-up in the same conversation', () => {
    vi.useFakeTimers();
    fake.set({ bookFormat: 'physical' });
    service.open();
    service.updateDraft('A thought I cannot place');
    service.submit();

    expect(service.pendingAnchor()?.question).toBe('What page are you on?');
    http.expectNone('/api/assistant/turn');

    service.insertTranscript('247');
    expect(service.draft()).toBe('247');
    expect(service.autoSendPending()).toBe(true);
    http.expectNone('/api/assistant/turn');

    vi.advanceTimersByTime(TRANSCRIPT_AUTO_SEND_DELAY_MS);

    const request = http.expectOne('/api/assistant/turn');
    expect(request.request.body.message).toBe('A thought I cannot place');
    expect(request.request.body.context.anchor).toEqual({
      kind: 'physical_page',
      value: '247',
      verified: false,
    });
    request.flush(turn());
  });

  it('cleans a spoken page answer and names book and page in the acknowledgement', () => {
    vi.useFakeTimers();
    fake.set({ bookFormat: 'physical' });
    service.open();
    service.updateDraft('A thought I cannot place');
    service.submit();

    expect(service.pendingAnchor()?.question).toBe('What page are you on?');
    http.expectNone('/api/assistant/turn');

    service.insertTranscript('Page 247.');
    vi.advanceTimersByTime(TRANSCRIPT_AUTO_SEND_DELAY_MS);

    const request = http.expectOne('/api/assistant/turn');
    expect(request.request.body.message).toBe('A thought I cannot place');
    expect(request.request.body.context.anchor).toEqual({
      kind: 'physical_page',
      value: '247',
      verified: false,
    });
    request.flush(
      turn({ acknowledgement: 'Saved to The Magic Mountain.', capturedNoteId: 'note-1' }),
    );

    const capture = service.entries().find((entry) => entry.kind === 'capture');
    expect(capture?.anchorLabel).toBe('The Magic Mountain · p. 247');
  });

  it('parses a spoken timestamp into seconds for an external audiobook follow-up', () => {
    vi.useFakeTimers();
    fake.set({ surface: 'book-detail', route: '/library/b1', bookFormat: 'audiobook' });
    service.open();
    service.updateDraft('A thought');
    service.submit();

    expect(service.pendingAnchor()?.question).toBe("What's the current timestamp?");

    service.insertTranscript('1:23');
    vi.advanceTimersByTime(TRANSCRIPT_AUTO_SEND_DELAY_MS);

    const request = http.expectOne('/api/assistant/turn');
    expect(request.request.body.context.anchor).toEqual({
      kind: 'external_audio_timestamp',
      value: '83',
      verified: false,
    });
    request.flush(turn({ acknowledgement: 'Saved to The Magic Mountain.', capturedNoteId: 'n1' }));

    const capture = service.entries().find((entry) => entry.kind === 'capture');
    expect(capture?.anchorLabel).toBe('The Magic Mountain · 1:23');
  });

  it('keeps a pending follow-up across a close and reopen', () => {
    vi.useFakeTimers();
    fake.set({ bookFormat: 'physical' });
    service.open();
    service.updateDraft('A thought I cannot place');
    service.submit();

    service.close();
    service.open();

    // The question is the conversation, not the panel: it is still waiting.
    expect(service.pendingAnchor()?.question).toBe('What page are you on?');
    expect(service.entries().filter((entry) => entry.kind === 'question')).toHaveLength(1);
    expect(service.draft()).toBe('');

    service.updateDraft('247');
    service.submit();

    const request = http.expectOne('/api/assistant/turn');
    expect(request.request.body.message).toBe('A thought I cannot place');
    expect(request.request.body.context.anchor).toEqual({
      kind: 'physical_page',
      value: '247',
      verified: false,
    });
    request.flush(turn());
  });

  it('still saves with an unknown anchor when a follow-up is skipped', () => {
    fake.set({ bookFormat: 'physical' });
    service.open();
    service.updateDraft('A thought with no page');
    service.submit();

    expect(service.pendingAnchor()).not.toBeNull();

    service.skipAnchor();

    const request = http.expectOne('/api/assistant/turn');
    expect(request.request.body.message).toBe('A thought with no page');
    expect(request.request.body.context.anchor).toEqual({
      kind: 'unknown',
      value: null,
      verified: false,
    });
    request.flush(turn());
    expect(service.pendingAnchor()).toBeNull();
  });

  it('keeps suggestions and a pending plan from the turn', () => {
    service.open();
    service.updateDraft('Where does this go?');
    service.submit();

    const request = http.expectOne('/api/assistant/turn');
    request.flush(
      turn({
        reply: 'Mountains looks right.',
        suggestions: [
          { kind: 'concept', label: 'Mountains', reason: 'Existing concept.', value: 'c-alpha' },
        ],
        pendingPlan: {
          planId: 'plan-1',
          summary: 'Link the note to Mountains',
          steps: [
            {
              capability: 'notes_link_existing_concept',
              summary: 'Link the note to Mountains',
              argumentsJson: '{}',
            },
          ],
          approvalToken: 'token-1',
        },
      }),
    );

    expect(service.suggestions().map((suggestion) => suggestion.label)).toEqual(['Mountains']);
    expect(service.pendingPlan()?.planId).toBe('plan-1');
    expect(service.lastTurn()?.reply).toBe('Mountains looks right.');
  });

  it('starts in verbatim and sends the chosen mode with each turn', () => {
    service.open();
    expect(service.processingMode()).toBe('verbatim');
    expect(DEFAULT_PROCESSING_MODE).toBe('verbatim');

    service.setProcessingMode('light_polish');
    service.updateDraft('A thought');
    service.submit();

    const request = http.expectOne('/api/assistant/turn');
    expect(request.request.body.processingMode).toBe('light_polish');
    request.flush(turn({ capturedNoteId: 'note-1' }));

    expect(service.capturedNoteId()).toBe('note-1');
  });

  it('clears the captured note and its raw view on a later turn', () => {
    service.open();
    service.updateDraft('First');
    service.submit();
    http.expectOne('/api/assistant/turn').flush(turn({ capturedNoteId: 'note-1' }));
    expect(service.capturedNoteId()).toBe('note-1');

    service.updateDraft('Second');
    service.submit();
    http.expectOne('/api/assistant/turn').flush(turn());
    expect(service.capturedNoteId()).toBeNull();
    expect(service.rawOpen()).toBe(false);
  });

  it('loads the raw transcript and restores it without erasing it', () => {
    service.open();
    service.capturedNoteId.set('note-1');

    service.toggleRawTranscript();
    expect(service.rawOpen()).toBe(true);
    http.expectOne('/api/notes/note-1/raw').flush({
      id: 'note-1',
      rawContent: 'raw words',
      content: 'Polished.',
      processingMode: 'light_polish',
    });
    expect(service.rawTranscript()?.rawContent).toBe('raw words');

    service.restoreRawTranscript();
    http.expectOne('/api/notes/note-1/raw/restore').flush({
      id: 'note-1',
      rawContent: 'raw words',
      content: 'raw words',
      processingMode: 'verbatim',
    });
    expect(service.rawTranscript()?.content).toBe('raw words');
    expect(service.rawTranscript()?.processingMode).toBe('verbatim');
  });

  it('ignores a suggestion that is not a concept and does nothing on the wire', () => {
    service.applySuggestion({ kind: 'collection', label: 'Essays', reason: 'A collection.', value: 'col-1' });

    expect(service.lastError()).toBeNull();
    http.expectNone('/api/assistant/turn');
  });

  it('needs a review target before it will propose a link plan for a concept', () => {
    service.applySuggestion({
      kind: 'concept',
      label: 'Mountains',
      reason: 'Existing concept.',
      value: 'c-alpha',
    });
    expect(service.lastError()).toContain('Second Brain');
    http.expectNone('/api/assistant/turn');
  });

  it('proposes a link plan for a concept when a note is under review', () => {
    fake.set({ brainReviewNoteId: 'note-1' });
    service.applySuggestion({
      kind: 'concept',
      label: 'Mountains',
      reason: 'Existing concept.',
      value: 'c-alpha',
    });

    const request = http.expectOne('/api/assistant/turn');
    expect(request.request.body.context.brainReviewNoteId).toBe('note-1');
    expect(request.request.body.message).toContain('Mountains');
    request.flush(turn());
  });

  it('approves exactly one plan through the approve endpoint and records the outcome', () => {
    service.pendingPlan.set({
      planId: 'plan-1',
      summary: 'Link the note to Mountains',
      steps: [],
      approvalToken: 'token-1',
    });

    service.approvePlan('plan-1', 'token-1');

    const request = http.expectOne('/api/assistant/plan/approve');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ planId: 'plan-1', approvalToken: 'token-1' });
    request.flush({ success: true, errorCode: null, errorMessage: null, steps: [] });

    expect(service.pendingPlan()).toBeNull();
    expect(service.lastApproval()?.success).toBe(true);
  });

  it('dismisses suggestions without touching the note', () => {
    service.suggestions.set([
      { kind: 'concept', label: 'Mountains', reason: 'Existing concept.', value: 'c-alpha' },
    ]);

    service.dismissSuggestions();

    expect(service.suggestions()).toEqual([]);
    http.expectNone('/api/assistant/turn');
  });
});
