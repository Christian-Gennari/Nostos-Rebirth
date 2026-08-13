import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';

import { SettingsComponent } from './settings.component';
import { BackupService } from '../core/services/backup.service';
import { ToastService } from '../core/services/toast.service';
import { ThemeService, THEME_STORAGE_KEY } from '../core/services/theme.service';

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

describe('SettingsComponent appearance', () => {
  let fixture: ComponentFixture<SettingsComponent>;

  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');

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

  function themeButtons() {
    const group = fixture.debugElement.query(By.css('[aria-label="App theme"]'));
    expect(group).not.toBeNull();
    return group.queryAll(By.css('button'));
  }

  it('renders the Appearance card with Light, Dark, and Sepia options', () => {
    const headers = fixture.debugElement
      .queryAll(By.css('.card-header h2'))
      .map((h) => h.nativeElement.textContent.trim());
    expect(headers).toContain('Appearance');

    const labels = themeButtons().map((b) => b.nativeElement.textContent.trim());
    expect(labels).toEqual(['Light', 'Dark', 'Sepia']);
  });

  it('selecting an option calls ThemeService.setTheme and persists globally', () => {
    const themeService = TestBed.inject(ThemeService);

    themeButtons()[1].nativeElement.click(); // Dark
    fixture.detectChanges();

    expect(themeService.theme()).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('reflects the active theme on the segmented control', () => {
    TestBed.inject(ThemeService).setTheme('sepia');
    fixture.detectChanges();

    const buttons = themeButtons();
    expect(buttons[2].classes['btn-primary']).toBe(true);
    expect(buttons[0].classes['btn-primary']).toBeUndefined();
    expect(buttons[0].classes['btn-secondary']).toBe(true);
  });
});
