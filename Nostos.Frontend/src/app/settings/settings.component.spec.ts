import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of, throwError } from 'rxjs';

import { SettingsComponent } from './settings.component';
import { BackupService } from '../core/services/backup.service';
import { OpdsService } from '../core/services/opds.service';
import { ToastService } from '../core/services/toast.service';
import { OpdsInfo } from '../core/dtos/opds.dtos';

const toastMock = { error: vi.fn(), success: vi.fn(), info: vi.fn() };

/** A reachable catalog address, as the server reports it behind its proxy. */
const remoteInfo: OpdsInfo = {
  enabled: true,
  catalogUrl: 'https://omenhub.example.ts.net:5215/opds/',
  urlSource: 'request',
  localOnly: false,
};

const opdsServiceMock = {
  getInfo: vi.fn(() => of(remoteInfo)),
};

const backupServiceMock = {
  getStatus: vi.fn(() =>
    of({
      isEnabled: false,
      provider: 'Local',
      lastBackupAt: null,
      lastBackupStatus: null,
      includeBookFiles: true,
      intervalHours: 168,
      maxBackups: 3,
    }),
  ),
  getSettings: vi.fn(() =>
    of({
      isEnabled: false,
      provider: 'Local',
      includeBookFiles: true,
      intervalHours: 168,
      maxBackups: 3,
    }),
  ),
  getHistory: vi.fn(() => of([])),
  updateSettings: vi.fn(() => of({})),
  triggerBackup: vi.fn(() => of({ status: 'Completed', sizeBytes: 0 })),
  getDownloadUrl: vi.fn(() => ''),
  importExisting: vi.fn(() => of([])),
  restore: vi.fn(() => of({ success: true, message: 'Restored.' })),
  deleteBackup: vi.fn(() => of(null)),
  getProgress: vi.fn(() => of({})),
};

describe('SettingsComponent backup-only surface', () => {
  let fixture: ComponentFixture<SettingsComponent>;

  beforeEach(async () => {
    localStorage.clear();
    opdsServiceMock.getInfo.mockClear();
    opdsServiceMock.getInfo.mockReturnValue(of(remoteInfo));
    toastMock.error.mockClear();
    toastMock.success.mockClear();

    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        { provide: BackupService, useValue: backupServiceMock },
        { provide: OpdsService, useValue: opdsServiceMock },
        { provide: ToastService, useValue: toastMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  /**
   * Was `renders no Appearance card and no theme controls` — an assertion from
   * the theme-system removal. Dark mode is back as a deliberate feature, so the
   * contract is inverted rather than dropped: the card must exist, and the
   * control must offer both themes.
   */
  it('renders the Appearance card with a working Light/Dark choice', () => {
    const headers = fixture.debugElement
      .queryAll(By.css('.card-header h2'))
      .map((h) => h.nativeElement.textContent.trim());
    expect(headers).toContain('Appearance');

    const options = fixture.debugElement.queryAll(By.css('.theme-opt'));
    expect(options.map((o) => o.nativeElement.textContent.trim())).toEqual(['Light', 'Dark']);

    // Defaults to light in a test environment (no stored choice, and
    // matchMedia reports no dark preference).
    expect(options[0].nativeElement.classList.contains('is-active')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();

    options[1].nativeElement.click();
    fixture.detectChanges();

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('nostos.theme')).toBe('dark');
  });

  it('reverts to light and clears the attribute when Light is chosen', () => {
    fixture.componentInstance.setTheme('dark');
    fixture.detectChanges();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    fixture.componentInstance.setTheme('light');
    fixture.detectChanges();
    // Removing the attribute (not setting 'light') keeps `:root` the single
    // owner of the light values.
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    expect(localStorage.getItem('nostos.theme')).toBe('light');
  });

  it('renders the Backup and Backup History cards', () => {
    const headers = fixture.debugElement
      .queryAll(By.css('.card-header h2'))
      .map((h) => h.nativeElement.textContent.trim());
    expect(headers).toContain('Backup');
    expect(headers).toContain('Backup History');
    // No empty section/divider where Appearance was: the first card is Backup.
    expect(headers[0]).toBe('Backup');
  });

  it('exposes the automatic-backup toggle and manual backup action', () => {
    const toggles = fixture.debugElement.queryAll(By.css('input[type="checkbox"]'));
    expect(toggles.length).toBe(2); // Automatic Backup + Include Book Files
    const buttons = fixture.debugElement
      .queryAll(By.css('button'))
      .map((b) => b.nativeElement.textContent.trim());
    expect(buttons).toContain('Back up now');
    expect(buttons).toContain('Scan for Backups');
  });

  it('asks through ConfirmModal before restoring (no direct restore)', () => {
    const component = fixture.componentInstance;
    backupServiceMock.restore.mockClear();

    component.restoreBackup('b1');
    expect(component.pendingRestore()).toBe('b1');
    expect(backupServiceMock.restore).not.toHaveBeenCalled();

    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.confirm-modal-card')).toBeTruthy();

    component.confirmRestore();
    expect(backupServiceMock.restore).toHaveBeenCalledWith('b1');
    expect(component.pendingRestore()).toBeNull();
  });

  it('cancelling restore performs nothing', () => {
    const component = fixture.componentInstance;
    backupServiceMock.restore.mockClear();

    component.restoreBackup('b1');
    component.cancelRestore();
    expect(component.pendingRestore()).toBeNull();
    expect(backupServiceMock.restore).not.toHaveBeenCalled();
  });

  it('asks through ConfirmModal before deleting a backup', () => {
    const component = fixture.componentInstance;
    backupServiceMock.deleteBackup.mockClear();

    component.deleteBackup('b9');
    expect(component.pendingBackupDelete()).toBe('b9');
    expect(backupServiceMock.deleteBackup).not.toHaveBeenCalled();

    component.confirmBackupDelete();
    expect(backupServiceMock.deleteBackup).toHaveBeenCalledWith('b9');
    expect(component.pendingBackupDelete()).toBeNull();
  });

  // ------------------------------------------------------------------
  // E-reader access (issue #187)
  // ------------------------------------------------------------------

  it('renders the E-reader access card with the catalog address and one copy action', () => {
    const headers = cardHeaders();
    expect(headers).toContain('E-reader access');
    // Grouped with the library data, above Appearance.
    expect(headers.indexOf('E-reader access')).toBeLessThan(headers.indexOf('Appearance'));

    expect(catalogUrlText()).toBe(remoteInfo.catalogUrl);

    const copy = copyButton();
    expect(copy).toBeTruthy();
    expect(copy!.textContent).toContain('Copy URL');
  });

  it('leads with plain language and keeps OPDS as the secondary protocol name', () => {
    const heading = cardHeading('E-reader access');
    expect(heading).toContain('E-reader access');
    expect(heading).not.toMatch(/OPDS/u);

    const text = cardBodyText();
    expect(text).toContain('e-reader');
    expect(text).toMatch(/OPDS catalog/u);
  });

  it('copies the address in one action and confirms it', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    installClipboard(writeText);

    copyButton()!.click();
    await flush();

    expect(writeText).toHaveBeenCalledWith(remoteInfo.catalogUrl);
    expect(fixture.componentInstance.copied()).toBe(true);
    fixture.detectChanges();
    expect(copyButton()!.textContent).toContain('Copied');
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('reports a refused clipboard instead of silently doing nothing', async () => {
    installClipboard(vi.fn(() => Promise.reject(new Error('denied'))));

    copyButton()!.click();
    await flush();

    expect(fixture.componentInstance.copied()).toBe(false);
    expect(toastMock.error).toHaveBeenCalled();
    // The address stays on screen, selectable, as the manual fallback.
    expect(catalogUrlText()).toBe(remoteInfo.catalogUrl);
  });

  it('warns when the address is only reachable from this computer', () => {
    renderWith({
      enabled: true,
      catalogUrl: 'http://localhost:5214/opds/',
      urlSource: 'request',
      localOnly: true,
    });

    const warning = fixture.nativeElement.querySelector('.catalog-note--warning');
    expect(warning).toBeTruthy();
    expect((warning as HTMLElement).textContent).toContain('only works on this computer');

    // Still shown — a reader running on this machine can use it — but never
    // without that warning.
    expect(catalogUrlText()).toContain('localhost');
    expect(fixture.nativeElement.querySelectorAll('.catalog-note--warning').length).toBe(1);
  });

  it('offers no connection address when the server has e-reader access turned off', () => {
    renderWith({ enabled: false, catalogUrl: null, urlSource: 'request', localOnly: false });

    expect(fixture.nativeElement.querySelector('.catalog-url')).toBeNull();
    expect(copyButton()).toBeNull();
    expect(cardBodyText()).toContain('turned off');
  });

  it('says the setting could not be read rather than presenting a guess', () => {
    opdsServiceMock.getInfo.mockReturnValue(throwError(() => new Error('offline')));
    render();

    expect(cardBodyText()).toContain('Could not read this setting');
    expect(fixture.nativeElement.querySelector('.catalog-url')).toBeNull();
  });

  // ------------------------------------------------------------------

  function cardHeaders(): string[] {
    return fixture.debugElement
      .queryAll(By.css('.card-header h2'))
      .map((h) => h.nativeElement.textContent.trim());
  }

  function cardHeading(title: string): string {
    return cardHeaders().find((h) => h === title) ?? '';
  }

  function erCard(): HTMLElement | null {
    const cards = Array.from(
      fixture.nativeElement.querySelectorAll('.settings-card'),
    ) as HTMLElement[];
    return (
      cards.find((c) => c.querySelector('h2')?.textContent?.trim() === 'E-reader access') ?? null
    );
  }

  function cardBodyText(): string {
    const card = erCard();
    if (!card) return '';
    const clone = card.cloneNode(true) as HTMLElement;
    clone.querySelector('h2')?.remove();
    return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function catalogUrlText(): string {
    return (erCard()?.querySelector('.catalog-url')?.textContent ?? '').trim();
  }

  function copyButton(): HTMLButtonElement | null {
    const buttons = Array.from(erCard()?.querySelectorAll('button') ?? []) as HTMLButtonElement[];
    return (
      buttons.find((b) => /Copy URL|Copied/u.test(b.textContent ?? '')) ?? null
    );
  }

  function installClipboard(writeText: (text: string) => Promise<void>): void {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  }

  function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  /** Re-renders the card with a different server answer. */
  function renderWith(info: OpdsInfo): void {
    opdsServiceMock.getInfo.mockReturnValue(of(info));
    render();
  }

  /** Re-renders with whatever the mock currently answers. */
  function render(): void {
    fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
  }
});
