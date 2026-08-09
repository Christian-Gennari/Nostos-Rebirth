import { Component, computed, input, output } from '@angular/core';

import { ReadingNotification } from '../../../core/dtos/reading-training.dtos';

/** Numeric ReadingMode values (matches Nostos.Shared/Enums). */
const MODE_LABELS: Readonly<Record<number, string>> = {
  0: 'Endurance',
  1: 'Deep',
  2: 'Recovery',
};

/**
 * Display-only render of one notice payload. The wire payload may be a typed
 * object or a JSON string (the outbox persists PayloadJson), so parsing is
 * defensive and never throws. Facts are extracted only for the known
 * target-reached shape; anything else degrades to a restrained fallback that
 * exposes neither raw JSON nor internal identifiers.
 */
export interface ReadingNoticePresentation {
  kind: 'target-reached' | 'fallback';
  modeLabel: string | null;
  bookId: string | null;
  sessionId: string | null;
  targetMinutes: number | null;
  elapsedLabel: string | null;
}

export interface PendingNoticeEntry {
  notice: ReadingNotification;
  facts: ReadingNoticePresentation;
}

const FALLBACK: ReadingNoticePresentation = Object.freeze({
  kind: 'fallback',
  modeLabel: null,
  bookId: null,
  sessionId: null,
  targetMinutes: null,
  elapsedLabel: null,
});

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JSON strings are parsed safely; anything else passes through untouched. */
function parsePayload(payload: unknown): unknown {
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }
  return payload;
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

/** Display-only parsing of a notice payload. Never throws. */
export function presentNotice(notice: ReadingNotification): ReadingNoticePresentation {
  const raw = parsePayload(notice.payload);
  if (!isRecord(raw)) {
    return FALLBACK;
  }

  const modeLabel = isFiniteNumber(raw['mode']) ? (MODE_LABELS[raw['mode']] ?? null) : null;
  const targetMinutes = raw['plannedTargetMinutes'];
  const elapsedSeconds = raw['effectiveElapsedSeconds'];
  if (
    modeLabel === null ||
    !isFiniteNumber(targetMinutes) ||
    targetMinutes < 0 ||
    !isFiniteNumber(elapsedSeconds) ||
    elapsedSeconds < 0
  ) {
    return FALLBACK;
  }

  return {
    kind: 'target-reached',
    modeLabel,
    bookId: isNonEmptyString(raw['bookId']) ? raw['bookId'] : null,
    sessionId: isNonEmptyString(raw['sessionId']) ? raw['sessionId'] : null,
    targetMinutes,
    elapsedLabel: formatElapsed(elapsedSeconds),
  };
}

/**
 * Pending leased reading notices, rendered as quiet server-owned notices.
 * Purely presentational: notices are displayed in input order and never
 * mutated or removed locally; acknowledging emits the exact notice entity so
 * the page can resolve it through the store.
 */
@Component({
  standalone: true,
  selector: 'app-pending-notices',
  templateUrl: './pending-notices.component.html',
  styleUrl: './pending-notices.component.css',
})
export class PendingNoticesComponent {
  readonly notices = input<ReadingNotification[]>([]);
  readonly busy = input<boolean>(false);

  readonly acknowledge = output<ReadingNotification>();

  /** Display-only render of each notice; the input array is never mutated. */
  readonly entries = computed<PendingNoticeEntry[]>(() =>
    this.notices().map((notice) => ({ notice, facts: presentNotice(notice) }))
  );

  readonly count = computed(() => this.notices().length);

  /** Polite announcement of the notice count/state (never a clock). */
  readonly liveStatus = computed(() => {
    const count = this.count();
    if (count === 0) {
      return 'No reading notices waiting.';
    }
    return count === 1 ? '1 reading notice waiting.' : `${count} reading notices waiting.`;
  });

  /** Short display id: keeps long internal identifiers out of visible text. */
  shortId(id: string): string {
    return id.slice(0, 8);
  }

  /** Accessible label for an acknowledge button. */
  acknowledgeLabel(facts: ReadingNoticePresentation): string {
    if (facts.kind !== 'target-reached') {
      return 'Acknowledge reading notice';
    }
    const detail = [facts.modeLabel, facts.elapsedLabel].filter(
      (value): value is string => value !== null
    );
    return detail.length > 0
      ? `Acknowledge reading notice: ${detail.join(', ')}`
      : 'Acknowledge reading notice';
  }
}
