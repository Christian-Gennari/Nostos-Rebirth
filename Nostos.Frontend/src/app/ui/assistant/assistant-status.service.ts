import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

/** The wire shape of `GET /api/assistant/status` — one boolean, nothing else. */
export interface AssistantStatusDto {
  available: boolean;
}

/**
 * The client's single source of assistant availability (W1).
 *
 * Availability is a server fact, derived there from whether a model provider is
 * configured. The client must not infer it by catching a 503 on a turn, so this
 * asks the dedicated status route and exposes one signal for the capsule gate
 * and the settings toggle to share.
 *
 * False until the server says otherwise: a capsule that appears before the
 * answer would be an optimistic guess, and the whole point is to avoid one.
 */
@Injectable({ providedIn: 'root' })
export class AssistantStatusService {
  private readonly http = inject(HttpClient);

  /** Whether the server can run the assistant. */
  readonly available = signal(false);

  private requested = false;

  /** Fetches the status once per session; later visits reuse the answer. */
  ensureLoaded(): void {
    if (this.requested) return;
    this.requested = true;
    this.refresh();
  }

  /** Refetches the status, so a settings visit reflects the server as it is now. */
  refresh(): void {
    this.http.get<AssistantStatusDto>('/api/assistant/status').subscribe({
      next: (status) => this.available.set(status.available === true),
      error: () => this.available.set(false),
    });
  }
}
