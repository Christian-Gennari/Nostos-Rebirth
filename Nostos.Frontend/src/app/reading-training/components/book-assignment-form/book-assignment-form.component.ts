import { Component, computed, effect, input, output, signal } from '@angular/core';

import { ReadingMode } from '../../../core/dtos/reading-training.dtos';

/** A book the user may assign, as supplied by the page (never built here). */
export interface AvailableBook {
  bookId: string;
  title: string;
  author: string | null;
}

/**
 * Local view model emitted for the page to forward as `addBook` (a
 * ReadingAddBookAssignmentRequest minus the page-owned clientId and
 * idempotencyKey).
 */
export interface BookAssignmentDraft {
  bookId: string;
  mode: ReadingMode;
  makeDefault: boolean;
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

/**
 * Standalone book-assignment form. Pure input/output: the page supplies the
 * available Nostos books, and the form emits a typed add-book draft including
 * the queue/default intent (`makeDefault`) when the user opts in. The optional
 * `preferredMode` input (e.g. the lane that requested the dialog) seeds the
 * mode default and keeps driving it only until the user picks a mode.
 */
@Component({
  standalone: true,
  selector: 'app-book-assignment-form',
  templateUrl: './book-assignment-form.component.html',
  styleUrl: './book-assignment-form.component.css',
})
export class BookAssignmentFormComponent {
  readonly modeLabel = modeLabel;
  readonly modeEnum = ReadingMode;

  /** Books the user may assign, supplied by the page. */
  readonly availableBooks = input<AvailableBook[]>([]);
  /** Optional mode hint (e.g. the lane that requested the dialog); used only until the user picks a mode. */
  readonly preferredMode = input<ReadingMode | null>(null);
  readonly busy = input<boolean>(false);

  readonly add = output<BookAssignmentDraft>();

  readonly selectedBookId = signal('');
  readonly mode = signal<ReadingMode>(ReadingMode.Endurance);
  readonly makeDefault = signal(false);
  readonly submitted = signal(false);

  /** True once the user has explicitly picked a mode; `preferredMode` then stops driving `mode`. */
  private readonly userChoseMode = signal(false);

  readonly bookError = computed(() =>
    this.selectedBookId() === '' ? 'Choose a book to assign.' : null,
  );
  readonly valid = computed(() => !this.bookError());

  constructor() {
    // Defaults come only from inputs: select the first available book and never
    // clobber a user choice.
    effect(() => {
      const list = this.availableBooks();
      if (list.length === 0) return;
      if (!list.some((book) => book.bookId === this.selectedBookId())) {
        this.selectedBookId.set(list[0].bookId);
      }
    });

    // The preferred mode drives the initial default and follows later input
    // changes — but only until the user makes an explicit choice, which is
    // tracked separately and never clobbered.
    effect(() => {
      const preferred = this.preferredMode();
      if (preferred !== null && !this.userChoseMode()) {
        this.mode.set(preferred);
      }
    });
  }

  onBookChange(event: Event): void {
    this.selectedBookId.set((event.target as HTMLSelectElement).value);
  }

  onModeChange(event: Event): void {
    this.userChoseMode.set(true);
    this.mode.set(Number((event.target as HTMLSelectElement).value) as ReadingMode);
  }

  onMakeDefaultToggle(event: Event): void {
    this.makeDefault.set((event.target as HTMLInputElement).checked);
  }

  onSubmit(): void {
    if (!this.valid()) {
      this.submitted.set(true);
      return;
    }
    this.add.emit({
      bookId: this.selectedBookId(),
      mode: this.mode(),
      makeDefault: this.makeDefault(),
    });
  }
}
