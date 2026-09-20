import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import {
  AssistantService,
  AssistantTurnResponse,
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
