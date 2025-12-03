import { Pipe, PipeTransform } from '@angular/core';
import { ConceptDto } from '../../services/concepts.services';

@Pipe({
  name: 'noteFormat',
  standalone: true
})
export class NoteFormatPipe implements PipeTransform {

  transform(content: string, conceptMap: Map<string, ConceptDto> | null): string {
    if (!content) return '';
    if (!conceptMap || conceptMap.size === 0) return content;

    // Replace [[Concept Name]] with span
    return content.replace(/\[\[(.*?)\]\]/g, (match, conceptName) => {
      const trimmedName = conceptName.trim();
      const concept = conceptMap.get(trimmedName.toLowerCase());

      if (concept) {
        // We use data attributes so the parent or a directive can handle the click
        return `<span class="concept-tag clickable" data-concept-id="${concept.id}">${trimmedName}</span>`;
      }

      // If concept not found (yet), just return text
      return trimmedName;
    });
  }
}
