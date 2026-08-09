import { Component, computed, input, output, signal } from '@angular/core';

import { ReadingMode, ReadingSession } from '../../../core/dtos/reading-training.dtos';

// Effort and focus are 1–10 per the backend contract
// (Nostos.Backend/Services/ReadingTraining/ReadingTrainingService.cs rejects
// values outside 1–10; the reply prompt is "Effort 1–10? Focus 1–10?").
export const EFFORT_MIN = 1;
export const EFFORT_MAX = 10;
export const FOCUS_MIN = 1;
export const FOCUS_MAX = 10;

/** Typed local event: the page forwards this as `rateSession`. */
export interface RateSessionDraft {
  sessionId: string;
  reportedMinutes: number;
  effort: number;
  focus: number;
}

/** Typed local event: the page forwards this as `skipRatings`. */
export interface SkipRatingsDraft {
  sessionId: string;
}

/** Human label for a server mode value. */
export function modeLabel(mode: ReadingMode): string {
  switch (mode) {
    case ReadingMode.Deep:
      return 'Deep';
    case ReadingMode.Recovery:
      return 'Recovery';
    default:
      return 'Endurance';
  }
}

/** True when raw text is a whole number within [min, max]. */
export function isWholeNumberInRange(raw: string, min: number, max: number): boolean {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return false;
  const value = Number(trimmed);
  return value >= min && value <= max;
}

/**
 * Feedback form for an AwaitingFeedback session. Pure input/output: the page
 * passes the open session, the user reports actual minutes and effort/focus
 * ratings, and the form emits a typed rate or skip intent. It never infers
 * success or outcome — the server decides that from the ratings.
 */
@Component({
  standalone: true,
  selector: 'app-session-feedback',
  templateUrl: './session-feedback.component.html',
  styleUrl: './session-feedback.component.css',
})
export class SessionFeedbackComponent {
  readonly modeLabel = modeLabel;
  readonly effortMax = EFFORT_MAX;
  readonly focusMax = FOCUS_MAX;

  readonly session = input<ReadingSession | null>(null);
  readonly busy = input<boolean>(false);

  readonly rate = output<RateSessionDraft>();
  readonly skip = output<SkipRatingsDraft>();

  readonly reportedMinutes = signal('');
  readonly effort = signal('');
  readonly focus = signal('');
  readonly submitted = signal(false);

  readonly minutesError = computed(() =>
    isWholeNumberInRange(this.reportedMinutes(), 1, Number.MAX_SAFE_INTEGER)
      ? null
      : 'Enter the actual minutes as a whole number (1 or more).',
  );
  readonly effortError = computed(() =>
    isWholeNumberInRange(this.effort(), EFFORT_MIN, EFFORT_MAX)
      ? null
      : `Effort must be a whole number from ${EFFORT_MIN} to ${EFFORT_MAX}.`,
  );
  readonly focusError = computed(() =>
    isWholeNumberInRange(this.focus(), FOCUS_MIN, FOCUS_MAX)
      ? null
      : `Focus must be a whole number from ${FOCUS_MIN} to ${FOCUS_MAX}.`,
  );

  readonly valid = computed(() => !this.minutesError() && !this.effortError() && !this.focusError());

  onMinutesInput(event: Event): void {
    this.reportedMinutes.set((event.target as HTMLInputElement).value);
  }

  onEffortInput(event: Event): void {
    this.effort.set((event.target as HTMLInputElement).value);
  }

  onFocusInput(event: Event): void {
    this.focus.set((event.target as HTMLInputElement).value);
  }

  onRate(): void {
    const session = this.session();
    if (!session) return;
    if (!this.valid()) {
      this.submitted.set(true);
      return;
    }
    this.rate.emit({
      sessionId: session.id,
      reportedMinutes: Number(this.reportedMinutes().trim()),
      effort: Number(this.effort().trim()),
      focus: Number(this.focus().trim()),
    });
  }

  onSkip(): void {
    const session = this.session();
    if (!session) return;
    this.skip.emit({ sessionId: session.id });
  }
}
