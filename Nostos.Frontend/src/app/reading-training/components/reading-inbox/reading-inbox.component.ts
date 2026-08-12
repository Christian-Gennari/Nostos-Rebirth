import { Component, input, output } from '@angular/core';
import { LucideAngularModule, ArrowUpRight, Bookmark, Check, HelpCircle, MessageSquare, X } from 'lucide-angular';

import { ReadingCapture, ReadingCaptureType } from '../../../core/dtos/reading-training.dtos';

/** Icon mapping for capture types (decorative; labels carry the meaning). */
const TYPE_ICONS = {
  [ReadingCaptureType.Thought]: MessageSquare,
  [ReadingCaptureType.Question]: HelpCircle,
  [ReadingCaptureType.Bookmark]: Bookmark,
} as const;

/**
 * The reading inbox: server captures rendered verbatim. The text is never
 * edited, truncated, or re-interpreted — plain Angular interpolation escapes
 * it. Actions are emitted with the exact capture entity so the page can
 * resolve (keep/dismiss) or promote it through the store.
 */
@Component({
  standalone: true,
  selector: 'app-reading-inbox',
  imports: [LucideAngularModule],
  templateUrl: './reading-inbox.component.html',
  styleUrl: './reading-inbox.component.css',
})
export class ReadingInboxComponent {
  readonly CheckIcon = Check;
  readonly PromoteIcon = ArrowUpRight;
  readonly DismissIcon = X;

  readonly captures = input<ReadingCapture[]>([]);
  readonly mutating = input<boolean>(false);
  /** Optional bookId -> title map supplied by the page for display only. */
  readonly bookTitles = input<Record<string, string>>({});

  readonly dismiss = output<ReadingCapture>();
  readonly keepRequested = output<ReadingCapture>();
  readonly promoteRequested = output<ReadingCapture>();

  readonly typeEnum = ReadingCaptureType;
  readonly typeIcons = TYPE_ICONS;

  captureTypeLabel(type: ReadingCaptureType): string {
    switch (type) {
      case ReadingCaptureType.Thought:
        return 'Thought';
      case ReadingCaptureType.Question:
        return 'Question';
      case ReadingCaptureType.Bookmark:
        return 'Bookmark';
      default:
        return 'Capture';
    }
  }

  /** Library book label; falls back to the raw book id when unknown. */
  bookLabel(capture: ReadingCapture): string {
    return this.bookTitles()[capture.bookId] ?? capture.bookId;
  }

  formatTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const day = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return `${day}, ${time}`;
  }
}
