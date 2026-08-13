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

  it('renders no Appearance card and no theme controls', () => {
    const headers = fixture.debugElement
      .queryAll(By.css('.card-header h2'))
      .map((h) => h.nativeElement.textContent.trim());
    expect(headers).not.toContain('Appearance');
    expect(fixture.debugElement.query(By.css('[aria-label="App theme"]'))).toBeNull();
    expect(fixture.debugElement.queryAll(By.css('.setting-row')).length).toBeGreaterThan(0);
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
