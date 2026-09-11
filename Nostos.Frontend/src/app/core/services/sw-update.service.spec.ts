import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { SwUpdate } from '@angular/service-worker';

import { SwUpdateService } from './sw-update.service';

/** Minimal stand-in for the Angular service worker update API. */
class SwUpdateStub {
  isEnabled = true;
  checks = 0;
  checkForUpdate(): Promise<boolean> {
    this.checks++;
    return Promise.resolve(false);
  }
}

describe('SwUpdateService', () => {
  let updates: SwUpdateStub;
  let service: SwUpdateService;

  const setVisibility = (state: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  beforeEach(() => {
    updates = new SwUpdateStub();
    TestBed.configureTestingModule({
      providers: [
        SwUpdateService,
        { provide: SwUpdate, useValue: updates },
        { provide: DOCUMENT, useValue: document },
      ],
    });
    service = TestBed.inject(SwUpdateService);
    setVisibility('visible');
  });

  it('asks the worker to check for a new manifest on start', async () => {
    service.start();
    await Promise.resolve();
    expect(updates.checks).toBe(1);
  });

  it('re-checks when the app is foregrounded again', async () => {
    service.start();
    await Promise.resolve();

    // Same minute: throttled, because a phone fires this on every foreground.
    setVisibility('visible');
    await Promise.resolve();
    expect(updates.checks).toBe(1);

    // Past the interval: the check runs again.
    (service as unknown as { lastCheckAt: number }).lastCheckAt = Date.now() - 61_000;
    setVisibility('hidden');
    setVisibility('visible');
    await Promise.resolve();
    expect(updates.checks).toBe(2);
  });

  it('does nothing when the worker is not enabled', async () => {
    updates.isEnabled = false;
    service.start();
    await Promise.resolve();
    setVisibility('visible');
    await Promise.resolve();
    expect(updates.checks).toBe(0);
  });

  it('survives a failing check (offline) and retries later', async () => {
    updates.checkForUpdate = () => {
      updates.checks++;
      return Promise.reject(new Error('offline'));
    };
    service.start();
    await Promise.resolve();

    (service as unknown as { lastCheckAt: number }).lastCheckAt = Date.now() - 61_000;
    setVisibility('visible');
    await Promise.resolve();
    expect(updates.checks).toBe(2);
  });

  it('ignores repeated start() calls', async () => {
    service.start();
    service.start();
    await Promise.resolve();
    expect(updates.checks).toBe(1);
  });
});
