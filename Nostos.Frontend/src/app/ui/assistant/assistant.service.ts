/**
 * Assistant conversation/session state (issue #261 §3, §5, §6, §7).
 *
 * The backend bridge (`POST /api/assistant/turn`) owns the LLM and the tool
 * loop; this service owns the surface's state: the editorial transcript, the
 * deterministic source-location follow-up, the non-mutating suggestions, and the
 * pending plan that must be approved before anything changes.
 *
 * Two rules are structural, not cosmetic:
 *   - A suggestion never mutates. It is displayed and, when chosen, handed to the
 *     canonical link path as a PlanAndAct proposal that the user approves.
 *   - A pending plan is executed only by an explicit `approvePlan` carrying the
 *     exact plan id and its approval token.
 *
 * `TRANSCRIPT_SEND_POLICY` is unchanged: a voice transcript enters the composer
 * and is dispatched after the grace window, with a pre-dispatch Undo.
 */
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

import {
  AssistantAnchor,
  AssistantContext,
  AssistantContextService,
} from './assistant-context.service';

export interface AssistantEntry {
  id: string;
  kind: 'capture' | 'question' | 'reply' | 'error';
  text: string;
  anchorLabel: string | null;
  meta: string | null;
}

export interface AssistantAnchorPrompt {
  kind: 'physical_page' | 'external_audio_timestamp';
  question: string;
}

/** A non-mutating proposal returned by the bridge. */
export interface AssistantSuggestionDto {
  kind: string;
  label: string;
  reason: string;
  value: string | null;
}

/** One ordered step of a plan awaiting approval. */
export interface AssistantPlanStepDto {
  capability: string;
  summary: string;
  argumentsJson: string;
}

/** A plan the assistant will not run without an explicit approval. */
export interface AssistantPendingPlanDto {
  planId: string;
  summary: string;
  steps: AssistantPlanStepDto[];
  approvalToken: string;
}

export interface AssistantPlanStepOutcomeDto {
  capability: string;
  success: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  data: unknown;
}

/** The result of executing an approved plan. Failures are data. */
export interface AssistantPlanApproveResponse {
  success: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  steps: AssistantPlanStepOutcomeDto[];
}

export interface AssistantAnchorPromptDto {
  kind: string;
  question: string;
}

/** One normal turn result, mirroring `AssistantTurnResponse`. */
export interface AssistantTurnResponse {
  reply: string;
  acknowledgement: string | null;
  anchorPrompt: AssistantAnchorPromptDto | null;
  suggestions: AssistantSuggestionDto[];
  pendingPlan: AssistantPendingPlanDto | null;
}

/** The turn request the bridge accepts. */
interface AssistantTurnRequestDto {
  clientId: string;
  idempotencyKey: string;
  message: string;
  context: AssistantContextDto;
  pendingPlanId: string | null;
}

/** Mirrors the backend `AssistantContextDto` field-for-field. */
interface AssistantContextDto {
  surface: string;
  route: string;
  bookId: string | null;
  bookTitle: string | null;
  bookFormat: string | null;
  readerType: string | null;
  epubCfi: string | null;
  pdfPage: number | null;
  audioTimestamp: number | null;
  audioChapter: string | null;
  selectedText: string | null;
  brainReviewNoteId: string | null;
  concept: string | null;
  collectionId: string | null;
  anchor: { kind: string; value: string | null; verified: boolean } | null;
}

/**
 * What happens to a voice transcript (issue #262 §6).
 *
 * `auto` (the decision): the transcript enters the composer and is dispatched
 * after {@link TRANSCRIPT_AUTO_SEND_DELAY_MS}. While that grace window is open
 * an Undo cancels the dispatch BEFORE anything is sent. Pre-dispatch on purpose:
 * the app has no delete capability, so a capture must never be created wrongly
 * in the first place.
 *
 * `review`: the transcript waits in the composer until the user sends it.
 *
 * ONE SWITCH, deliberately. Both branches converge on `submit()` — the exact
 * entry point a typed message uses — so there is no second send path and no
 * mode asymmetry between an ordinary capture and a follow-up answer.
 */
export const TRANSCRIPT_SEND_POLICY: 'review' | 'auto' = 'auto';

/** The grace window before an auto-sent transcript is dispatched. */
export const TRANSCRIPT_AUTO_SEND_DELAY_MS = 2000;

/** Shape exposed on `globalThis.__nostosAssistant` for live verification. */
export interface NostosAssistantDiagnostics {
  context: AssistantContext;
  lastTurn: AssistantTurnResponse | null;
  suggestions: AssistantSuggestionDto[];
  pendingPlan: AssistantPendingPlanDto | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __nostosAssistant: NostosAssistantDiagnostics | undefined;
}

let entrySeq = 0;

/** A stable per-session id, with a fallback for environments without `crypto.randomUUID`. */
function createId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

@Injectable({ providedIn: 'root' })
export class AssistantService {
  private readonly contextService = inject(AssistantContextService);
  private readonly http = inject(HttpClient);

  /** Stable for the life of the surface; keys the server-held pending plan. */
  private readonly clientId = createId();

  readonly isOpen = signal(false);
  readonly draft = signal('');
  readonly entries = signal<AssistantEntry[]>([]);
  readonly sending = signal(false);
  readonly lastError = signal<string | null>(null);

  /** The most recent turn, for the transcript and live verification. */
  readonly lastTurn = signal<AssistantTurnResponse | null>(null);
  /** Non-mutating concept suggestions for the current turn. */
  readonly suggestions = signal<AssistantSuggestionDto[]>([]);
  /** The plan (if any) waiting for an explicit approval. */
  readonly pendingPlan = signal<AssistantPendingPlanDto | null>(null);
  /** The last approval outcome, kept so the owning surface can react. */
  readonly lastApproval = signal<AssistantPlanApproveResponse | null>(null);

  /**
   * Set by the Second Brain while reviewing a note. Called after an approved
   * plan that links the reviewed note, so the review queue can move on.
   */
  onPlanExecuted: ((plan: AssistantPendingPlanDto, response: AssistantPlanApproveResponse) => void) | null =
    null;

  /** True while an auto transcript is waiting out its Undo window. */
  readonly autoSendPending = signal(false);
  private autoSendTimer: ReturnType<typeof setTimeout> | null = null;

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
    // resolved context, the last turn, the suggestions and the pending plan.
    effect(() => {
      globalThis.__nostosAssistant = {
        context: this.context(),
        lastTurn: this.lastTurn(),
        suggestions: this.suggestions(),
        pendingPlan: this.pendingPlan(),
      };
    });
  }

  open(): void {
    this.anchorDismissed.set(false);
    this.lastError.set(null);
    this.isOpen.set(true);
  }

  close(): void {
    // Closing abandons a pending auto-send as well as a live recording: nothing
    // is dispatched behind a surface the user can no longer Undo from.
    this.cancelAutoSend();
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
   * A finished voice transcript enters here and nowhere else. It lands in the
   * composer exactly as if it had been typed; under `auto` it is then dispatched
   * after the grace window, through the one shared `submit()`.
   */
  insertTranscript(text: string): void {
    const transcript = text.trim();
    if (!transcript) return;

    const current = this.draft().trim();
    this.draft.set(current ? `${current} ${transcript}` : transcript);

    if (TRANSCRIPT_SEND_POLICY === 'auto') this.scheduleAutoSend();
  }

  /**
   * Pre-dispatch Undo: stop the pending auto-send before anything is sent. The
   * transcript stays in the composer, editable, exactly where the user can fix
   * it — which is the point, because a created capture cannot be deleted.
   */
  undoTranscript(): void {
    this.cancelAutoSend();
  }

  private scheduleAutoSend(): void {
    this.cancelAutoSend();
    this.autoSendPending.set(true);
    this.autoSendTimer = setTimeout(() => {
      this.autoSendTimer = null;
      this.autoSendPending.set(false);
      this.submit();
    }, TRANSCRIPT_AUTO_SEND_DELAY_MS);
  }

  private cancelAutoSend(): void {
    if (this.autoSendTimer !== null) {
      clearTimeout(this.autoSendTimer);
      this.autoSendTimer = null;
    }
    this.autoSendPending.set(false);
  }

  /** Enter submits; if a follow-up is pending, this is the anchor answer. */
  submit(): void {
    // A manual send consumes the pending window; the same call the timer makes
    // is a no-op here because it already cleared its own timer.
    this.cancelAutoSend();
    const text = this.draft().trim();
    if (!text || this.sending()) return;

    const pending = this.pendingAnchor();
    if (pending) {
      const original = this.pendingText();
      this.pendingAnchor.set(null);
      this.pendingText.set('');
      this.draft.set('');
      this.dispatchTurn(original, this.anchorFromAnswer(pending.kind, text));
      return;
    }

    const context = this.context();
    const anchor = this.effectiveAnchor(context);
    const question = anchor ? null : this.anchorQuestion(context);
    this.draft.set('');

    if (question) {
      // The deterministic local follow-up: no LLM round trip is spent asking for
      // a location the format cannot supply.
      this.pendingText.set(text);
      this.pendingAnchor.set(question);
      this.pushEntry('question', question.question, null, null);
      return;
    }

    this.dispatchTurn(text, anchor);
  }

  /** "I don't know" — never lose the capture to a missing anchor. */
  skipAnchor(): void {
    if (!this.pendingAnchor()) return;
    const text = this.pendingText();
    this.pendingAnchor.set(null);
    this.pendingText.set('');
    this.draft.set('');
    this.dispatchTurn(text, { kind: 'unknown', value: null, verified: false });
  }

  /** Remove a wrong ambient anchor for this session. */
  dismissAnchor(): void {
    this.anchorDismissed.set(true);
  }

  /**
   * The Brain review affordance: open the assistant and ask it where the
   * reviewed note belongs. The review-note context is supplied by the Second
   * Brain's provider, so the turn knows which note is under review.
   */
  requestSuggestions(prompt = 'Where do you think this belongs?'): void {
    this.open();
    this.updateDraft(prompt);
    this.submit();
  }

  /**
   * Choose a non-mutating suggestion. Linking is state-changing, so this hands
   * the choice to the canonical PlanAndAct path: the assistant proposes
   * `notes_link_existing_concept` and nothing runs until the user approves the
   * plan. The assistant never links a note on its own.
   */
  applySuggestion(suggestion: AssistantSuggestionDto): void {
    if (suggestion.kind !== 'concept' || !suggestion.value) return;

    if (!this.context().brainReviewNoteId) {
      this.lastError.set('Open the note in the Second Brain so the link has a target.');
      return;
    }

    const context = this.context();
    this.dispatchTurn(
      `Link the note I am reviewing to the existing concept “${suggestion.label}”.`,
      this.effectiveAnchor(context),
    );
  }

  /** "None of these": leave the note unlinked, with no error. */
  dismissSuggestions(): void {
    this.suggestions.set([]);
  }

  /**
   * Execute exactly one pending plan through
   * `POST /api/assistant/plan/approve`. The plan id and its approval token are
   * both required; the server refuses a mismatch and mutates nothing.
   */
  approvePlan(planId: string, approvalToken: string): void {
    if (!planId || !approvalToken || this.sending()) return;

    const plan = this.pendingPlan();
    this.sending.set(true);
    this.http
      .post<AssistantPlanApproveResponse>('/api/assistant/plan/approve', { planId, approvalToken })
      .subscribe({
        next: (response) => {
          this.sending.set(false);
          this.lastError.set(null);
          this.lastApproval.set(response);

          if (response.success) {
            this.pendingPlan.set(null);
            this.pushEntry('reply', plan?.summary ?? 'Plan applied.', null, 'Applied');
          } else {
            this.lastError.set(response.errorMessage ?? 'The plan could not be applied.');
            this.pushEntry('error', plan?.summary ?? 'Plan refused.', null, response.errorCode ?? 'Refused');
          }

          if (plan && this.onPlanExecuted) this.onPlanExecuted(plan, response);
        },
        error: () => {
          this.sending.set(false);
          this.lastError.set('The plan could not be applied. It is still waiting for approval.');
        },
      });
  }

  private dispatchTurn(text: string, anchor: AssistantAnchor | null): void {
    const context = this.context();
    const request: AssistantTurnRequestDto = {
      clientId: this.clientId,
      idempotencyKey: createId(),
      message: text,
      context: toContextDto(context, anchor),
      pendingPlanId: this.pendingPlan()?.planId ?? null,
    };

    this.sending.set(true);
    this.http.post<AssistantTurnResponse>('/api/assistant/turn', request).subscribe({
      next: (response) => {
        this.sending.set(false);
        this.lastError.set(null);
        this.lastTurn.set(response);
        this.suggestions.set(response.suggestions ?? []);
        this.pendingPlan.set(response.pendingPlan ?? null);

        if (response.acknowledgement) {
          this.pushEntry('capture', text, this.anchorLabel({ ...context, anchor }), 'Saved');
        }

        if (response.reply) {
          this.pushEntry('reply', response.reply, null, null);
        }

        // A backend-requested location arrives as the same deterministic
        // follow-up the surface already knows how to ask.
        if (response.anchorPrompt) {
          const kind = response.anchorPrompt.kind;
          if (kind === 'physical_page' || kind === 'external_audio_timestamp') {
            this.pendingText.set(text);
            this.pendingAnchor.set({ kind, question: response.anchorPrompt.question });
          }
          this.pushEntry('question', response.anchorPrompt.question, null, null);
        }
      },
      error: () => {
        this.sending.set(false);
        this.lastError.set('The assistant could not be reached. Your message is still in the composer to retry.');
        this.draft.set(text);
        this.pushEntry('error', text, null, 'Not sent');
      },
    });
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

/**
 * Builds the wire context, applying the turn's anchor (the composer may have
 * answered a follow-up) over the ambient one.
 */
function toContextDto(context: AssistantContext, anchor: AssistantAnchor | null): AssistantContextDto {
  return {
    surface: context.surface,
    route: context.route,
    bookId: context.bookId,
    bookTitle: context.bookTitle,
    bookFormat: context.bookFormat,
    readerType: context.readerType,
    epubCfi: context.epubCfi,
    pdfPage: context.pdfPage,
    audioTimestamp: context.audioTimestamp,
    audioChapter: context.audioChapter,
    selectedText: context.selectedText,
    brainReviewNoteId: context.brainReviewNoteId,
    concept: context.concept,
    collectionId: context.collectionId,
    anchor: anchor ? { kind: anchor.kind, value: anchor.value, verified: anchor.verified } : null,
  };
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
