import { ComponentFixture, TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AssistantComponent } from './assistant.component';
import { AssistantService, AssistantTurnResponse } from './assistant.service';
import {
  AssistantContext,
  AssistantContextService,
} from './assistant-context.service';
import {
  AssistantVoiceError,
  AssistantVoiceService,
  AssistantVoiceStatus,
} from './assistant-voice.service';

/** A full context with everything unset, so each test states only what it means. */
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

/** A context service driven directly by the test, without a Router or books fetch. */
function fakeContextService(initial: Partial<AssistantContext>) {
  const state = signal<AssistantContext>(context(initial));
  return {
    context: state.asReadonly(),
    set: (overrides: Partial<AssistantContext>) => state.set(context(overrides)),
  };
}

/** A voice service the component can drive, with no microphone behind it. */
function fakeVoiceService() {
  const status = signal<AssistantVoiceStatus>('idle');
  const error = signal<AssistantVoiceError | null>(null);
  const elapsedSeconds = signal(0);
  return {
    status: status.asReadonly(),
    error: error.asReadonly(),
    elapsedSeconds: elapsedSeconds.asReadonly(),
    isRecording: computed(() => status() === 'recording'),
    isTranscribing: computed(() => status() === 'transcribing'),
    isBusy: computed(() => status() !== 'idle'),
    onTranscript: null as ((text: string) => void) | null,
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    setStatus: (value: AssistantVoiceStatus) => status.set(value),
    setError: (value: AssistantVoiceError | null) => error.set(value),
    setElapsed: (value: number) => elapsedSeconds.set(value),
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

describe('AssistantComponent (Cmd/Ctrl+J)', () => {
  let fixture: ComponentFixture<AssistantComponent>;
  let assistant: AssistantService;
  let http: HttpTestingController;
  let fake: ReturnType<typeof fakeContextService>;
  let voice: ReturnType<typeof fakeVoiceService>;

  beforeEach(async () => {
    fake = fakeContextService({ surface: 'reader', route: '/read/b1', bookId: 'b1' });
    voice = fakeVoiceService();

    await TestBed.configureTestingModule({
      imports: [AssistantComponent],
      providers: [
        { provide: AssistantContextService, useValue: fake },
        { provide: AssistantVoiceService, useValue: voice },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AssistantComponent);
    assistant = TestBed.inject(AssistantService);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
  });

  it('renders the collapsed capsule trigger and toggles on click', () => {
    const trigger = fixture.nativeElement.querySelector('[data-testid="assistant-trigger"]');
    expect(trigger).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="assistant-panel"]')).toBeNull();

    trigger.click();
    fixture.detectChanges();

    expect(assistant.isOpen()).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="assistant-panel"]')).toBeTruthy();
  });

  it('opens on Cmd/Ctrl+J and prevents the browser default', () => {
    const event = new KeyboardEvent('keydown', { key: 'j', metaKey: true, cancelable: true });
    document.dispatchEvent(event);
    fixture.detectChanges();

    expect(event.defaultPrevented).toBe(true);
    expect(assistant.isOpen()).toBe(true);
  });

  it('does not touch Cmd/Ctrl+K, which the command palette owns', () => {
    const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true });
    document.dispatchEvent(event);
    fixture.detectChanges();

    expect(event.defaultPrevented).toBe(false);
    expect(assistant.isOpen()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="assistant-panel"]')).toBeNull();
  });

  it('closes on Escape and restores the previously focused element', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'j', metaKey: true, cancelable: true }),
    );
    fixture.detectChanges();
    expect(assistant.isOpen()).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    fixture.detectChanges();

    expect(assistant.isOpen()).toBe(false);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('sends the known anchor with the turn and shows the chip label', () => {
    fake.set({
      surface: 'reader',
      route: '/read/b1',
      bookId: 'b1',
      bookTitle: 'The Magic Mountain',
      bookFormat: 'ebook',
      anchor: { kind: 'pdf_page', value: '183', verified: true },
    });
    fixture.detectChanges();

    assistant.open();
    assistant.updateDraft('A thought about the snow');
    assistant.submit();

    const request = http.expectOne('/api/assistant/turn');
    expect(request.request.body.message).toBe('A thought about the snow');
    expect(request.request.body.context.anchor).toEqual({
      kind: 'pdf_page',
      value: '183',
      verified: true,
    });
    request.flush(turn());

    expect(assistant.anchorChip()?.label).toBe('The Magic Mountain · p. 183');
  });

  it('asks a physical-book follow-up and still sends when the answer is skipped', () => {
    fake.set({
      surface: 'reader',
      route: '/read/b1',
      bookId: 'b1',
      bookTitle: 'A Physical Book',
      bookFormat: 'physical',
    });
    fixture.detectChanges();

    assistant.open();
    assistant.updateDraft('A thought without a page');
    assistant.submit();

    expect(assistant.pendingAnchor()?.question).toBe('What page are you on?');
    http.expectNone('/api/assistant/turn');

    assistant.skipAnchor();

    const request = http.expectOne('/api/assistant/turn');
    expect(request.request.body.message).toBe('A thought without a page');
    expect(request.request.body.context.anchor).toEqual({
      kind: 'unknown',
      value: null,
      verified: false,
    });
    request.flush(turn());
  });

  it('sends a typed physical page as an unverified anchor', () => {
    fake.set({
      surface: 'reader',
      route: '/read/b1',
      bookId: 'b1',
      bookTitle: 'A Physical Book',
      bookFormat: 'physical',
    });
    fixture.detectChanges();

    assistant.open();
    assistant.updateDraft('A thought without a page');
    assistant.submit();
    assistant.updateDraft('42');
    assistant.submit();

    const request = http.expectOne('/api/assistant/turn');
    expect(request.request.body.message).toBe('A thought without a page');
    expect(request.request.body.context.anchor).toEqual({
      kind: 'physical_page',
      value: '42',
      verified: false,
    });
    request.flush(turn());
  });

  it('asks for a timestamp when an audiobook is not open in the in-app reader', () => {
    fake.set({ surface: 'book-detail', route: '/library/b1', bookId: 'b1', bookFormat: 'audiobook' });
    fixture.detectChanges();

    assistant.open();
    assistant.updateDraft('A thought');
    assistant.submit();

    expect(assistant.pendingAnchor()?.question).toBe("What's the current timestamp?");
    http.expectNone('/api/assistant/turn');
  });

  it('sends immediately with no anchor when the format cannot provide one', () => {
    fake.set({
      surface: 'reader',
      route: '/read/b1',
      bookId: 'b1',
      bookFormat: 'ebook',
    });
    fixture.detectChanges();

    assistant.open();
    assistant.updateDraft('A thought with nowhere to point');
    assistant.submit();

    expect(assistant.pendingAnchor()).toBeNull();
    const request = http.expectOne('/api/assistant/turn');
    expect(request.request.body.context.anchor).toBeNull();
    request.flush(turn());
  });

  it('defaults to verbatim and sends the chosen mode with the turn', () => {
    assistant.open();
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector(
      '[data-testid="assistant-mode-select"]',
    ) as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe('verbatim');
    expect(assistant.processingMode()).toBe('verbatim');

    select.value = 'clarify';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(assistant.processingMode()).toBe('clarify');

    assistant.updateDraft('A thought worth clarifying');
    assistant.submit();

    const request = http.expectOne('/api/assistant/turn');
    expect(request.request.body.processingMode).toBe('clarify');
    request.flush(turn());
  });

  it('shows the raw transcript of a captured note and restores it', () => {
    assistant.open();
    assistant.updateDraft('so anyway i was thinking');
    assistant.submit();

    http
      .expectOne('/api/assistant/turn')
      .flush(turn({ acknowledgement: 'Saved.', capturedNoteId: 'note-9' }));
    fixture.detectChanges();

    // The affordance exists only because the turn named a captured note.
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="assistant-raw-toggle"]',
    ) as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    toggle.click();
    fixture.detectChanges();

    const raw = http.expectOne('/api/notes/note-9/raw');
    expect(raw.request.method).toBe('GET');
    raw.flush({
      id: 'note-9',
      rawContent: 'so anyway i was thinking',
      content: 'I was thinking.',
      processingMode: 'light_polish',
    });
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[data-testid="assistant-raw-text"]').textContent,
    ).toContain('so anyway i was thinking');
    expect(
      fixture.nativeElement.querySelector('[data-testid="assistant-raw-mode"]').textContent,
    ).toContain('light_polish');

    (
      fixture.nativeElement.querySelector(
        '[data-testid="assistant-raw-restore"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    const restore = http.expectOne('/api/notes/note-9/raw/restore');
    expect(restore.request.method).toBe('POST');
    restore.flush({
      id: 'note-9',
      rawContent: 'so anyway i was thinking',
      content: 'so anyway i was thinking',
      processingMode: 'verbatim',
    });
    fixture.detectChanges();

    expect(assistant.rawTranscript()?.processingMode).toBe('verbatim');
  });

  it('says plainly when a captured note kept no separate original text', () => {
    assistant.open();
    assistant.updateDraft('The snow was general all over Ireland.');
    assistant.submit();

    http
      .expectOne('/api/assistant/turn')
      .flush(turn({ acknowledgement: 'Saved.', capturedNoteId: 'note-quote' }));
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector(
        '[data-testid="assistant-raw-toggle"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    http.expectOne('/api/notes/note-quote/raw').flush({
      id: 'note-quote',
      rawContent: null,
      content: '',
      processingMode: 'verbatim',
    });
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[data-testid="assistant-raw-empty"]').textContent,
    ).toContain('no separate original');
  });

  it('offers no raw transcript when the turn captured nothing', () => {
    assistant.open();
    assistant.updateDraft('Where does this go?');
    assistant.submit();

    http.expectOne('/api/assistant/turn').flush(turn());
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="assistant-raw"]')).toBeNull();
  });

  it('renders non-mutating suggestion chips and links through an approved plan', () => {
    // Linking has a target only when a note is under review.
    fake.set({
      surface: 'reader',
      route: '/read/b1',
      bookId: 'b1',
      brainReviewNoteId: 'note-1',
    });
    fixture.detectChanges();

    assistant.open();
    assistant.suggestions.set([
      { kind: 'concept', label: 'Mountains', reason: 'Existing concept.', value: 'c-alpha' },
    ]);
    fixture.detectChanges();

    const chip = fixture.nativeElement.querySelector(
      '[data-testid="assistant-suggestion"]',
    ) as HTMLButtonElement;
    expect(chip).toBeTruthy();
    expect(chip.textContent).toContain('Mountains');

    chip.click();
    fixture.detectChanges();

    // Choosing a concept only asks for a plan; nothing has been linked yet.
    const request = http.expectOne('/api/assistant/turn');
    expect(request.request.body.message).toContain('Mountains');
    request.flush(
      turn({
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
    fixture.detectChanges();

    const plan = fixture.nativeElement.querySelector('[data-testid="assistant-plan"]');
    expect(plan).toBeTruthy();
    expect(plan.textContent).toContain('Link the note to Mountains');

    (plan.querySelector('[data-testid="assistant-plan-approve"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const approval = http.expectOne('/api/assistant/plan/approve');
    expect(approval.request.body).toEqual({ planId: 'plan-1', approvalToken: 'token-1' });
    approval.flush({ success: true, errorCode: null, errorMessage: null, steps: [] });
    fixture.detectChanges();

    expect(assistant.pendingPlan()).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="assistant-plan"]'),
    ).toBeNull();
  });

  it('leaves the note unlinked when the user dismisses the suggestions', () => {
    assistant.open();
    assistant.suggestions.set([
      { kind: 'concept', label: 'Mountains', reason: 'Existing concept.', value: 'c-alpha' },
    ]);
    fixture.detectChanges();

    const none = fixture.nativeElement.querySelector(
      '[data-testid="assistant-suggestion-none"]',
    ) as HTMLButtonElement;
    expect(none).toBeTruthy();

    none.click();
    fixture.detectChanges();

    expect(assistant.suggestions()).toEqual([]);
    http.expectNone('/api/assistant/turn');
  });

  describe('voice capture in the composer', () => {
    function open(): void {
      assistant.open();
      fixture.detectChanges();
    }

    function query(selector: string): any {
      return fixture.nativeElement.querySelector(selector);
    }

    it('shows the mic in the OPEN composer and starts recording on tap', () => {
      open();
      const mic = query('[data-testid="assistant-voice-start"]');
      expect(mic).toBeTruthy();
      // Reachability: it lives in the composer, never on the collapsed capsule.
      expect(query('.assistant-composer').contains(mic)).toBe(true);
      expect(query('.assistant-trigger').contains(mic)).toBe(false);

      mic.click();
      expect(voice.start).toHaveBeenCalledTimes(1);
    });

    it('shows a quiet elapsed timer and a stop control while recording', () => {
      open();
      voice.setElapsed(7);
      voice.setStatus('recording');
      fixture.detectChanges();

      expect(query('[data-testid="assistant-voice-timer"]').textContent).toContain('0:07');
      const stop = query('[data-testid="assistant-voice-stop"]');
      expect(stop).toBeTruthy();
      expect(query('[data-testid="assistant-voice-start"]')).toBeNull();

      stop.click();
      expect(voice.stop).toHaveBeenCalledTimes(1);
    });

    it('shows a transcribing state with a cancel affordance', () => {
      open();
      voice.setStatus('transcribing');
      fixture.detectChanges();

      expect(query('[data-testid="assistant-voice-transcribing"]')).toBeTruthy();
      const cancel = query('[data-testid="assistant-voice-cancel"]');
      expect(cancel).toBeTruthy();

      cancel.click();
      expect(voice.cancel).toHaveBeenCalledTimes(1);
    });

    it('cancels a live recording from the composer', () => {
      open();
      voice.setStatus('recording');
      fixture.detectChanges();

      query('[data-testid="assistant-voice-cancel"]').click();
      expect(voice.cancel).toHaveBeenCalledTimes(1);
    });

    it('does not stick in an error state: message clears, mic returns', () => {
      open();
      voice.setError({
        kind: 'failed',
        message: "Couldn't transcribe that recording. Try again.",
      });
      fixture.detectChanges();

      const error = query('[data-testid="assistant-voice-error"]');
      expect(error).toBeTruthy();
      expect(error.getAttribute('aria-live')).toBe('polite');
      expect(error.textContent).toContain("Couldn't transcribe");

      voice.setError(null);
      fixture.detectChanges();
      expect(query('[data-testid="assistant-voice-error"]')).toBeNull();
      expect(query('[data-testid="assistant-voice-start"]')).toBeTruthy();
    });

    it('surfaces a denied-permission message in the surface', () => {
      open();
      voice.setError({
        kind: 'denied',
        message: 'Microphone access is blocked. Allow it in your browser, then try again.',
      });
      fixture.detectChanges();

      expect(query('[data-testid="assistant-voice-error"]').textContent).toContain(
        'Microphone access is blocked',
      );
    });

    it('hands a finished transcript to the conversation, not a second pipeline', () => {
      open();
      expect(voice.onTranscript).toBeTypeOf('function');

      voice.onTranscript?.('The Magic Mountain');

      expect(assistant.draft()).toBe('The Magic Mountain');
      // Auto-send is queued, not dispatched: nothing is sent while Undo is live.
      expect(assistant.autoSendPending()).toBe(true);
      http.expectNone('/api/assistant/turn');

      assistant.undoTranscript(); // do not leave a real 2s timer behind
    });

    it('shows the Undo affordance only while the auto-send window is open', () => {
      open();
      expect(query('[data-testid="assistant-voice-undo"]')).toBeNull();

      assistant.insertTranscript('The Magic Mountain');
      fixture.detectChanges();

      const undo = query('[data-testid="assistant-voice-undo"]');
      expect(undo).toBeTruthy();
      expect(undo.textContent).toContain('Undo');

      query('[data-testid="assistant-voice-undo-button"]').click();
      fixture.detectChanges();

      expect(assistant.autoSendPending()).toBe(false);
      expect(query('[data-testid="assistant-voice-undo"]')).toBeNull();
      expect(assistant.draft()).toBe('The Magic Mountain');
      http.expectNone('/api/assistant/turn');
    });

    it('closing the surface abandons a live recording', () => {
      open();
      voice.setStatus('recording');
      fixture.detectChanges();

      fixture.componentInstance.close();

      expect(voice.cancel).toHaveBeenCalled();
    });
  });
});
