import { Injectable, effect, signal } from '@angular/core';

export type StatusFilter = 'all' | 'notstarted' | 'reading' | 'favorites' | 'finished' | 'unsorted';
export type FormatFilter = 'all' | 'audiobook' | 'ebook' | 'pdf';

export interface LibraryFilterState {
  status: StatusFilter;
  format: FormatFilter;
  collectionId: string | null;
}

export const LIBRARY_FILTER_STORAGE_KEY = 'nostos.library.filters';

const DEFAULT_FILTERS: LibraryFilterState = {
  status: 'all',
  format: 'all',
  collectionId: null,
};

const VALID_STATUSES: readonly StatusFilter[] = [
  'all',
  'notstarted',
  'reading',
  'favorites',
  'finished',
  'unsorted',
];
const VALID_FORMATS: readonly FormatFilter[] = ['all', 'audiobook', 'ebook', 'pdf'];

@Injectable({ providedIn: 'root' })
export class LibraryFilterService {
  readonly status = signal<StatusFilter>(DEFAULT_FILTERS.status);
  readonly format = signal<FormatFilter>(DEFAULT_FILTERS.format);
  readonly collectionId = signal<string | null>(DEFAULT_FILTERS.collectionId);

  constructor() {
    this.hydrate();

    effect(() => {
      const state: LibraryFilterState = {
        status: this.status(),
        format: this.format(),
        collectionId: this.collectionId(),
      };
      this.write(state);
    });
  }

  toggleStatus(status: StatusFilter): void {
    this.status.set(this.status() === status ? 'all' : status);
  }

  toggleFormat(format: FormatFilter): void {
    this.format.set(this.format() === format ? 'all' : format);
  }

  toggleCollection(id: string | null): void {
    this.collectionId.set(this.collectionId() === id ? null : id);
  }

  clearAll(): void {
    this.status.set('all');
    this.format.set('all');
    this.collectionId.set(null);
  }

  private hydrate(): void {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(LIBRARY_FILTER_STORAGE_KEY);
    } catch {
      return;
    }
    if (raw === null) return;

    try {
      const value: unknown = JSON.parse(raw);
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
      const { status, format, collectionId } = value as Record<string, unknown>;
      if (this.isStatus(status)) this.status.set(status);
      if (this.isFormat(format)) this.format.set(format);
      if (collectionId === null || typeof collectionId === 'string') {
        this.collectionId.set(collectionId);
      }
    } catch {
      // Ignore malformed stored filters and keep defaults.
    }
  }

  private write(state: LibraryFilterState): void {
    try {
      localStorage.setItem(LIBRARY_FILTER_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Persistence is best effort; private browsing and storage quotas can
      // make localStorage unavailable without affecting the library UI.
    }
  }

  private isStatus(value: unknown): value is StatusFilter {
    return typeof value === 'string' && (VALID_STATUSES as readonly string[]).includes(value);
  }

  private isFormat(value: unknown): value is FormatFilter {
    return typeof value === 'string' && (VALID_FORMATS as readonly string[]).includes(value);
  }
}
