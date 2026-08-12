import { Component, computed, input, output } from '@angular/core';
import { LucideAngularModule, ArrowDown, ArrowUp, Check } from 'lucide-angular';

import {
  ReadingAssignmentStatus,
  ReadingBookAssignment,
  ReadingMode,
} from '../../../core/dtos/reading-training.dtos';

/** One mode group's presentation projection (queue first, finished last). */
export interface ActiveBooksGroup {
  mode: ReadingMode;
  label: string;
  /** Active/Queued assignments sorted by queue order. */
  queue: ReadingBookAssignment[];
  /** Completed/Archived assignments sorted by queue order. */
  finished: ReadingBookAssignment[];
}

/** Reorder event carrying the mode and the mode's full new queue order. */
export interface ActiveBooksReorderEvent {
  mode: ReadingMode;
  assignmentIds: string[];
}

const MODE_LABELS: Record<ReadingMode, string> = {
  [ReadingMode.Endurance]: 'Endurance',
  [ReadingMode.Deep]: 'Deep',
  [ReadingMode.Recovery]: 'Recovery',
};

const MODE_ORDER: readonly ReadingMode[] = [
  ReadingMode.Endurance,
  ReadingMode.Deep,
  ReadingMode.Recovery,
];

/**
 * Training-book queue per mode. Pure presentation: books arrive as server
 * DTOs (library identity = `bookId` + title/author), and every action is
 * emitted for the page to forward as a typed command. Finishing a training
 * book never suggests deleting the library book. Reorder controls are
 * keyboard-safe buttons that emit the mode's full new queue order.
 */
@Component({
  standalone: true,
  selector: 'app-active-books',
  imports: [LucideAngularModule],
  templateUrl: './active-books.component.html',
  styleUrl: './active-books.component.css',
})
export class ActiveBooksComponent {
  readonly ArrowUpIcon = ArrowUp;
  readonly ArrowDownIcon = ArrowDown;
  readonly CheckIcon = Check;

  readonly books = input<ReadingBookAssignment[]>([]);
  readonly mutating = input<boolean>(false);

  readonly setDefault = output<ReadingBookAssignment>();
  readonly finish = output<ReadingBookAssignment>();
  readonly reactivate = output<ReadingBookAssignment>();
  readonly reorder = output<ActiveBooksReorderEvent>();
  readonly addRequested = output<ReadingMode>();

  readonly modeEnum = ReadingMode;
  readonly statusEnum = ReadingAssignmentStatus;

  readonly hasAnyBooks = computed(() => this.books().length > 0);

  readonly groups = computed<ActiveBooksGroup[]>(() =>
    MODE_ORDER.map((mode) => {
      const inMode = this.books()
        .filter((book) => book.mode === mode)
        .sort((a, b) => a.queueOrder - b.queueOrder);
      const queue = inMode.filter(
        (book) => book.status === ReadingAssignmentStatus.Active || book.status === ReadingAssignmentStatus.Queued
      );
      const finished = inMode.filter(
        (book) => book.status === ReadingAssignmentStatus.Completed || book.status === ReadingAssignmentStatus.Archived
      );
      return { mode, label: MODE_LABELS[mode], queue, finished };
    })
  );

  /** Library identity: the title when known, otherwise the library book id. */
  bookTitle(book: ReadingBookAssignment): string {
    return book.bookTitle ?? book.bookId;
  }

  bookAuthor(book: ReadingBookAssignment): string {
    return book.bookAuthor?.trim() ? `by ${book.bookAuthor}` : 'Library book';
  }

  /** Active/Queued assignments can be finished; Completed/Archived cannot. */
  canFinish(book: ReadingBookAssignment): boolean {
    return (
      book.status === ReadingAssignmentStatus.Active || book.status === ReadingAssignmentStatus.Queued
    );
  }

  /** Queued (not yet defaulted) Active books can be made the mode default. */
  canSetDefault(book: ReadingBookAssignment): boolean {
    return book.status === ReadingAssignmentStatus.Active && !book.isDefault;
  }

  moveUp(mode: ReadingMode, index: number): void {
    this.move(mode, index, -1);
  }

  moveDown(mode: ReadingMode, index: number): void {
    this.move(mode, index, 1);
  }

  /**
   * Emits the mode's full new queue order after a one-step move. The backend
   * reorder command owns validation and persistence; this component only
   * derives the requested order from the server-supplied DTOs.
   */
  private move(mode: ReadingMode, index: number, direction: -1 | 1): void {
    const queue = this.groups().find((group) => group.mode === mode)?.queue ?? [];
    const target = index + direction;
    if (target < 0 || target >= queue.length) return;
    const ids = queue.map((book) => book.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(target, 0, moved);
    this.reorder.emit({ mode, assignmentIds: ids });
  }
}
