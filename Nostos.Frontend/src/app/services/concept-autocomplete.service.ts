import { Injectable, signal } from '@angular/core';
import { ConceptDto } from './concepts.services';

@Injectable({ providedIn: 'root' })
export class ConceptAutocompleteService {
  suggestions = signal<ConceptDto[]>([]);
  activeIndex = signal<number>(0);

  private concepts: ConceptDto[] = [];

  setConcepts(list: ConceptDto[]) {
    this.concepts = list;
  }

  update(text: string, cursorPos: number) {
    // Find "[[" before cursor
    const start = text.lastIndexOf('[[', cursorPos - 1);
    if (start === -1) {
      this.suggestions.set([]);
      return;
    }

    const end = cursorPos;
    const fragment = text
      .substring(start + 2, end)
      .trim()
      .toLowerCase();

    if (!fragment) {
      this.suggestions.set([]);
      return;
    }

    const matches = this.concepts.filter((c) => c.name.toLowerCase().startsWith(fragment));

    this.suggestions.set(matches);
    this.activeIndex.set(0);
  }

  moveUp() {
    const list = this.suggestions();
    const current = this.activeIndex();
    if (list.length === 0) return;
    this.activeIndex.set((current - 1 + list.length) % list.length);
  }

  moveDown() {
    const list = this.suggestions();
    const current = this.activeIndex();
    if (list.length === 0) return;
    this.activeIndex.set((current + 1) % list.length);
  }

  choose(): ConceptDto | null {
    const list = this.suggestions();
    if (list.length === 0) return null;
    return list[this.activeIndex()];
  }
}
