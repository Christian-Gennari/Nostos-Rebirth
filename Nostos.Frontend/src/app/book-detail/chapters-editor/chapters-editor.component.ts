import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import {
  ArrowDown,
  ArrowUp,
  ClipboardPaste,
  GripVertical,
  LucideAngularModule,
  Plus,
  Trash2,
} from 'lucide-angular';
import { BookChapter } from '../../core/dtos/book.dtos';

/** One pasted line, parsed as far as it could be. */
export interface ParsedChapterLine {
  raw: string;
  title: string;
  /** Seconds, or null when the line had no readable timestamp. */
  startTime: number | null;
}

/**
 * `HH:MM:SS`, `MM:SS` or a bare number of seconds -> seconds. Null when the text is
 * not a time at all, so an unparseable line can be shown as invalid rather than
 * silently becoming 0:00:00 (issue #8's "highlight the row red, don't submit").
 */
export function parseTimestamp(value: string): number | null {
  const text = value.trim();
  if (!text) return null;

  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);

  const parts = text.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((part) => /^\d+$/.test(part.trim()))) return null;

  const numbers = parts.map((part) => Number(part.trim()));
  const [hours, minutes, seconds] = parts.length === 3 ? numbers : [0, numbers[0], numbers[1]];
  if (minutes > 59 || seconds > 59) return null;

  return hours * 3600 + minutes * 60 + seconds;
}

/** Seconds -> `HH:MM:SS`, the form the timestamp column edits in. */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return [hours, minutes, secs].map((part) => part.toString().padStart(2, '0')).join(':');
}

/**
 * Bulk paste: one chapter per line, `timestamp` then `name`. The time is the first
 * whitespace-separated token; everything after it is the name, spaces and all.
 * Blank lines are skipped; a line whose first token is not a time keeps its text
 * with a null startTime so the row renders as invalid instead of vanishing.
 */
export function parseChapterLines(text: string): ParsedChapterLine[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((raw) => {
      const match = raw.match(/^(\S+)\s*(.*)$/);
      const token = match?.[1] ?? '';
      const rest = (match?.[2] ?? '').trim();
      const startTime = parseTimestamp(token);

      return startTime === null
        ? // Nothing readable: keep the whole line as the name so the user's text is
          // not half-eaten, and leave the timestamp empty for them to fill in.
          { raw, title: raw, startTime: null }
        : { raw, title: rest, startTime };
    });
}

interface ChapterRow {
  title: string;
  /** Edited as text so a half-typed timestamp is not silently rewritten. */
  timeText: string;
}

/** The row error, or null when the row is complete. */
function rowError(row: ChapterRow, index: number, rows: ChapterRow[]): string | null {
  if (!row.title.trim()) return 'Needs a name';
  const start = parseTimestamp(row.timeText);
  if (start === null) return 'Invalid timestamp';
  if (index > 0) {
    const previous = parseTimestamp(rows[index - 1].timeText);
    if (previous !== null && start <= previous) return 'Must start after the previous chapter';
  }
  return null;
}

/**
 * Chapter editing for audiobooks whose file carries none (issue #8). The list is
 * hand-made once saved, so the backend stops letting the file's own metadata
 * overwrite it.
 */
@Component({
  selector: 'app-chapters-editor',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './chapters-editor.component.html',
  styleUrl: './chapters-editor.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChaptersEditor {
  /** The book's current chapters, as the API returned them. */
  chapters = input<BookChapter[]>([]);
  /** True while the parent is saving, so the buttons can settle. */
  saving = input(false);

  /** Emits the replacement list; `[]` means "clear and use the file's metadata". */
  save = output<BookChapter[]>();

  icons = { ArrowDown, ArrowUp, ClipboardPaste, GripVertical, Plus, Trash2 };

  rows = signal<ChapterRow[]>([]);
  bulkText = signal('');
  bulkOpen = signal(false);
  dragIndex = signal<number | null>(null);
  /** Set when the input list changes, so a re-render does not clobber edits. */
  private loadedFrom: BookChapter[] | null = null;

  constructor() {
    // The parent loads the book asynchronously; adopt it once, then leave the rows
    // alone so an in-flight edit is never overwritten by a re-render.
    effect(() => {
      const incoming = this.chapters();
      if (incoming === this.loadedFrom) return;
      this.loadedFrom = incoming;
      this.rows.set(
        incoming.map((chapter) => ({
          title: chapter.title,
          timeText: formatTimestamp(chapter.startTime),
        }))
      );
    });
  }

  errors = computed(() => {
    const rows = this.rows();
    return rows.map((row, index) => rowError(row, index, rows));
  });

  /** Any bad row blocks the save: a malformed list is rejected by the API too. */
  canSave = computed(() => this.rows().length > 0 && this.errors().every((error) => error === null));

  hasErrors = computed(() => this.errors().some((error) => error !== null));

  setTitle(index: number, title: string): void {
    this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, title } : row)));
  }

  setTime(index: number, timeText: string): void {
    this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, timeText } : row)));
  }

  addRow(): void {
    this.rows.update((rows) => {
      const last = rows[rows.length - 1];
      const previousStart = last ? parseTimestamp(last.timeText) : null;
      return [
        ...rows,
        {
          title: '',
          timeText: formatTimestamp(previousStart === null ? 0 : previousStart + 60),
        },
      ];
    });
  }

  removeRow(index: number): void {
    this.rows.update((rows) => rows.filter((_, i) => i !== index));
  }

  move(index: number, delta: number): void {
    const target = index + delta;
    const rows = this.rows();
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    this.rows.set(next);
  }

  onDragStart(index: number): void {
    this.dragIndex.set(index);
  }

  onDrop(index: number): void {
    const from = this.dragIndex();
    this.dragIndex.set(null);
    if (from === null || from === index) return;
    const next = [...this.rows()];
    const [moved] = next.splice(from, 1);
    next.splice(index, 0, moved);
    this.rows.set(next);
  }

  applyBulkPaste(): void {
    const parsed = parseChapterLines(this.bulkText());
    if (parsed.length === 0) return;
    this.rows.set(
      parsed.map((line) => ({
        title: line.title,
        timeText: line.startTime === null ? '' : formatTimestamp(line.startTime),
      }))
    );
    this.bulkText.set('');
    this.bulkOpen.set(false);
  }

  submit(): void {
    if (!this.canSave()) return;
    this.save.emit(
      this.rows().map((row) => ({
        title: row.title.trim(),
        startTime: parseTimestamp(row.timeText) ?? 0,
      }))
    );
  }

  /** Hand the book back to its file's own chapters. */
  clear(): void {
    this.save.emit([]);
  }
}
