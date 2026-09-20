/**
 * Assistant conversation/session state. No LLM — this stream records typed
 * captures and drives the one deterministic follow-up ("What page are you on?").
 *
 * The surface opens empty; every capture appends an editorial entry (rendered as
 * a blockquote/marginalia, never a chat bubble). The service owns the capture
 * flow so the component stays presentational and the flow is unit-testable.
 */
import { Injectable, computed, effect, inject, signal } from '@angular/core';

import {
  AssistantAnchor,
  AssistantContext,
  AssistantContextService,
} from './assistant-context.service';
import { AssistantCaptureResult, AssistantCaptureService } from './assistant-capture.service';

export interface AssistantEntry {
  id: string;
  kind: 'capture' | 'question' | 'error';
  text: string;
  anchorLabel: string | null;
  meta: string | null;
}

export interface AssistantAnchorPrompt {
  kind: 'physical_page' | 'external_audio_timestamp';
  question: string;
}

/**
 * What happens to a voice transcript (issue #262 §6): park it in the composer
 * for the user to review, or send it immediately.
 *
 * ONE SWITCH, deliberately. The transcription provider returns "the magic
 * mountain" where the user said "The Magic Mountain" (measured), and this is a
 * library app where a title or an author decides which book a note links to, so
 * the default is `review`. Flipping the policy later is this one edit; the send
 * itself is the same `submit()` a typed message uses either way.
 */
export const TRANSCRIPT_SEND_POLICY: 'review' | 'auto' = 'review';

/** Shape exposed on `globalThis.__nostosAssistant` for live verification. */
export interface NostosAssistantDiagnostics {
  context: AssistantContext;
  lastCapture: AssistantCaptureResult | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __nostosAssistant: NostosAssistantDiagnostics | undefined;
}

let entrySeq = 0;

@Injectable({ providedIn: 'root' })
export class AssistantService {
  private readonly contextService = inject(AssistantContextService);
  private readonly captureService = inject(AssistantCaptureService);

  readonly isOpen = signal(false);
  readonly draft = signal('');
  readonly entries = signal<AssistantEntry[]>([]);
  readonly sending = signal(false);
  readonly lastCapture = signal<AssistantCaptureResult | null>(null);
  readonly lastError = signal<string | null>(null);

  /** A deterministic follow-up awaiting an anchor answer. */
  readonly pendingAnchor = signal<AssistantAnchorPrompt | null>(null);
  private readonly pendingText = signal('');

  /** The user removed the ambient anchor for this session (saves as unknown). */
  private readonly anchorDismissed = signal(false);

  /** The live snapshot; a provider registry resolves the first non-null value. */
  readonly context = computed<AssistantContext>(() => this.contextService.context());

  /** The known-location chip, hidden once dismissed. */
  readonly anchorChip = computed<{ label: string; anchor: AssistantAnchor } | null>(() => {
    if (this.anchorDismissed()) return null;
    const context = this.context();
    if (!context.anchor) return null;
    const label = this.anchorLabel(context);
    if (!label) return null;
    return { label, anchor: context.anchor };
  });

  constructor() {
    // The repo verifies UI by reading handles in a live browser; expose the
    // resolved context and the last capture result the same way.
    effect(() => {
      globalThis.__nostosAssistant = {
        context: this.context(),
        lastCapture: this.lastCapture(),
      };
    });
  }

  open(): void {
    this.anchorDismissed.set(false);
    this.lastError.set(null);
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
    this.pendingAnchor.set(null);
    this.pendingText.set('');
  }

  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  updateDraft(value: string): void {
    this.draft.set(value);
  }

  /**
   * A finished voice transcript enters here and nowhere else. Under the default
   * `review` policy it lands in the composer exactly as if it had been typed, so
   * the user blesses the wording before the one shared `submit()` sends it. A
   * transcript after a follow-up question therefore answers that question through
   * the same path a typed answer takes.
   */
  insertTranscript(text: string): void {
    const transcript = text.trim();
    if (!transcript) return;

    if (TRANSCRIPT_SEND_POLICY === 'auto') {
      this.draft.set(transcript);
      this.submit();
      return;
    }

    const current = this.draft().trim();
    this.draft.set(current ? `${current} ${transcript}` : transcript);
  }

  /** Enter submits; if a follow-up is pending, this is the anchor answer. */
  submit(): void {
    const text = this.draft().trim();
    if (!text || this.sending()) return;

    const pending = this.pendingAnchor();
    if (pending) {
      const original = this.pendingText();
      this.pendingAnchor.set(null);
      this.pendingText.set('');
      this.draft.set('');
      this.performCapture(original, this.anchorFromAnswer(pending.kind, text));
      return;
    }

    const context = this.context();
    const anchor = this.effectiveAnchor(context);
    const question = anchor ? null : this.anchorQuestion(context);
    this.draft.set('');

    if (question) {
      this.pendingText.set(text);
      this.pendingAnchor.set(question);
      this.pushEntry('question', question.question, null, null);
      return;
    }

    this.performCapture(text, anchor);
  }

  /** "I don't know" — never lose the capture to a missing anchor. */
  skipAnchor(): void {
    if (!this.pendingAnchor()) return;
    const text = this.pendingText();
    this.pendingAnchor.set(null);
    this.pendingText.set('');
    this.draft.set('');
    this.performCapture(text, { kind: 'unknown', value: null, verified: false });
  }

  /** Remove a wrong ambient anchor for this session. */
  dismissAnchor(): void {
    this.anchorDismissed.set(true);
  }

  private effectiveAnchor(context: AssistantContext): AssistantAnchor | null {
    if (this.anchorDismissed()) return null;
    return context.anchor;
  }

  /**
   * The only questions this stream asks. No LLM: a known format selects a fixed
   * follow-up, and anything else saves with `unknown` rather than guessing.
   */
  private anchorQuestion(context: AssistantContext): AssistantAnchorPrompt | null {
    if (context.bookFormat === 'physical') {
      return { kind: 'physical_page', question: 'What page are you on?' };
    }
    // An in-app audio reader publishes its own timestamp; only an external
    // audiobook (no in-app reader open) needs to be asked.
    if (context.bookFormat === 'audiobook' && context.readerType !== 'audio') {
      return {
        kind: 'external_audio_timestamp',
        question: "What's the current timestamp?",
      };
    }
    return null;
  }

  private anchorFromAnswer(
    kind: 'physical_page' | 'external_audio_timestamp',
    answer: string,
  ): AssistantAnchor {
    return { kind, value: answer, verified: false };
  }

  private performCapture(text: string, anchor: AssistantAnchor | null): void {
    const context = this.context();
    if (!context.bookId) {
      this.pushEntry('error', text, null, 'Open a book first so the note has somewhere to live.');
      return;
    }

    this.sending.set(true);
    this.captureService
      .capture({
        bookId: context.bookId,
        text,
        selectedText: context.selectedText,
        anchor,
      })
      .subscribe({
        next: (result) => {
          this.sending.set(false);
          this.lastError.set(null);
          this.lastCapture.set(result);
          this.pushEntry('capture', text, this.anchorLabel({ ...context, anchor }), 'Saved');
        },
        error: () => {
          this.sending.set(false);
          this.lastError.set('Could not save that capture. It is still in the composer to retry.');
          this.draft.set(text);
          this.pushEntry('error', text, null, 'Not saved');
        },
      });
  }

  private pushEntry(
    kind: AssistantEntry['kind'],
    text: string,
    anchorLabel: string | null,
    meta: string | null,
  ): void {
    entrySeq += 1;
    this.entries.update((entries) => [
      ...entries,
      { id: `a${entrySeq}`, kind, text, anchorLabel, meta },
    ]);
  }

  /** "The Magic Mountain · p. 183", from the resolved context. */
  private anchorLabel(context: AssistantContext): string | null {
    const anchor = context.anchor;
    if (!anchor || anchor.kind === 'unknown') return null;
    const title = context.bookTitle ?? 'This book';
    switch (anchor.kind) {
      case 'pdf_page':
        return `${title} · p. ${anchor.value}`;
      case 'epub_cfi':
        return `${title} · reading position`;
      case 'audio_timestamp':
        return `${title} · ${formatTimestamp(anchor.value)}`;
      default:
        return title;
    }
  }
}

/** Seconds (as a string) to `m:ss` / `h:mm:ss`. Null-safe and never NaN-y. */
export function formatTimestamp(value: string | null): string {
  const seconds = Math.max(0, Math.floor(Number(value ?? '0')));
  if (!Number.isFinite(seconds)) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}
