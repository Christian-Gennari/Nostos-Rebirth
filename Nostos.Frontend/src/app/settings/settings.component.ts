import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Settings, Archive, RefreshCw, Download, Trash2, Loader2, FolderSearch } from 'lucide-angular';

import { BackupService } from '../core/services/backup.service';
import { ToastService } from '../core/services/toast.service';
import {
  BackupStatus,
  BackupSettings,
  BackupHistoryItem,
  BackupProgress,
} from '../core/dtos/backup.dtos';

const SLOW_STEP_THRESHOLD_MS = 30_000;

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
  imports: [CommonModule, FormsModule, LucideAngularModule],
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
    </div>
  `,
  styleUrls: ['./settings.component.css'],
})
export class SettingsComponent implements OnInit, OnDestroy {
  private backupService = inject(BackupService);
  private toast = inject(ToastService);

  SettingsIcon = Settings;
  ArchiveIcon = Archive;
  RefreshCwIcon = RefreshCw;
  DownloadIcon = Download;
  Trash2Icon = Trash2;
  LoaderIcon = Loader2;
  FolderSearchIcon = FolderSearch;

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
  progress = signal<BackupProgress>(defaultProgress);
  showSlowNotice = signal(false);
  private stepChangedAt = 0;
  private slowNoticeInterval: ReturnType<typeof setInterval> | null = null;

  private progressInterval: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.loadData();
  }

  ngOnDestroy(): void {
    this.stopProgressPolling();
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
    if (!confirm('This will overwrite your current database and book files with the backup data. A safety copy of the current database will be made. You should restart the application after restore. Continue?')) {
      return;
    }

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
    if (!confirm('Delete this backup and its archive file?')) return;

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