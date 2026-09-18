import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Settings, Archive, RefreshCw, Download, Trash2, Loader2, FolderSearch, Palette, Sun, Moon, BookOpen, Copy, Check, TriangleAlert } from 'lucide-angular';

import { BackupService } from '../core/services/backup.service';
import { OpdsService } from '../core/services/opds.service';
import { ToastService } from '../core/services/toast.service';
import { ThemeService, Theme } from '../core/services/theme.service';
import { ConfirmModal } from '../ui/confirm-modal/confirm-modal.component';
import {
  BackupStatus,
  BackupSettings,
  BackupHistoryItem,
  BackupProgress,
} from '../core/dtos/backup.dtos';
import { OpdsInfo } from '../core/dtos/opds.dtos';

const SLOW_STEP_THRESHOLD_MS = 30_000;

/** How long the copy button stays on "Copied" before it offers to copy again. */
const COPIED_FEEDBACK_MS = 2_500;

const defaultProgress: BackupProgress = {
  isRunning: false,
  currentStep: null,
  percentComplete: 0,
  startedAt: null,
  stepNumber: 0,
  totalSteps: 0,
};

@Component({
  standalone: true,
  selector: 'app-settings',
  imports: [CommonModule, FormsModule, LucideAngularModule, ConfirmModal],
  template: `
    <div class="settings-page">
      <header class="settings-header">
        <h1>Settings</h1>
      </header>

      <section class="settings-card">
        <div class="card-header">
          <lucide-icon [img]="SettingsIcon" [size]="20" strokeWidth="1.5"></lucide-icon>
          <h2>Backup</h2>
        </div>

        <div class="card-body">
          <!-- Enable Toggle -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Automatic Backup</span>
              @if (settings().isEnabled) {
                <span class="label-desc">Backups are created automatically every {{ formatInterval(settings().intervalHours) }}.</span>
              } @else {
                <span class="label-desc">When turned on, the first backup will run within 5 minutes, then every {{ formatInterval(settings().intervalHours) }} thereafter.</span>
              }
            </div>
            <label class="toggle">
              <input type="checkbox" [checked]="settings().isEnabled" (change)="toggleEnabled($event)">
              <span class="toggle-slider"></span>
            </label>
          </div>

          <!-- Include Book Files -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Include Book Files</span>
              <span class="label-desc">Include EPUB, PDF, and audio files in backups. Makes archives much larger but ensures full recovery.</span>
            </div>
            <label class="toggle">
              <input type="checkbox" [checked]="settings().includeBookFiles" (change)="toggleBookFiles($event)">
              <span class="toggle-slider"></span>
            </label>
          </div>

          <!-- Schedule -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Backup Frequency</span>
              <span class="label-desc">How often to create automatic backups.</span>
            </div>
            <select class="select-sm" [value]="settings().intervalHours.toString()" (change)="changeInterval($event)">
              <option value="6">Every 6 hours</option>
              <option value="12">Every 12 hours</option>
              <option value="24">Daily</option>
              <option value="168">Weekly</option>
            </select>
          </div>

          <!-- Max Backups -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Max Backups</span>
              <span class="label-desc">Oldest backups will be automatically deleted when this limit is reached.</span>
            </div>
            <select class="select-sm" [value]="settings().maxBackups.toString()" (change)="changeMaxBackups($event)">
              <option value="3">3</option>
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="20">20</option>
            </select>
          </div>

          <!-- Manual Backup -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Manual Backup</span>
              <span class="label-desc">Create a backup now regardless of the schedule.</span>
            </div>
            <button
              class="btn btn-primary"
              [disabled]="backingUp()"
              (click)="triggerBackup()"
            >
              @if (backingUp()) {
                <lucide-icon [img]="LoaderIcon" [size]="16" strokeWidth="2" class="spin"></lucide-icon>
                Backing up...
              } @else {
                <lucide-icon [img]="RefreshCwIcon" [size]="16" strokeWidth="2"></lucide-icon>
                Back up now
              }
            </button>
          </div>

          @if (backingUp() && progress().isRunning) {
            <div class="progress-bar-container">
              <div class="progress-step-label">
                Step {{ progress().stepNumber }} of {{ progress().totalSteps }} &mdash; {{ progress().currentStep }}
              </div>
              <div class="progress-bar">
                <div class="progress-bar-fill" [style.width.%]="progress().percentComplete"></div>
              </div>
              @if (showSlowNotice()) {
                <div class="slow-notice">
                  This step may take a few minutes for large libraries.
                </div>
              }
            </div>
          }

          <!-- Import from Disk -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Import from Disk</span>
              <span class="label-desc">Copy .nostos files to the Storage/backups/ folder on the server, then scan to add them to your history.</span>
            </div>
            <button
              class="btn btn-secondary"
              [disabled]="importing()"
              (click)="scanForBackups()"
            >
              @if (importing()) {
                <lucide-icon [img]="LoaderIcon" [size]="16" strokeWidth="2" class="spin"></lucide-icon>
                Scanning...
              } @else {
                <lucide-icon [img]="FolderSearchIcon" [size]="16" strokeWidth="2"></lucide-icon>
                Scan for Backups
              }
            </button>
          </div>

          <!-- Last Backup Info -->
          @if (status().lastBackupAt) {
            <div class="last-backup-info">
              Last backup: {{ status().lastBackupAt | date:'medium' }}
              <span class="status-{{ status().lastBackupStatus === 'Completed' ? 'success' : 'error' }}">
                {{ status().lastBackupStatus }}
              </span>
            </div>
          }
        </div>
      </section>

      <!-- Backup History -->
      <section class="settings-card">
        <div class="card-header">
          <lucide-icon [img]="ArchiveIcon" [size]="20" strokeWidth="1.5"></lucide-icon>
          <h2>Backup History</h2>
        </div>

        @if (history().length === 0) {
          <div class="empty-state">
            No backups yet. Create your first backup to get started.
          </div>
        } @else {
          <div class="history-list">
            @for (item of history(); track item.id) {
              <div class="history-item">
                <div class="history-info">
                  <span class="history-date">{{ item.createdAt | date:'medium' }}</span>
                  <span class="history-meta">
                    {{ formatSize(item.sizeBytes) }}
                    @if (item.includeBookFiles) {
                      &middot; with files
                    } @else {
                      &middot; metadata only
                    }
                    @if (item.errorMessage) {
                      &middot; <span class="status-error">{{ item.errorMessage }}</span>
                    }
                  </span>
                </div>
                <div class="history-actions">
                  <span class="status-{{ item.status === 'Completed' ? 'success' : item.status === 'Failed' ? 'error' : 'pending' }}">
                    {{ item.status }}
                  </span>
                  @if (item.status === 'Completed') {
                    <button class="btn btn-sm btn-secondary" (click)="downloadBackup(item.id)" title="Download archive">
                      <lucide-icon [img]="DownloadIcon" [size]="14" strokeWidth="2"></lucide-icon>
                    </button>
                    <button class="btn btn-sm btn-secondary" (click)="restoreBackup(item.id)" [disabled]="restoring()" title="Restore from this backup">
                      <lucide-icon [img]="RefreshCwIcon" [size]="14" strokeWidth="2"></lucide-icon>
                      Restore
                    </button>
                  }
                  <button class="btn btn-sm btn-danger" (click)="deleteBackup(item.id)" title="Delete backup">
                    <lucide-icon [img]="Trash2Icon" [size]="14" strokeWidth="2"></lucide-icon>
                  </button>
                </div>
              </div>
            }
          </div>
        }

        @if (restoring() && progress().isRunning) {
          <div class="progress-bar-container">
            <div class="progress-step-label">
              Step {{ progress().stepNumber }} of {{ progress().totalSteps }} &mdash; {{ progress().currentStep }}
            </div>
            <div class="progress-bar">
              <div class="progress-bar-fill" [style.width.%]="progress().percentComplete"></div>
            </div>
            @if (showSlowNotice()) {
              <div class="slow-notice">
                This step may take a few minutes for large libraries.
              </div>
            }
          </div>
        }
      </section>

      <!-- E-reader access (issue #187). Sits with the library data rather than
           with Appearance: it is about reaching the library from elsewhere. -->
      <section class="settings-card">
        <div class="card-header">
          <lucide-icon [img]="BookOpenIcon" [size]="20" strokeWidth="1.5"></lucide-icon>
          <h2>E-reader access</h2>
        </div>

        <div class="card-body">
          @if (opdsFailed()) {
            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">Could not read this setting</span>
                <span class="label-desc">The server did not answer the request for e-reader access. Reload the page to try again.</span>
              </div>
            </div>
          } @else if (opds(); as info) {
            @if (info.enabled && info.catalogUrl) {
              <div class="setting-row setting-row--stacked">
                <div class="setting-label">
                  <span class="label-text">Catalog address</span>
                  <span class="label-desc">Give this address to a compatible e-reader or reading app &mdash; it browses and downloads straight from your Nostos library, so nothing is copied and there is no second library to keep in sync.</span>
                </div>

                <div class="catalog-url-row">
                  <code class="catalog-url">{{ info.catalogUrl }}</code>
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm"
                    (click)="copyCatalogUrl()"
                    [attr.aria-label]="'Copy catalog address ' + info.catalogUrl"
                  >
                    @if (copied()) {
                      <lucide-icon [img]="CheckIcon" [size]="14" strokeWidth="2"></lucide-icon>
                      Copied
                    } @else {
                      <lucide-icon [img]="CopyIcon" [size]="14" strokeWidth="2"></lucide-icon>
                      Copy URL
                    }
                  </button>
                </div>

                @if (info.localOnly) {
                  <p class="catalog-note catalog-note--warning">
                    <lucide-icon [img]="TriangleAlertIcon" [size]="14" strokeWidth="2"></lucide-icon>
                    <span>This address only works on this computer. Open Nostos from the address your reader will use &mdash; your machine's address on your home network or Tailscale &mdash; and the catalog address will match it.</span>
                  </p>
                } @else {
                  <p class="catalog-note">
                    Your reader has to be able to reach this server: the same home network or Tailscale network you are on now. In the reader's settings, look for &ldquo;catalog&rdquo; or &ldquo;OPDS catalog&rdquo; and enter the address above.
                  </p>
                }
              </div>
            } @else {
              <div class="setting-row">
                <div class="setting-label">
                  <span class="label-text">E-reader access is turned off</span>
                  <span class="label-desc">This server is not publishing a catalog, so there is no address to connect to. It can be switched on where Nostos is configured, with <code class="inline-code">Opds:Enabled=true</code>.</span>
                </div>
              </div>
            }
          }
        </div>
      </section>

      <section class="settings-card">
        <div class="card-header">
          <lucide-icon [img]="PaletteIcon" [size]="20" strokeWidth="1.5"></lucide-icon>
          <h2>Appearance</h2>
        </div>

        <div class="card-body">
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Colour Theme</span>
              <span class="label-desc">Dark is a companion palette for evening reading — same paper, lower light. Sepia is warm paper, the closest to a printed page.</span>
            </div>
            <!-- Explicit options rather than a switch: the control always shows
                 every state, so the choice is legible before it is made. -->
            <div class="theme-choice" role="radiogroup" aria-label="Colour theme">
              <button
                type="button"
                class="theme-opt"
                role="radio"
                [attr.aria-checked]="theme() === 'light'"
                [class.is-active]="theme() === 'light'"
                (click)="setTheme('light')"
              >
                <lucide-icon [img]="SunIcon" [size]="15" strokeWidth="1.75"></lucide-icon>
                Light
              </button>
              <button
                type="button"
                class="theme-opt"
                role="radio"
                [attr.aria-checked]="theme() === 'sepia'"
                [class.is-active]="theme() === 'sepia'"
                (click)="setTheme('sepia')"
              >
                <lucide-icon [img]="BookOpenIcon" [size]="15" strokeWidth="1.75"></lucide-icon>
                Sepia
              </button>
              <button
                type="button"
                class="theme-opt"
                role="radio"
                [attr.aria-checked]="theme() === 'dark'"
                [class.is-active]="theme() === 'dark'"
                (click)="setTheme('dark')"
              >
                <lucide-icon [img]="MoonIcon" [size]="15" strokeWidth="1.75"></lucide-icon>
                Dark
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- Restore overwrites live data and delete removes the archive: both ask
         through the shared modal instead of window.confirm(). -->
    <app-confirm-modal
      [isOpen]="!!pendingRestore()"
      heading="Restore from this backup?"
      description="This overwrites your current database and book files with the backup data. A safety copy of the current database is made first, and you should restart the application after restore."
      confirmLabel="Restore"
      busyLabel="Restoring…"
      [busy]="restoring()"
      (confirm)="confirmRestore()"
      (cancel)="cancelRestore()"
    >
    </app-confirm-modal>

    <app-confirm-modal
      [isOpen]="!!pendingBackupDelete()"
      heading="Delete this backup?"
      description="The backup and its archive file are permanently removed."
      confirmLabel="Delete"
      (confirm)="confirmBackupDelete()"
      (cancel)="cancelBackupDelete()"
    >
    </app-confirm-modal>
  `,
  styleUrls: ['./settings.component.css'],
})
export class SettingsComponent implements OnInit, OnDestroy {
  private backupService = inject(BackupService);
  private opdsService = inject(OpdsService);
  private toast = inject(ToastService);
  private themeService = inject(ThemeService);

  /** The active theme, exposed for the Appearance card. */
  readonly theme = this.themeService.theme;

  setTheme(theme: Theme): void {
    this.themeService.setTheme(theme);
  }

  SettingsIcon = Settings;
  ArchiveIcon = Archive;
  RefreshCwIcon = RefreshCw;
  DownloadIcon = Download;
  Trash2Icon = Trash2;
  LoaderIcon = Loader2;
  FolderSearchIcon = FolderSearch;
  PaletteIcon = Palette;
  SunIcon = Sun;
  MoonIcon = Moon;
  BookOpenIcon = BookOpen;
  CopyIcon = Copy;
  CheckIcon = Check;
  TriangleAlertIcon = TriangleAlert;

  /** E-reader access (issue #187): null until the server has answered. */
  opds = signal<OpdsInfo | null>(null);

  /** True when the info request failed, so the card never presents a guess as fact. */
  opdsFailed = signal(false);

  copied = signal(false);
  private copiedTimeout: ReturnType<typeof setTimeout> | null = null;

  status = signal<BackupStatus>({
    isEnabled: false,
    provider: 'Local',
    lastBackupAt: null,
    lastBackupStatus: null,
    includeBookFiles: true,
    intervalHours: 168,
    maxBackups: 3,
  });

  settings = signal<BackupSettings>({
    isEnabled: false,
    provider: 'Local',
    includeBookFiles: true,
    intervalHours: 168,
    maxBackups: 3,
  });

  history = signal<BackupHistoryItem[]>([]);
  backingUp = signal(false);
  restoring = signal(false);
  importing = signal(false);

  /** Backup id awaiting restore confirmation (asked through ConfirmModal). */
  pendingRestore = signal<string | null>(null);

  /** Backup id awaiting archive-delete confirmation (asked through ConfirmModal). */
  pendingBackupDelete = signal<string | null>(null);
  progress = signal<BackupProgress>(defaultProgress);
  showSlowNotice = signal(false);
  private stepChangedAt = 0;
  private slowNoticeInterval: ReturnType<typeof setInterval> | null = null;

  private progressInterval: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.loadData();
    this.loadOpdsInfo();
  }

  ngOnDestroy(): void {
    this.stopProgressPolling();
    if (this.copiedTimeout !== null) {
      clearTimeout(this.copiedTimeout);
      this.copiedTimeout = null;
    }
  }

  loadOpdsInfo(): void {
    this.opdsService.getInfo().subscribe({
      next: (info) => {
        this.opds.set(info);
        this.opdsFailed.set(false);
      },
      error: () => {
        this.opds.set(null);
        this.opdsFailed.set(true);
      },
    });
  }

  /**
   * Copies the catalog address. The clipboard API is only available in a
   * secure context (https, or localhost), so a failure is reported rather than
   * swallowed — the address on screen stays selectable as the fallback.
   */
  copyCatalogUrl(): void {
    const url = this.opds()?.catalogUrl;
    if (!url || !navigator.clipboard) {
      this.toast.error('Copying is not available here — select the address and copy it.');
      return;
    }

    navigator.clipboard.writeText(url).then(
      () => {
        this.copied.set(true);
        this.toast.success('Catalog address copied.');
        if (this.copiedTimeout !== null) clearTimeout(this.copiedTimeout);
        this.copiedTimeout = setTimeout(() => {
          this.copied.set(false);
          this.copiedTimeout = null;
        }, COPIED_FEEDBACK_MS);
      },
      () => {
        this.toast.error('Could not copy automatically — select the address and copy it.');
      },
    );
  }

  loadData(): void {
    this.backupService.getStatus().subscribe({
      next: (s) => this.status.set(s),
      error: () => this.toast.error('Failed to load backup status.'),
    });

    this.backupService.getSettings().subscribe({
      next: (s) => this.settings.set(s),
      error: () => {},
    });

    this.loadHistory();
  }

  loadHistory(): void {
    this.backupService.getHistory().subscribe({
      next: (h) => this.history.set(h),
      error: () => {},
    });
  }

  toggleEnabled(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.backupService.updateSettings({ isEnabled: checked }).subscribe({
      next: (s) => {
        this.settings.set(s);
        this.refreshStatus();
      },
      error: () => this.toast.error('Failed to update settings.'),
    });
  }

  toggleBookFiles(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.backupService.updateSettings({ includeBookFiles: checked }).subscribe({
      next: (s) => {
        this.settings.set(s);
        this.refreshStatus();
      },
      error: () => this.toast.error('Failed to update settings.'),
    });
  }

  changeInterval(event: Event): void {
    const value = parseInt((event.target as HTMLSelectElement).value, 10);
    this.backupService.updateSettings({ intervalHours: value }).subscribe({
      next: (s) => this.settings.set(s),
      error: () => this.toast.error('Failed to update settings.'),
    });
  }

  changeMaxBackups(event: Event): void {
    const value = parseInt((event.target as HTMLSelectElement).value, 10);
    this.backupService.updateSettings({ maxBackups: value }).subscribe({
      next: (s) => this.settings.set(s),
      error: () => this.toast.error('Failed to update settings.'),
    });
  }

  triggerBackup(): void {
    this.backingUp.set(true);
    this.startProgressPolling();
    this.backupService.triggerBackup().subscribe({
      next: (result) => {
        this.backingUp.set(false);
        this.stopProgressPolling();
        this.progress.set(defaultProgress); this.showSlowNotice.set(false);
        if (result.status === 'Completed') {
          this.toast.success(`Backup created successfully (${this.formatSize(result.sizeBytes)}).`);
        } else {
          this.toast.error('Backup failed. Check the logs for details.');
        }
        this.loadData();
      },
      error: () => {
        this.backingUp.set(false);
        this.stopProgressPolling();
        this.progress.set(defaultProgress); this.showSlowNotice.set(false);
        this.toast.error('Backup failed. Check the logs for details.');
      },
    });
  }

  downloadBackup(id: string): void {
    window.open(this.backupService.getDownloadUrl(id), '_blank');
  }

  scanForBackups(): void {
    this.importing.set(true);
    this.backupService.importExisting().subscribe({
      next: (imported) => {
        this.importing.set(false);
        if (imported.length > 0) {
          this.toast.success(`Found ${imported.length} backup(s) on disk.`);
        } else {
          this.toast.info('No new backups found on disk.');
        }
        this.loadHistory();
      },
      error: () => {
        this.importing.set(false);
        this.toast.error('Failed to scan for backups.');
      },
    });
  }

  restoreBackup(id: string): void {
    this.pendingRestore.set(id);
  }

  cancelRestore(): void {
    if (this.restoring()) return;
    this.pendingRestore.set(null);
  }

  confirmRestore(): void {
    const id = this.pendingRestore();
    if (!id || this.restoring()) return;
    this.pendingRestore.set(null);

    this.restoring.set(true);
    this.startProgressPolling();
    this.backupService.restore(id).subscribe({
      next: (result) => {
        this.restoring.set(false);
        this.stopProgressPolling();
        this.progress.set(defaultProgress); this.showSlowNotice.set(false);
        if (result.success) {
          this.toast.success(result.message);
        } else {
          this.toast.error(result.message);
        }
        this.loadHistory();
      },
      error: () => {
        this.restoring.set(false);
        this.stopProgressPolling();
        this.progress.set(defaultProgress); this.showSlowNotice.set(false);
        this.toast.error('Restore failed. Check the logs for details.');
      },
    });
  }

  deleteBackup(id: string): void {
    this.pendingBackupDelete.set(id);
  }

  cancelBackupDelete(): void {
    this.pendingBackupDelete.set(null);
  }

  confirmBackupDelete(): void {
    const id = this.pendingBackupDelete();
    if (!id) return;
    this.pendingBackupDelete.set(null);

    this.backupService.deleteBackup(id).subscribe({
      next: () => {
        this.toast.success('Backup deleted.');
        this.loadHistory();
      },
      error: () => this.toast.error('Failed to delete backup.'),
    });
  }

  private startProgressPolling(): void {
    this.stopProgressPolling();
    this.stepChangedAt = Date.now();
    this.slowNoticeInterval = setInterval(() => {
      this.showSlowNotice.set(Date.now() - this.stepChangedAt > SLOW_STEP_THRESHOLD_MS);
    }, 1000);
    this.progressInterval = setInterval(() => {
      this.backupService.getProgress().subscribe({
        next: (p) => {
          const prev = this.progress();
          if (p.currentStep !== prev.currentStep) {
            this.stepChangedAt = Date.now();
            this.showSlowNotice.set(false);
          }
          this.progress.set(p);
        },
        error: () => {},
      });
    }, 1000);
  }

  private stopProgressPolling(): void {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
    if (this.slowNoticeInterval) {
      clearInterval(this.slowNoticeInterval);
      this.slowNoticeInterval = null;
    }
  }

  private refreshStatus(): void {
    this.backupService.getStatus().subscribe({
      next: (s) => this.status.set(s),
      error: () => {},
    });
  }

  formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }

  formatInterval(hours: number): string {
    if (hours < 24) return `${hours} hours`;
    if (hours === 24) return 'day';
    if (hours === 168) return 'week';
    return `${hours} hours`;
  }
}