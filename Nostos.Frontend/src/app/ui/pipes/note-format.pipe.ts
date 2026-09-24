import { Pipe, PipeTransform } from '@angular/core';
import { ConceptDto } from '../../core/services/concepts.service';

@Pipe({
  name: 'noteFormat',
  standalone: true,
})
export class NoteFormatPipe implements PipeTransform {
  transform(content: string, conceptMap: Map<string, ConceptDto> | null): string {
    if (!content) return '';

    const concepts = conceptMap ?? new Map<string, ConceptDto>();

    return content.replace(/\[\[(.*?)\]\]/g, (_match, conceptName: string) => {
      const trimmedName = conceptName.trim();
      const escapedName = this.escapeHtml(trimmedName);
      const concept = concepts.get(trimmedName.toLocaleLowerCase());

      if (concept) {
        const href = `/brain?conceptId=${encodeURIComponent(concept.id)}`;
        return `<a class="concept-tag clickable" href="${href}" data-concept-id="${concept.id}" aria-label="${escapedName} — open concept evidence in Brain">${escapedName}</a>`;
      }

      // Keep the link identity visible even when its backing concept is missing.
      // Silent plain text made a broken relationship look intentional.
      return `<span class="concept-tag concept-tag--unresolved" aria-label="Unresolved concept: ${escapedName}" title="Concept not found">${escapedName}<span class="concept-unresolved-label"> · unresolved</span></span>`;
    });
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
