import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

import { ProcessingMode } from './assistant.service';

/** The wire shape of `GET /api/settings/assistant` — one stored preference. */
export interface AssistantSettingsDto {
  captureProcessingMode: string;
}

/** The three wire values, as a lookup the type guard can check against. */
const PROCESSING_MODE_VALUES: readonly ProcessingMode[] = ['verbatim', 'light_polish', 'clarify'];

/** Narrows an arbitrary server string to a mode this client can render. */
export function isProcessingMode(value: unknown): value is ProcessingMode {
  return typeof value === 'string' && PROCESSING_MODE_VALUES.includes(value as ProcessingMode);
}

/**
 * The stored capture-processing preference (issue #262).
 *
 * The mode used to be a per-capture choice in the widget; it is now a global
 * setting the user picks once. The server applies it at capture time and stores
 * it, so this service is only a read/write view of that one value — the server is
 * the authority on what was stored, and the signal adopts the value it returns
 * rather than the value the user asked for.
 *
 * `verbatim` until the server answers: it is the server's default, and showing a
 * rewrite that is not in force would be a guess.
 */
@Injectable({ providedIn: 'root' })
export class AssistantSettingsService {
  private readonly http = inject(HttpClient);

  /** The stored mode, as the server last reported it. */
  readonly captureProcessingMode = signal<ProcessingMode>('verbatim');

  /** True when the GET failed, so the card can say so instead of showing a wrong value. */
  readonly loadFailed = signal(false);

  /** True when the last PUT failed; the previous value stays in force. */
  readonly saveFailed = signal(false);

  private requested = false;

  /** Fetches the setting once per session; later visits reuse the answer. */
  ensureLoaded(): void {
    if (this.requested) return;
    this.requested = true;
    this.refresh();
  }

  /** Refetches the setting, so a settings visit reflects the server as it is now. */
  refresh(): void {
    this.http.get<AssistantSettingsDto>('/api/settings/assistant').subscribe({
      next: (settings) => {
        this.captureProcessingMode.set(
          isProcessingMode(settings.captureProcessingMode)
            ? settings.captureProcessingMode
            : 'verbatim',
        );
        this.loadFailed.set(false);
      },
      error: () => this.loadFailed.set(true),
    });
  }

  /** Stores the chosen mode; the signal adopts whatever the server reports back. */
  setCaptureProcessingMode(mode: ProcessingMode): void {
    this.http
      .put<AssistantSettingsDto>('/api/settings/assistant', { captureProcessingMode: mode })
      .subscribe({
        next: (settings) => {
          this.captureProcessingMode.set(
            isProcessingMode(settings.captureProcessingMode)
              ? settings.captureProcessingMode
              : 'verbatim',
          );
          this.saveFailed.set(false);
        },
        error: () => this.saveFailed.set(true),
      });
  }
}
