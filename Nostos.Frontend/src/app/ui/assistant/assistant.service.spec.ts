import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import {
  AssistantHistoryMessage,
  AssistantService,
  AssistantTurnResponse,
  HISTORY_MAX_CHARS,
  HISTORY_MAX_EXCHANGES,
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

    // A capture that cannot know a page is dispatched first; the backend is what
    // decides to ask for one, and the prompt arrives on the turn response.
    http.expectOne('/api/assistant/turn').flush(
      turn({ anchorPrompt: { kind: 'physical_page', question: 'What page are you on?' } }),
    );
    expect(service.pendingAnchor()?.question).toBe('What page are you on?');

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

    http.expectOne('/api/assistant/turn').flush(
      turn({ anchorPrompt: { kind: 'physical_page', question: 'What page are you on?' } }),
    );

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

    const capture = service.entries().find((entry) => entry.meta === 'Saved');
    expect(capture?.anchorLabel).toBe('The Magic Mountain · p. 247');
  });

  it('parses a spoken timestamp into seconds for an external audiobook follow-up', () => {
    vi.useFakeTimers();
    fake.set({ surface: 'book-detail', route: '/library/b1', bookFormat: 'audiobook' });
    service.open();
    service.updateDraft('A thought');
    service.submit();

    http.expectOne('/api/assistant/turn').flush(
      turn({
        anchorPrompt: {
          kind: 'external_audio_timestamp',
          question: "What's the current timestamp?",
        },
      }),
    );
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

    const capture = service.entries().find((entry) => entry.meta === 'Saved');
    expect(capture?.anchorLabel).toBe('The Magic Mountain · 1:23');
  });

  it('keeps a pending follow-up across a close and reopen', () => {
    vi.useFakeTimers();
    fake.set({ bookFormat: 'physical' });
    service.open();
    service.updateDraft('A thought I cannot place');
    service.submit();

    http.expectOne('/api/assistant/turn').flush(
      turn({ anchorPrompt: { kind: 'physical_page', question: 'What page are you on?' } }),
    );

    service.close();
    service.open();

    // The question is the conversation, not the panel: it is still waiting.
    expect(service.pendingAnchor()?.question).toBe('What page are you on?');
    expect(
      service.entries().filter((entry) => entry.text === 'What page are you on?'),
    ).toHaveLength(1);
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

    http.expectOne('/api/assistant/turn').flush(
      turn({ anchorPrompt: { kind: 'physical_page', question: 'What page are you on?' } }),
    );
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

  it('sends no per-turn processing mode', () => {
    service.open();
    service.updateDraft('A thought');
    service.submit();

    const request = http.expectOne('/api/assistant/turn');
    expect('processingMode' in request.request.body).toBe(false);
    request.flush(turn({ capturedNoteId: 'note-1' }));

    expect(service.capturedNoteId()).toBe('note-1');
  });

  describe('conversation memory (issue #286)', () => {
    it('remembers the user turn on dispatch and the assistant turn on success', () => {
      service.open();
      service.updateDraft('What did I just read?');
      service.submit();

      // Dispatch is synchronous, so the turn is remembered before the reply.
      expect(service.history()).toEqual([{ role: 'user', text: 'What did I just read?' }]);

      http.expectOne('/api/assistant/turn').flush(turn({ reply: 'The snow chapter.' }));

      expect(service.history()).toEqual([
        { role: 'user', text: 'What did I just read?' },
        { role: 'assistant', text: 'The snow chapter.' },
      ]);
    });

    it('forgets a turn the assistant never received', () => {
      service.open();
      service.updateDraft('A question that fails');
      service.submit();

      http.expectOne('/api/assistant/turn').error(new ProgressEvent('error'));

      expect(service.history()).toEqual([]);
      expect(service.draft()).toBe('A question that fails');
    });

    it('sends the remembered turns, in order, on the next turn', () => {
      service.open();
      service.updateDraft('First');
      service.submit();
      http.expectOne('/api/assistant/turn').flush(turn({ reply: 'First reply' }));

      service.updateDraft('Second');
      service.submit();
      const request = http.expectOne('/api/assistant/turn');

      expect(request.request.body.history).toEqual([
        { role: 'user', text: 'First' },
        { role: 'assistant', text: 'First reply' },
      ]);
      request.flush(turn({ reply: 'Second reply' }));
    });

    it('caps the history at the last 10 exchanges', () => {
      expect(HISTORY_MAX_EXCHANGES).toBe(10);

      service.open();
      for (let i = 1; i <= 11; i += 1) {
        service.updateDraft(`Thought ${i}`);
        service.submit();
        http.expectOne('/api/assistant/turn').flush(turn({ reply: `Reply ${i}` }));
      }

      service.updateDraft('Twelfth');
      service.submit();
      const request = http.expectOne('/api/assistant/turn');
      const history = request.request.body.history as AssistantHistoryMessage[];

      // Eleven exchanges became ten: the first exchange fell off the front, and
      // every kept user turn still carries the answer that followed it.
      expect(history).toHaveLength(20);
      expect(history[0]).toEqual({ role: 'user', text: 'Thought 2' });
      expect(history[19]).toEqual({ role: 'assistant', text: 'Reply 11' });
      expect(history.some((entry) => entry.text === 'Thought 1')).toBe(false);
      request.flush(turn());
    });

    it('truncates a remembered message to HISTORY_MAX_CHARS, never drops it', () => {
      expect(HISTORY_MAX_CHARS).toBe(2000);

      service.open();
      service.updateDraft('x'.repeat(3000));
      service.submit();
      http.expectOne('/api/assistant/turn').flush(turn({ reply: 'Noted.' }));

      service.updateDraft('Next');
      service.submit();
      const request = http.expectOne('/api/assistant/turn');
      const history = request.request.body.history as AssistantHistoryMessage[];

      expect(history[0].role).toBe('user');
      expect(history[0].text).toHaveLength(HISTORY_MAX_CHARS);
      request.flush(turn());
    });
  });

  describe('a two-sided transcript (issue #286)', () => {
    it('shows a typed question as a user entry followed by the assistant reply', () => {
      service.open();
      service.updateDraft('What did I just read?');
      service.submit();
      http.expectOne('/api/assistant/turn').flush(turn({ reply: 'The snow chapter.' }));

      expect(service.entries().map((entry) => entry.kind)).toEqual(['user', 'assistant']);
      expect(service.entries()[0]).toMatchObject({
        text: 'What did I just read?',
        anchorLabel: null,
        meta: null,
      });
      expect(service.entries()[1].text).toBe('The snow chapter.');
    });

    it('records a voice transcript as the same user entry as typing', () => {
      vi.useFakeTimers();
      service.open();

      service.updateDraft('The Magic Mountain');
      service.submit();
      http.expectOne('/api/assistant/turn').flush(turn({ reply: 'Noted.' }));
      const typed = service.entries().find((entry) => entry.kind === 'user');

      service.insertTranscript('The Magic Mountain');
      vi.advanceTimersByTime(TRANSCRIPT_AUTO_SEND_DELAY_MS);
      http.expectOne('/api/assistant/turn').flush(turn({ reply: 'Noted.' }));
      const voiced = service.entries().filter((entry) => entry.kind === 'user')[1];

      expect(typed).toBeTruthy();
      expect(voiced.kind).toBe(typed?.kind);
      expect(voiced.text).toBe(typed?.text);
      expect(voiced.anchorLabel).toBe(typed?.anchorLabel);
      expect(voiced.meta).toBe(typed?.meta);
    });
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
