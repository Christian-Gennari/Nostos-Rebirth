import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { ImportsPanel } from './imports-panel.component';
import { ImportService } from '../../core/services/import.service';
import { ImportActivity } from '../../core/dtos/import.dtos';

/**
 * What the section puts on screen.
 *
 * The section is driven only by ImportService's signals — it is not given the
 * library, its sort, its filters or its page — so these specs provide the feed
 * and assert the rendering. That separation is the property being protected:
 * nothing here can be affected by how the library below it is sorted or filtered.
 */
describe('ImportsPanel', () => {
  let fixture: ComponentFixture<ImportsPanel>;

  const activeImports = signal<ImportActivity[]>([]);
  const failedImports = signal<ImportActivity[]>([]);
  const connectionState = signal<'idle' | 'connecting' | 'live' | 'reconnecting'>('idle');
  const cancel = vi.fn();
  const retry = vi.fn();
  const dismiss = vi.fn();

  function activity(overrides: Partial<ImportActivity> = {}): ImportActivity {
    return {
      id: 'job-1',
      source: 'job',
      state: 'running',
      stage: 'downloading',
      percent: 42,
      detail: '12/34 files',
      providerId: 'gutenberg',
      externalId: '201',
      assetId: null,
      bookId: '11111111-1111-4111-8111-111111111111',
      title: 'Flatland',
      author: 'Edwin Abbott Abbott',
      coverUrl: null,
      errorCode: null,
      message: null,
      createdAt: '2026-09-18T10:00:00Z',
      updatedAt: '2026-09-18T10:00:05Z',
      canRetry: true,
      ...overrides,
    };
  }

  beforeEach(async () => {
    localStorage.clear();
    activeImports.set([]);
    failedImports.set([]);
    connectionState.set('idle');
    cancel.mockReset();
    retry.mockReset();
    dismiss.mockReset();

    await TestBed.configureTestingModule({
      imports: [ImportsPanel],
      providers: [
        {
          provide: ImportService,
          useValue: { activeImports, failedImports, connectionState, cancel, retry, dismiss },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImportsPanel);
    await fixture.whenStable();
  });

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const entries = () =>
    (fixture.nativeElement as HTMLElement).querySelectorAll('.import-entry');

  it('renders nothing at all when there is nothing to report', () => {
    expect((fixture.nativeElement as HTMLElement).querySelector('.imports-panel')).toBeNull();
  });

  it('shows an in-flight import with its stage, percentage and bar', () => {
    activeImports.set([activity()]);
    fixture.detectChanges();

    expect(entries()).toHaveLength(1);
    expect(text()).toContain('Flatland');
    expect(text()).toContain('Edwin Abbott Abbott');
    expect(text()).toContain('Downloading');
    expect(text()).toContain('42%');
    expect(text()).toContain('12/34 files');

    const fill = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '.import-progress-fill',
    );
    expect(fill?.style.width).toBe('42%');

    // The bar carries the number for assistive tech, not just visually.
    const bar = (fixture.nativeElement as HTMLElement).querySelector('.import-progress');
    expect(bar?.getAttribute('role')).toBe('progressbar');
    expect(bar?.getAttribute('aria-valuenow')).toBe('42');
    expect(bar?.getAttribute('aria-label')).toBe('Downloading, 42 percent');
  });

  it('labels a transcoding import with the stage the reader cares about', () => {
    activeImports.set([activity({ stage: 'assembling', percent: 72, detail: 'M4B audiobook' })]);
    fixture.detectChanges();

    expect(text()).toContain('Transcoding');
    expect(text()).toContain('M4B audiobook');
  });

  it('never renders a full bar for an import that has not landed', () => {
    // The server caps this at 99; the component must not add the extra percent
    // itself, and the raw value it is given is what it shows.
    activeImports.set([activity({ percent: 99 })]);
    fixture.detectChanges();

    const fill = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '.import-progress-fill',
    );
    expect(fill?.style.width).toBe('99%');
    expect(text()).toContain('99%');
  });

  it('offers Cancel while an import is running', () => {
    activeImports.set([activity()]);
    fixture.detectChanges();

    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '.import-entry button',
    );
    expect(button?.textContent?.trim()).toBe('Cancel');

    button?.click();
    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1' }));
  });

  it('shows a failed import with its message, Retry and Dismiss', () => {
    failedImports.set([
      activity({
        id: 'book-1',
        source: 'reconciled',
        state: 'failed',
        stage: 'failed',
        percent: 0,
        message: 'Import interrupted by server restart.',
        detail: null,
      }),
    ]);
    fixture.detectChanges();

    expect(text()).toContain('Import interrupted by server restart.');
    expect(text()).toContain('Failed');

    const buttons = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.import-entry button',
      ),
    ];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Retry', 'Dismiss']);

    buttons[0].click();
    buttons[1].click();
    expect(retry).toHaveBeenCalledWith(expect.objectContaining({ id: 'book-1' }));
    expect(dismiss).toHaveBeenCalledWith(expect.objectContaining({ id: 'book-1' }));
  });

  it('hides Retry when the entry does not know where it came from', () => {
    failedImports.set([
      activity({ state: 'failed', stage: 'failed', canRetry: false, message: 'It broke.' }),
    ]);
    fixture.detectChanges();

    const buttons = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.import-entry button',
      ),
    ];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Dismiss']);
  });

  it('says so when the feed has dropped its connection', () => {
    activeImports.set([activity()]);
    connectionState.set('reconnecting');
    fixture.detectChanges();

    expect(text()).toContain('Reconnecting');
  });

  it('leaves the progress state alone when the feed is fine', () => {
    activeImports.set([activity()]);
    fixture.detectChanges();

    expect(text()).not.toContain('Reconnecting');
  });

  it('counts the entries in the heading', () => {
    activeImports.set([activity(), activity({ id: 'job-2' })]);
    fixture.detectChanges();

    expect(text()).toContain('Imports in Progress (2)');
  });

  it('shows the cover the library would show for the same book', () => {
    activeImports.set([activity({ coverUrl: '/api/books/abc/cover' })]);
    fixture.detectChanges();

    const img = (fixture.nativeElement as HTMLElement).querySelector<HTMLImageElement>(
      '.import-cover-img',
    );
    expect(img?.getAttribute('src')).toBe('/api/books/abc/cover/thumbnail?width=320');
  });

  it('starts expanded and tucks away to a one-line summary on toggle', () => {
    localStorage.clear();
    activeImports.set([activity(), activity({ id: 'job-2', percent: 80 })]);
    failedImports.set([activity({ id: 'job-3', state: 'failed', stage: 'failed' })]);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.imports-list')).toBeTruthy();
    expect(host.querySelector('[data-testid="imports-summary"]')).toBeNull();

    (host.querySelector('[data-testid="imports-toggle"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(host.querySelector('.imports-list')).toBeNull();
    const summary = host.querySelector('[data-testid="imports-summary"]');
    expect(summary?.textContent).toContain('2 in progress · 80%');
    expect(summary?.textContent).toContain('1 failed');
    expect(localStorage.getItem('nostos.imports-collapsed')).toBe('1');

    // And back again.
    (host.querySelector('[data-testid="imports-toggle"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.querySelector('.imports-list')).toBeTruthy();
    expect(localStorage.getItem('nostos.imports-collapsed')).toBe('0');
  });
});
