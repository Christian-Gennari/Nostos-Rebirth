import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class TreeDragService {
  // A single, stable signal for ALL active drop lists in the tree
  readonly dropListIds = signal<string[]>([]);

  register(id: string) {
    this.dropListIds.update((ids) => {
      // Prevent duplicates just in case
      if (ids.includes(id)) return ids;
      return [...ids, id];
    });
  }

  unregister(id: string) {
    this.dropListIds.update((ids) => ids.filter((existingId) => existingId !== id));
  }
}
