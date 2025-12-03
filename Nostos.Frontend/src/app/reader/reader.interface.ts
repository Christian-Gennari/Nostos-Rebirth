// src/app/reader/reader.interface.ts
import { Signal } from '@angular/core';

export interface TocItem {
  label: string;
  target: string | number; // CFI (epub), Page Number (pdf), or Timestamp (audio)
  children?: TocItem[];
}

export interface ReaderProgress {
  label: string; // "Page 5 of 200" or "05:12 / 14:00 or 12% of book"
  percentage: number; // 0 to 100 (for progress bars)
  tooltip?: string; // "1% ≈ 4 min" (The pop-up hint) (For ebook)
}

export interface IReader {
  // Navigation
  next(): void;
  previous(): void;
  goTo(target: string | number): void;

  // Data Extraction
  getCurrentLocation(): string | null; // For saving notes

  // View Controls
  zoomIn(): void;
  zoomOut(): void;

  // Reactive State
  toc: Signal<TocItem[]>;
  progress: Signal<ReaderProgress>;
}
