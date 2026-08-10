import { Component, computed, effect, input, output, signal } from '@angular/core';

import {
  ReadingBookAssignment,
  ReadingConstraint,
  ReadingMode,
} from '../../../core/dtos/reading-training.dtos';

/**
 * Local view model emitted by the planner. The page decides whether to forward
 * it as `planSession` (book + mode + target, with an optional constraint) or
 * as `startNewSession` (book + mode). `constraint` is TimeConstrained exactly
 * when the user enabled a constrained session and the chosen mode is not
 * Recovery; `constrainedMinutes` carries the constrained target for the page
 * to use as `targetMinutes` when a constraint applies. No ids are generated
 * here: every id is taken from the `books` input.
 */
export interface SessionPlanDraft {
  bookAssignmentId: string;
  mode: ReadingMode;
  targetMinutes: number;
  constraint: ReadingConstraint;
  constrainedMinutes: number | null;
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

/** True when raw text is a whole number of minutes of 1 or more. */
export function isPositiveWholeMinutes(raw: string): boolean {
  const trimmed = raw.trim();
  return /^\d+$/.test(trimmed) && Number(trimmed) >= 1;
}

/**
 * Standalone session planner. Pure input/output: eligible assignments come in
 * through `books` (pre-filtered by the page), defaults derive only from those
 * inputs (`preferredMode` or the first book's mode), and the user's choice is
 * emitted as a typed draft. No store, no HTTP, no id generation.
 */
@Component({
  standalone: true,
  selector: 'app-session-planner',
  templateUrl: './session-planner.component.html',
  styleUrl: './session-planner.component.css',
})
export class SessionPlannerComponent {
  readonly modeLabel = modeLabel;
  readonly modeEnum = ReadingMode;
  readonly constraintEnum = ReadingConstraint;

  /** Eligible assignments for a new session, pre-filtered by the page. */
  readonly books = input<ReadingBookAssignment[]>([]);
  /** Optional mode hint from the page/store; used only until the user picks a mode. */
  readonly preferredMode = input<ReadingMode | null>(null);
  readonly busy = input<boolean>(false);

  readonly plan = output<SessionPlanDraft>();
  readonly startNew = output<SessionPlanDraft>();
  readonly close = output<void>();

  readonly selectedAssignmentId = signal('');
  readonly mode = signal<ReadingMode | null>(null);
  readonly targetMinutes = signal('');
  readonly constrained = signal(false);
  readonly constrainedMinutes = signal('');
  readonly submitted = signal(false);

  readonly selectedBook = computed(
    () => this.books().find((book) => book.id === this.selectedAssignmentId()) ?? null,
  );

  readonly recovery = computed(() => this.mode() === ReadingMode.Recovery);

  readonly bookError = computed(() =>
    this.selectedBook() ? null : 'Choose a book to train.',
  );
  readonly targetError = computed(() =>
    isPositiveWholeMinutes(this.targetMinutes())
      ? null
      : 'Enter a whole number of minutes (1 or more).',
  );
  readonly constrainedError = computed(() => {
    if (!this.constrained() || this.recovery()) return null;
    return isPositiveWholeMinutes(this.constrainedMinutes())
      ? null
      : 'Constrained minutes must be a whole number (1 or more).';
  });

  readonly valid = computed(
    () => !this.bookError() && !this.targetError() && !this.constrainedError(),
  );

  constructor() {
    // Defaults come only from inputs: select the first eligible assignment and
    // the preferred (or first book's) mode, and never clobber a user choice.
    effect(() => {
      const list = this.books();
      if (list.length === 0) return;
      if (!list.some((book) => book.id === this.selectedAssignmentId())) {
        this.selectedAssignmentId.set(list[0].id);
      }
    });
    effect(() => {
      if (this.mode() !== null) return;
      const list = this.books();
      if (list.length > 0) {
        this.mode.set(this.preferredMode() ?? list[0].mode);
      }
    });
  }

  onAssignmentChange(event: Event): void {
    this.selectedAssignmentId.set((event.target as HTMLSelectElement).value);
  }

  onModeChange(event: Event): void {
    this.mode.set(Number((event.target as HTMLSelectElement).value) as ReadingMode);
  }

  onTargetInput(event: Event): void {
    this.targetMinutes.set((event.target as HTMLInputElement).value);
  }

  onConstrainedToggle(event: Event): void {
    this.constrained.set((event.target as HTMLInputElement).checked);
  }

  onConstrainedMinutesInput(event: Event): void {
    this.constrainedMinutes.set((event.target as HTMLInputElement).value);
  }

  draft(): SessionPlanDraft {
    const constrained =
      this.constrained() && !this.recovery() && isPositiveWholeMinutes(this.constrainedMinutes());
    return {
      bookAssignmentId: this.selectedBook()?.id ?? '',
      mode: this.mode() ?? ReadingMode.Endurance,
      targetMinutes: Number(this.targetMinutes().trim()),
      constraint: constrained ? ReadingConstraint.TimeConstrained : ReadingConstraint.None,
      constrainedMinutes: constrained ? Number(this.constrainedMinutes().trim()) : null,
    };
  }

  onSubmit(intent: 'plan' | 'startNew'): void {
    if (!this.valid()) {
      this.submitted.set(true);
      return;
    }
    const draft = this.draft();
    if (intent === 'plan') {
      this.plan.emit(draft);
    } else {
      this.startNew.emit(draft);
    }
  }
}
