import { NoteFormatPipe } from './note-format.pipe';
import { ConceptDto } from '../../core/services/concepts.service';

describe('NoteFormatPipe', () => {
  const pipe = new NoteFormatPipe();
  const concept: ConceptDto = { id: 'concept-1', name: 'Freedom', usageCount: 2 };
  const map = new Map<string, ConceptDto>([['freedom', concept]]);

  it('renders a resolved wikilink as an accessible Brain link', () => {
    const html = pipe.transform('Thinking about [[Freedom]].', map);

    expect(html).toContain('class="concept-tag clickable"');
    expect(html).toContain('href="/second-brain?conceptId=concept-1"');
    expect(html).toContain('data-concept-id="concept-1"');
    expect(html).toContain('open concept evidence in Brain');
    expect(html).toContain('>Freedom</a>');
  });

  it('keeps an unresolved wikilink visibly unresolved', () => {
    const html = pipe.transform('Thinking about [[Missing idea]].', map);

    expect(html).toContain('concept-tag--unresolved');
    expect(html).toContain('Missing idea');
    expect(html).toContain('unresolved');
    expect(html).toContain('Concept not found');
  });

  it('shows unresolved state even when the concept index is empty', () => {
    const html = pipe.transform('[[Unindexed]]', new Map());

    expect(html).toContain('concept-tag--unresolved');
    expect(html).not.toBe('[[Unindexed]]');
  });
});
