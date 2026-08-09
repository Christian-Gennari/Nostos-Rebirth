import { Component, computed, input, signal } from '@angular/core';

import {
  ReadingConstraint,
  ReadingMode,
  ReadingSession,
  ReadingSessionStatus,
} from '../../../core/dtos/reading-training.dtos';

const MODE_LABELS: Record<ReadingMode, string> = {
  [ReadingMode.Endurance]: 'Endurance',
  [ReadingMode.Deep]: 'Deep',
  [ReadingMode.Recovery]: 'Recovery',
};

/** Newest-first sort key: completion time when available, else plan time. */
function sortKey(session: ReadingSession): number {
  const iso = session.completedAt ?? session.plannedAt;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Session history. Pure presentation: filters are client-side only, the view
 * is newest-first over a copied list (the input array is never mutated), and
 * ratings appear only when the server supplied them. Constrained sessions get
 * a neutral label; the server's `countsAsFailure` flag is never rendered as a
 * badge — the manual UI avoids guilt framing entirely.
 */
@Component({
  standalone: true,
  selector: 'app-session-history',
  templateUrl: './session-history.component.html',
  styleUrl: './session-history.component.css',
})
export class SessionHistoryComponent {
  readonly sessions = input<ReadingSession[]>([]);

  readonly modeFilter = signal<ReadingMode | 'all'>('all');
  readonly statusFilter = signal<ReadingSessionStatus | 'all'>('all');
  readonly bookFilter = signal('');

  readonly modeEnum = ReadingMode;
  readonly statusEnum = ReadingSessionStatus;
  readonly constraintEnum = ReadingConstraint;

  readonly modeOptions: ReadonlyArray<{ value: ReadingMode | 'all'; label: string }> = [
    { value: 'all', label: 'All modes' },
    { value: ReadingMode.Endurance, label: 'Endurance' },
    { value: ReadingMode.Deep, label: 'Deep' },
    { value: ReadingMode.Recovery, label: 'Recovery' },
  ];

  readonly statusOptions: ReadonlyArray<{ value: ReadingSessionStatus | 'all'; label: string }> = [
    { value: 'all', label: 'All statuses' },
    { value: ReadingSessionStatus.Completed, label: 'Completed' },
    { value: ReadingSessionStatus.Cancelled, label: 'Cancelled' },
  ];

  readonly hasSessions = computed(() => this.sessions().length > 0);
  readonly hasActiveFilters = computed(
    () =>
      this.modeFilter() !== 'all' ||
      this.statusFilter() !== 'all' ||
      this.bookFilter().trim() !== ''
  );
  readonly noMatch = computed(() => this.hasSessions() && this.filteredSessions().length === 0);

  /** Newest-first copy of the input, filtered by mode/status/book text. */
  readonly filteredSessions = computed<ReadingSession[]>(() => {
    const mode = this.modeFilter();
    const status = this.statusFilter();
    const text = this.bookFilter().trim().toLowerCase();
    return [...this.sessions()]
      .sort((a, b) => sortKey(b) - sortKey(a))
      .filter(
        (session) =>
          (mode === 'all' || session.mode === mode) &&
          (status === 'all' || session.status === status) &&
          (text === '' || `${session.bookTitle ?? ''} ${session.bookId}`.toLowerCase().includes(text))
      );
  });

  onModeChange(event: Event): void {
    this.modeFilter.set(this.parseMode((event.target as HTMLSelectElement).value));
  }

  onStatusChange(event: Event): void {
    this.statusFilter.set(this.parseStatus((event.target as HTMLSelectElement).value));
  }

  onBookInput(event: Event): void {
    this.bookFilter.set((event.target as HTMLInputElement).value);
  }

  clearFilters(): void {
    this.modeFilter.set('all');
    this.statusFilter.set('all');
    this.bookFilter.set('');
  }

  modeLabel(mode: ReadingMode): string {
    return MODE_LABELS[mode];
  }

  constraintLabel(constraint: ReadingConstraint): string | null {
    switch (constraint) {
      case ReadingConstraint.TimeConstrained:
        return 'Time-constrained';
      case ReadingConstraint.FatigueConstrained:
        return 'Fatigue-constrained';
      default:
        return null;
    }
  }

  statusLabel(status: ReadingSessionStatus): string | null {
    switch (status) {
      case ReadingSessionStatus.Completed:
        return 'Completed';
      case ReadingSessionStatus.Cancelled:
        return 'Cancelled';
      case ReadingSessionStatus.AwaitingFeedback:
        return 'Awaiting feedback';
      default:
        return null;
    }
  }

  /** Actual minutes: reported override when present, else measured seconds. */
  sessionMinutes(session: ReadingSession): number {
    if (session.reportedMinutes !== null) return session.reportedMinutes;
    return Math.round(session.measuredSeconds / 60);
  }

  /** Ratings are shown only when the server supplied effort/focus. */
  hasRatings(session: ReadingSession): boolean {
    return session.effort > 0 || session.focus > 0;
  }

  sessionDate(session: ReadingSession): string {
    const iso = session.completedAt ?? session.plannedAt;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  private parseMode(value: string): ReadingMode | 'all' {
    return value === 'all' ? 'all' : (Number(value) as ReadingMode);
  }

  private parseStatus(value: string): ReadingSessionStatus | 'all' {
    return value === 'all' ? 'all' : (Number(value) as ReadingSessionStatus);
  }
}
