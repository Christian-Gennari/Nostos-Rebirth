import { Component, computed, input, output, signal } from '@angular/core';

import { ReadingCaptureType } from '../../../core/dtos/reading-training.dtos';

/**
 * Local view model emitted for the page to forward as `capture` (a
 * ReadingCaptureRequest minus the page-owned clientId/idempotencyKey).
 */
export interface CaptureDraft {
  text: string;
  type: ReadingCaptureType;
}

/** Reader-facing label per server enum value: note, question, excerpt. */
export function captureTypeLabel(type: ReadingCaptureType): string {
  switch (type) {
    case ReadingCaptureType.Question:
      return 'Question';
    case ReadingCaptureType.Bookmark:
      return 'Excerpt';
    default:
      return 'Note';
  }
}

/**
 * Verbatim capture form. The entered text is emitted exactly as typed —
 * including leading and trailing whitespace — and only whitespace-only input
 * is rejected. Pure input/output: no Obsidian, no network, no id generation.
 */
@Component({
  standalone: true,
  selector: 'app-capture-form',
  templateUrl: './capture-form.component.html',
  styleUrl: './capture-form.component.css',
})
export class CaptureFormComponent {
  readonly captureTypeLabel = captureTypeLabel;
  readonly typeEnum = ReadingCaptureType;

  readonly busy = input<boolean>(false);

  readonly capture = output<CaptureDraft>();

  readonly text = signal('');
  readonly type = signal<ReadingCaptureType>(ReadingCaptureType.Thought);
  readonly submitted = signal(false);

  readonly textError = computed(() =>
    this.text().trim() === '' ? 'Enter the passage or thought to save.' : null,
  );
  readonly valid = computed(() => !this.textError());

  onTextInput(event: Event): void {
    this.text.set((event.target as HTMLTextAreaElement).value);
  }

  onTypeChange(event: Event): void {
    this.type.set(Number((event.target as HTMLSelectElement).value) as ReadingCaptureType);
  }

  onSubmit(): void {
    if (!this.valid()) {
      this.submitted.set(true);
      return;
    }
    // Emit the exact text verbatim; only whitespace-only input is rejected.
    this.capture.emit({ text: this.text(), type: this.type() });
  }
}
