import { Injectable, signal } from '@angular/core';

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

const MAX_TOASTS = 3;

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 0;

  readonly toasts = signal<Toast[]>([]);

  show(message: string, type: ToastType = 'info', durationMs = 4000): void {
    const trimmed = message.trim();
    if (!trimmed) return;

    const existing = this.toasts().find((t) => t.message === trimmed && t.type === type);
    if (existing) {
      this.dismiss(existing.id);
    }

    const id = this.nextId++;
    this.toasts.update((list) => [...list.slice(-(MAX_TOASTS - 1)), { id, message: trimmed, type }]);

    setTimeout(() => this.dismiss(id), durationMs);
  }

  success(message: string): void {
    this.show(message, 'success');
  }

  error(message: string): void {
    this.show(message, 'error', 5000);
  }

  info(message: string): void {
    this.show(message, 'info');
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
