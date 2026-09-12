import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';

import { SettingsComponent } from './settings.component';
import { BackupService } from '../core/services/backup.service';
import { ToastService } from '../core/services/toast.service';

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

    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        { provide: BackupService, useValue: backupServiceMock },
        { provide: ToastService, useValue: { error: vi.fn(), success: vi.fn(), info: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
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
});
