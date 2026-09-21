import { ComponentFixture, TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AssistantComponent } from './assistant.component';
import { AssistantService, AssistantTurnResponse } from './assistant.service';
import { AssistantStatusService } from './assistant-status.service';
import { LibraryPreferencesService } from '../../core/services/library-preferences.service';
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

/** A status service the component can drive, with no HTTP behind it. */
function fakeStatusService(initial: boolean) {
  const available = signal(initial);
  return {
    available: available.asReadonly(),
    ensureLoaded: vi.fn(),
    refresh: vi.fn(),
    setAvailable: (value: boolean) => available.set(value),
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
  let status: ReturnType<typeof fakeStatusService>;

  beforeEach(async () => {
    localStorage.clear();
    fake = fakeContextService({ surface: 'reader', route: '/read/b1', bookId: 'b1' });
    voice = fakeVoiceService();
    status = fakeStatusService(true);

    await TestBed.configureTestingModule({
      imports: [AssistantComponent],
      providers: [
        { provide: AssistantContextService, useValue: fake },
        { provide: AssistantVoiceService, useValue: voice },
        { provide: AssistantStatusService, useValue: status },
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

  it('hides the capsule and panel when the user preference is off', () => {
    TestBed.inject(LibraryPreferencesService).setAssistantEnabled(false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="assistant-trigger"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="assistant-panel"]')).toBeNull();

    // The keyboard shortcut is not hijacked for a feature that is off.
    const event = new KeyboardEvent('keydown', { key: 'j', metaKey: true, cancelable: true });
    document.dispatchEvent(event);
    fixture.detectChanges();
    expect(event.defaultPrevented).toBe(false);
    expect(assistant.isOpen()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="assistant-panel"]')).toBeNull();
  });

  it('hides the capsule when the server reports the assistant unavailable', () => {
    status.setAvailable(false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="assistant-trigger"]')).toBeNull();

    fixture.componentInstance.open();
    fixture.detectChanges();
    expect(assistant.isOpen()).toBe(false);
  });

  it('shows the capsule when the preference is on and the server is available', () => {
    expect(fixture.nativeElement.querySelector('[data-testid="assistant-trigger"]')).toBeTruthy();
    expect(status.ensureLoaded).toHaveBeenCalled();
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

    // The capture dispatches at once; the backend decides it needs a page.
    http.expectOne('/api/assistant/turn').flush(
      turn({ anchorPrompt: { kind: 'physical_page', question: 'What page are you on?' } }),
    );
    expect(assistant.pendingAnchor()?.question).toBe('What page are you on?');

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
    http.expectOne('/api/assistant/turn').flush(
      turn({ anchorPrompt: { kind: 'physical_page', question: 'What page are you on?' } }),
    );

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

  it('names the book and page in the transcript once a follow-up is answered', () => {
    fake.set({
      surface: 'reader',
      route: '/read/b1',
      bookId: 'b1',
      bookTitle: 'The Magic Mountain',
      bookFormat: 'physical',
    });
    fixture.detectChanges();

    assistant.open();
    fixture.detectChanges();
    assistant.updateDraft('A thought for The Magic Mountain');
    assistant.submit();
    fixture.detectChanges();

    http.expectOne('/api/assistant/turn').flush(
      turn({ anchorPrompt: { kind: 'physical_page', question: 'What page are you on?' } }),
    );
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[data-testid="assistant-anchor-prompt"]').textContent,
    ).toContain('What page are you on?');

    assistant.updateDraft('Page 247.');
    assistant.submit();

    const request = http.expectOne('/api/assistant/turn');
    expect(request.request.body.message).toBe('A thought for The Magic Mountain');
    expect(request.request.body.context.anchor).toEqual({
      kind: 'physical_page',
      value: '247',
      verified: false,
    });
    request.flush(
      turn({ acknowledgement: 'Saved to The Magic Mountain.', capturedNoteId: 'note-1' }),
    );
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.entry .entry-anchor').textContent,
    ).toContain('The Magic Mountain · p. 247');
  });

  it('keeps the pending question and transcript across a close and reopen', () => {
    fake.set({ bookFormat: 'physical', bookTitle: 'The Magic Mountain' });
    fixture.detectChanges();

    assistant.open();
    fixture.detectChanges();
    assistant.updateDraft('A thought for The Magic Mountain');
    assistant.submit();
    fixture.detectChanges();

    http.expectOne('/api/assistant/turn').flush(
      turn({ anchorPrompt: { kind: 'physical_page', question: 'What page are you on?' } }),
    );
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="assistant-anchor-prompt"]'),
    ).toBeTruthy();

    fixture.componentInstance.close();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="assistant-panel"]')).toBeNull();

    fixture.componentInstance.open();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="assistant-anchor-prompt"]').textContent,
    ).toContain('What page are you on?');
    // The question is still in the transcript, and the thought behind it is
    // still held (answering it must not restart the capture).
    expect(
      fixture.nativeElement.querySelector('[data-testid="assistant-transcript"]').textContent,
    ).toContain('What page are you on?');
    http.expectNone('/api/assistant/turn');
  });

  it('asks for a timestamp when an audiobook is not open in the in-app reader', () => {
    fake.set({ surface: 'book-detail', route: '/library/b1', bookId: 'b1', bookFormat: 'audiobook' });
    fixture.detectChanges();

    assistant.open();
    assistant.updateDraft('A thought');
    assistant.submit();

    http.expectOne('/api/assistant/turn').flush(
      turn({
        anchorPrompt: {
          kind: 'external_audio_timestamp',
          question: "What's the current timestamp?",
        },
      }),
    );

    expect(assistant.pendingAnchor()?.question).toBe("What's the current timestamp?");
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

  it('renders no per-capture processing control in the composer', () => {
    assistant.open();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[data-testid="assistant-mode-select"]'),
    ).toBeNull();
    expect(fixture.nativeElement.querySelector('.composer-modes')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.assistant-composer').textContent,
    ).not.toContain('Processing');
  });

  it('renders a speaker label for both sides of the transcript', () => {
    assistant.open();
    assistant.updateDraft('Who are you?');
    assistant.submit();
    http.expectOne('/api/assistant/turn').flush(turn({ reply: 'The Nostos assistant.' }));
    fixture.detectChanges();

    const userLabel = fixture.nativeElement.querySelector(
      '[data-testid="assistant-entry-user-label"]',
    );
    const assistantLabel = fixture.nativeElement.querySelector(
      '[data-testid="assistant-entry-assistant-label"]',
    );

    expect(userLabel).toBeTruthy();
    expect(assistantLabel).toBeTruthy();
    expect(userLabel.textContent).toContain('You');
    expect(assistantLabel.textContent).toContain('Nostos');
  });

  it('renders the complete assistant Markdown surface safely and keeps user text literal', () => {
    assistant.open();
    assistant.updateDraft('**Keep this user text literal**');
    assistant.submit();

    const reply = [
      '# Reading plan',
      '',
      'Paragraph with **bold**, *italics*, ~~removed~~, `inline code`, and [a link](https://example.com).',
      '',
      '1. First',
      '   - Nested item',
      '2. Second',
      '',
      '- [x] Finished',
      '- [ ] Still reading',
      '',
      '> Outer quote',
      '>> Nested quote',
      '',
      '| Shelf | Books |',
      '| --- | ---: |',
      '| Classics | 18 |',
      '',
      '```ts',
      'const answer = 42;',
      '```',
      '',
      '---',
      '',
      '![cover](https://tracker.invalid/cover.png)',
      '[unsafe](javascript:alert(1))',
      '<script>globalThis.__nostosXss = true</script>',
      '<img src="https://tracker.invalid/pixel" onerror="globalThis.__nostosXss = true">',
      '',
      '**unfinished',
    ].join('\n');

    http.expectOne('/api/assistant/turn').flush(turn({ reply }));
    fixture.detectChanges();

    const userEntry = fixture.nativeElement.querySelector('.entry-user .entry-text') as HTMLElement;
    expect(userEntry.textContent).toContain('**Keep this user text literal**');
    expect(userEntry.querySelector('strong')).toBeNull();

    const rendered = fixture.nativeElement.querySelector(
      '[data-testid="assistant-entry-markdown"]',
    ) as HTMLElement;
    expect(rendered).toBeTruthy();
    expect(rendered.querySelector('h1')?.textContent).toContain('Reading plan');
    expect(rendered.querySelector('strong')?.textContent).toBe('bold');
    expect(rendered.querySelector('em')?.textContent).toBe('italics');
    expect(rendered.querySelector('del')?.textContent).toBe('removed');
    expect(rendered.querySelector('ol')).toBeTruthy();
    expect(rendered.querySelector('ol ul')).toBeTruthy();
    expect(rendered.querySelector('blockquote blockquote')).toBeTruthy();
    expect(rendered.querySelector('table')).toBeTruthy();
    expect(rendered.querySelector('pre code')?.textContent).toContain('const answer = 42;');
    expect(rendered.querySelector('hr')).toBeTruthy();

    // Task lists are display-only: no form control is allowed into the transcript.
    expect(rendered.querySelector('input')).toBeNull();
    expect(rendered.textContent).toContain('☑');
    expect(rendered.textContent).toContain('☐');

    // Remote Markdown images never create a network-loading element.
    expect(rendered.querySelector('img')).toBeNull();
    expect(rendered.textContent).toContain('[Image omitted: cover]');

    // Raw HTML is shown literally, while Angular remains the final sanitizer for
    // generated attributes such as link hrefs.
    expect(rendered.querySelector('script')).toBeNull();
    expect(rendered.textContent).toContain('<script>globalThis.__nostosXss = true</script>');
    expect(rendered.textContent).toContain('<img src="https://tracker.invalid/pixel"');
    const unsafeLink = Array.from(rendered.querySelectorAll('a')).find(
      (link) => link.textContent === 'unsafe',
    ) as HTMLAnchorElement | undefined;
    expect(unsafeLink).toBeTruthy();
    expect(unsafeLink?.getAttribute('href')?.startsWith('javascript:')).toBe(false);

    // Malformed Markdown degrades to readable text instead of losing the tail.
    expect(rendered.textContent).toContain('**unfinished');
  });

  describe('thinking indicator (issue #289)', () => {
    function transcript(): HTMLElement {
      return fixture.nativeElement.querySelector('[data-testid="assistant-transcript"]');
    }

    function pending(): HTMLElement | null {
      return fixture.nativeElement.querySelector('[data-testid="assistant-pending"]');
    }

    /** Dispatch a turn and leave it in flight, returning its request handle. */
    function sendInFlight() {
      assistant.open();
      fixture.detectChanges();
      assistant.updateDraft('Are you there?');
      assistant.submit();
      fixture.detectChanges();
      return http.expectOne('/api/assistant/turn');
    }

    it('shows the pending entry after the user entry while a turn is in flight', () => {
      const request = sendInFlight();

      const indicator = pending();
      expect(indicator).toBeTruthy();

      const entries = Array.from(transcript().querySelectorAll('.entry')) as HTMLElement[];
      const userEntry = transcript().querySelector('[data-testid="assistant-entry-user-label"]')
        ?.closest('.entry') as HTMLElement;
      expect(userEntry).toBeTruthy();
      expect(entries.indexOf(indicator!)).toBeGreaterThan(entries.indexOf(userEntry));

      request.flush(turn());
    });

    it('removes the pending entry when the response arrives', () => {
      const request = sendInFlight();
      expect(pending()).toBeTruthy();

      request.flush(turn({ reply: 'Here.' }));
      fixture.detectChanges();

      expect(pending()).toBeNull();
    });

    it('removes the pending entry when the request fails', () => {
      const request = sendInFlight();
      expect(pending()).toBeTruthy();

      request.flush('', { status: 503, statusText: 'Service Unavailable' });
      fixture.detectChanges();

      expect(pending()).toBeNull();
      expect(assistant.sending()).toBe(false);
    });

    it('exposes the state as accessible text and hides the decorative dots', () => {
      const request = sendInFlight();

      const indicator = pending()!;
      const hidden = indicator.querySelector('.visually-hidden');
      expect(hidden).toBeTruthy();
      expect(hidden!.textContent?.trim()).toContain('Thinking');
      expect(indicator.getAttribute('role')).toBe('status');
      expect(indicator.getAttribute('aria-live')).toBe('polite');

      const dots = Array.from(indicator.querySelectorAll('.thinking-dot'));
      expect(dots.length).toBe(3);
      for (const dot of dots) {
        expect(dot.getAttribute('aria-hidden')).toBe('true');
      }

      request.flush(turn());
    });
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

  it('renders suggestion chips and links the chosen existing concept without a second approval', () => {
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

    const request = http.expectOne('/api/assistant/turn');
    expect(request.request.body.message).toContain('Mountains');
    request.flush(turn({ reply: 'Linked the note to Mountains.', pendingPlan: null }));
    fixture.detectChanges();

    expect(assistant.pendingPlan()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="assistant-plan"]')).toBeNull();
  });

  it('uses the plan surface only as a lightweight destructive confirmation fallback', () => {
    assistant.open();
    assistant.pendingPlan.set({
      planId: 'plan-delete',
      summary: 'Delete the obsolete collection. Its books will stay in the library.',
      steps: [
        {
          capability: 'library_delete_collection',
          summary: 'Delete the obsolete collection',
          argumentsJson: '{}',
        },
      ],
      approvalToken: 'token-delete',
    });
    fixture.detectChanges();

    const plan = fixture.nativeElement.querySelector('[data-testid="assistant-plan"]');
    expect(plan).toBeTruthy();
    expect(plan.textContent).toContain('Confirmation required');
    expect(plan.textContent).toContain('Confirm change');
    expect(plan.textContent).toContain('reply “yes” or “go ahead”');

    (plan.querySelector('[data-testid="assistant-plan-approve"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const approval = http.expectOne('/api/assistant/plan/approve');
    expect(approval.request.body).toEqual({
      planId: 'plan-delete',
      approvalToken: 'token-delete',
    });
    approval.flush({
      success: true,
      errorCode: null,
      errorMessage: null,
      steps: [
        {
          capability: 'library_delete_collection',
          success: true,
          errorCode: null,
          errorMessage: null,
          data: { reply: 'Deleted the obsolete collection.' },
        },
      ],
    });
    fixture.detectChanges();

    expect(assistant.pendingPlan()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="assistant-plan"]')).toBeNull();
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

  describe('following the newest turn (issue #300)', () => {
    const PANE_HEIGHT = 400;
    const CONTENT_HEIGHT = 1200; // three panes of transcript: there is room to scroll
    const END = CONTENT_HEIGHT - PANE_HEIGHT;

    /** Where the reader has put a pane. jsdom keeps no scroll position of its own. */
    const positions = new WeakMap<Element, number>();

    function isPane(element: Element): boolean {
      return element.getAttribute('data-testid') === 'assistant-body';
    }

    /**
     * jsdom lays nothing out: every element reports scrollHeight/clientHeight 0
     * and `scrollTop` never moves. The behaviour under test is arithmetic on
     * those numbers, so they are stated on the prototype — a pane that the
     * surface renders mid-test (a reopen) is measured the same way as the first
     * one — and restored afterwards.
     */
    beforeEach(() => {
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
        get(this: HTMLElement) {
          return isPane(this) ? CONTENT_HEIGHT : 0;
        },
        configurable: true,
      });
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
        get(this: HTMLElement) {
          return isPane(this) ? PANE_HEIGHT : 0;
        },
        configurable: true,
      });
      Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
        get(this: HTMLElement) {
          return positions.get(this) ?? 0;
        },
        set(this: HTMLElement, value: number) {
          if (isPane(this)) positions.set(this, value);
        },
        configurable: true,
      });
    });

    afterEach(() => {
      for (const property of ['scrollHeight', 'clientHeight', 'scrollTop']) {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>)[property];
      }
    });

    function body(): HTMLElement {
      return fixture.nativeElement.querySelector('[data-testid="assistant-body"]');
    }

    /** The reader's own scroll, through the binding the template wires up. */
    function readerScrollsTo(position: number): void {
      const element = body();
      element.scrollTop = position;
      element.dispatchEvent(new Event('scroll'));
    }

    /** Render, and let the after-render work that follows it run. */
    async function render(): Promise<void> {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    /** Open the surface: its pane is the size of a scrolled pane from the start. */
    async function open(): Promise<void> {
      assistant.open();
      await render();
    }

    it('keeps an arriving reply in view when the reader is at the end', async () => {
      await open();

      assistant.updateDraft('What are you reading?');
      assistant.submit();
      fixture.detectChanges();
      http.expectOne('/api/assistant/turn').flush(turn({ reply: 'Your own library.' }));
      await render();

      // The reply is at the end of the transcript, and so is the view: it is
      // seen without a manual scroll, which is the whole point of the issue.
      expect(body().scrollTop).toBe(END);
    });

    it('leaves the view alone when a reply arrives while an older turn is being read', async () => {
      await open();
      expect(body().scrollTop).toBe(END);

      assistant.updateDraft('One more thing.');
      fixture.detectChanges();
      fixture.componentInstance.onSendClick();
      await render();

      // The reader answers the wait by scrolling back into the conversation.
      readerScrollsTo(200);
      await render();

      http.expectOne('/api/assistant/turn').flush(turn({ reply: 'Noted.' }));
      await render();

      // A big arrival under a view the reader owns, and it stays where they put it.
      expect(body().scrollTop).toBe(200);
    });

    it('follows again once the reader scrolls back to the end themselves', async () => {
      await open();
      readerScrollsTo(200);
      await render();

      readerScrollsTo(END);
      await render();

      assistant.updateDraft('And now?');
      assistant.submit();
      http.expectOne('/api/assistant/turn').flush(turn({ reply: 'Now this.' }));
      await render();

      expect(body().scrollTop).toBe(END);
    });

    it('returns to the end for the reader own message, wherever they had scrolled', async () => {
      await open();
      readerScrollsTo(0);
      await render();

      assistant.updateDraft('Answer this one.');
      await render();
      fixture.componentInstance.onSendClick();
      await render();

      // Their own turn is the thing being answered: it always comes back.
      expect(body().scrollTop).toBe(END);
      http.expectOne('/api/assistant/turn').flush(turn());
    });

    it('lands on the newest turn when the surface is opened', async () => {
      await open();
      readerScrollsTo(0);
      await render();

      fixture.componentInstance.close();
      fixture.detectChanges();
      fixture.componentInstance.open();
      await render();

      expect(body().scrollTop).toBe(END);
    });
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
