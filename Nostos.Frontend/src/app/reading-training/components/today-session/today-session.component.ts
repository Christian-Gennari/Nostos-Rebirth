import { Component, computed, effect, input, output, signal } from '@angular/core';

import { ReadingSession, ReadingSessionStatus } from '../../../core/dtos/reading-training.dtos';

/** Formats whole seconds as mm:ss for display. Never sent back to the server. */
export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

/** Human label for a server status value. */
export function sessionStatusLabel(status: ReadingSessionStatus): string {
  switch (status) {
    case ReadingSessionStatus.Planned:
      return 'Planned';
    case ReadingSessionStatus.Active:
      return 'Active';
    case ReadingSessionStatus.Paused:
      return 'Paused';
    case ReadingSessionStatus.AwaitingFeedback:
      return 'Feedback';
    case ReadingSessionStatus.Completed:
      return 'Completed';
    case ReadingSessionStatus.Cancelled:
      return 'Cancelled';
    default:
      return 'Idle';
  }
}

/**
 * The open-session card. Pure presentation: controls are derived exclusively
 * from the server status enum (never from inferred timing), and every user
 * action is emitted as an event for the page to forward as a typed command.
 * The ticking elapsed value is `aria-live="off"`; command replies render in a
 * separate polite status region.
 */
@Component({
  standalone: true,
  selector: 'app-today-session',
  templateUrl: './today-session.component.html',
  styleUrl: './today-session.component.css',
})
export class TodaySessionComponent {
  readonly formatElapsed = formatElapsed;
  readonly sessionStatusLabel = sessionStatusLabel;
  readonly openSession = input<ReadingSession | null>(null);
  readonly elapsedSeconds = input<number>(0);
  readonly mutating = input<boolean>(false);
  readonly lastReply = input<string | null>(null);

  readonly start = output<void>();
  readonly pause = output<void>();
  readonly resume = output<void>();
  /** Emits the reported actual minutes, or undefined to let the server derive it. */
  readonly complete = output<number | undefined>();
  readonly cancel = output<void>();

  readonly statusEnum = ReadingSessionStatus;
  readonly status = computed(() => this.openSession()?.status ?? ReadingSessionStatus.Idle);

  /**
   * Numeric actual-minutes field, shown while the session is in progress
   * (Active/Paused). Optional: stale sessions — where the server cannot trust
   * the tracked elapsed time — require it, but a blank value is always a
   * valid "let the server derive it" signal.
   */
  readonly reportedMinutes = signal('');

  /** The session the minutes field was last attached to; guards against carrying values across sessions. */
  private minutesSessionId: string | null = null;

  constructor() {
    effect(() => {
      const session = this.openSession();
      const inProgress =
        session !== null &&
        (session.status === ReadingSessionStatus.Active || session.status === ReadingSessionStatus.Paused);
      if (!inProgress) {
        this.reportedMinutes.set('');
        this.minutesSessionId = null;
        return;
      }
      if (this.minutesSessionId !== null && this.minutesSessionId !== session.id) {
        this.reportedMinutes.set('');
      }
      this.minutesSessionId = session.id;
    });
  }

  onMinutesInput(event: Event): void {
    this.reportedMinutes.set((event.target as HTMLInputElement).value);
  }

  onComplete(): void {
    const raw = this.reportedMinutes().trim();
    if (raw === '') {
      this.complete.emit(undefined);
      return;
    }
    const minutes = Number(raw);
    // Only positive, finite values are meaningful; anything else (blank,
    // zero, negative, garbage) defers to the server's derivation.
    this.complete.emit(Number.isFinite(minutes) && minutes > 0 ? minutes : undefined);
  }
}
