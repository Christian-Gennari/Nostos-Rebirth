import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

/**
 * Keeps the installed service worker's manifest fresh.
 *
 * The Angular service worker answers navigations from its app-shell cache
 * according to `navigationUrls` in `ngsw.json`, and it only re-reads that
 * manifest when the worker (re)installs or when the page asks it to. Because
 * `ngsw-worker.js` is byte-identical across deploys, a client that stays open
 * keeps the OLD policy: a deploy that fixes a navigation URL (for example the
 * book-detail Download button, which was answered with cached index.html)
 * does not reach the device until the app itself is reloaded — and the very
 * first navigation after a deploy still uses the previous policy.
 *
 * Asking the worker to check on startup and whenever the app is foregrounded
 * closes that window: no polling timer, no forced reload, and only the
 * navigation policy/manifest is refreshed. Applying a new *app version* still
 * waits for the user's next load, so nothing reloads under their hands.
 */
@Injectable({ providedIn: 'root' })
export class SwUpdateService {
  private readonly updates = inject(SwUpdate);
  private readonly document = inject(DOCUMENT);

  /** Foregrounding a phone can fire repeatedly; one check per minute is plenty. */
  private static readonly MIN_INTERVAL_MS = 60_000;

  private lastCheckAt = 0;
  private started = false;

  /** Wires the update checks. Safe to call more than once. */
  start(): void {
    if (this.started) return;
    // `isEnabled` mirrors `provideServiceWorker({ enabled })` in app.config.ts:
    // false in dev builds and wherever the worker is not registered, so there
    // is nothing to ask.
    if (!this.updates.isEnabled) return;
    this.started = true;

    void this.check();
    this.document.addEventListener('visibilitychange', () => {
      if (this.document.visibilityState === 'visible') void this.check();
    });
  }

  private async check(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCheckAt < SwUpdateService.MIN_INTERVAL_MS) return;
    this.lastCheckAt = now;

    try {
      await this.updates.checkForUpdate();
    } catch {
      // Offline, worker not installed yet, or an unrecoverable state: the next
      // trigger simply tries again.
    }
  }
}
