import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  BackupStatus,
  BackupSettings,
  UpdateBackupSettings,
  BackupHistoryItem,
  TriggerBackupResult,
  RestoreResult,
  BackupProgress,
} from '../dtos/backup.dtos';

@Injectable({ providedIn: 'root' })
export class BackupService {
  constructor(private http: HttpClient) {}

  getStatus(): Observable<BackupStatus> {
    return this.http.get<BackupStatus>('/api/backup/status');
  }

  getSettings(): Observable<BackupSettings> {
    return this.http.get<BackupSettings>('/api/backup/settings');
  }

  updateSettings(dto: UpdateBackupSettings): Observable<BackupSettings> {
    return this.http.put<BackupSettings>('/api/backup/settings', dto);
  }

  triggerBackup(): Observable<TriggerBackupResult> {
    return this.http.post<TriggerBackupResult>('/api/backup/trigger', {});
  }

  restore(backupId: string): Observable<RestoreResult> {
    return this.http.post<RestoreResult>(`/api/backup/restore/${backupId}`, {});
  }

  getHistory(): Observable<BackupHistoryItem[]> {
    return this.http.get<BackupHistoryItem[]>('/api/backup/history');
  }

  deleteBackup(backupId: string): Observable<void> {
    return this.http.delete<void>(`/api/backup/history/${backupId}`);
  }

  getDownloadUrl(backupId: string): string {
    return `/api/backup/download/${backupId}`;
  }

  importExisting(): Observable<BackupHistoryItem[]> {
    return this.http.post<BackupHistoryItem[]>('/api/backup/import', {});
  }

  getProgress(): Observable<BackupProgress> {
    return this.http.get<BackupProgress>('/api/backup/progress');
  }
}