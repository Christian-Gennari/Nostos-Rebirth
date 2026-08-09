import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ReadingCapture, ReadingCaptureType } from '../../../core/dtos/reading-training.dtos';
import { ReadingInboxComponent } from './reading-inbox.component';

function capture(overrides: Partial<ReadingCapture> = {}): ReadingCapture {
  return {
    id: overrides.id ?? 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    text: overrides.text ?? 'The unexamined life is not worth living.',
    type: overrides.type ?? ReadingCaptureType.Thought,
    bookId: overrides.bookId ?? 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    sessionId: overrides.sessionId ?? null,
    externalId: overrides.externalId ?? null,
    resolved: overrides.resolved ?? false,
    promotedNoteId: overrides.promotedNoteId ?? null,
    createdAt: overrides.createdAt ?? '2026-08-09T18:30:00+02:00',
  };
}

const FORBIDDEN = /\b(streak|debt|catch-?up|guilt|fail|missed|delete|success)\b/i;

describe('ReadingInboxComponent', () => {
  let fixture: ComponentFixture<ReadingInboxComponent>;
  let component: ReadingInboxComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReadingInboxComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(ReadingInboxComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function setCaptures(captures: ReadingCapture[]): void {
    fixture.componentRef.setInput('captures', captures);
    fixture.detectChanges();
  }

  function setBookTitles(titles: Record<string, string>): void {
    fixture.componentRef.setInput('bookTitles', titles);
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')) as HTMLButtonElement[];
  }

  function buttonByLabel(label: string): HTMLButtonElement | undefined {
    return buttons().find((b) => b.getAttribute('aria-label') === label);
  }

  it('shows the empty state with no actions when no captures are waiting', () => {
    setCaptures([]);
    expect(text()).toContain('No captures waiting');
    expect(fixture.nativeElement.querySelector('.count-badge')).toBeNull();
    expect(buttons()).toHaveLength(0);
  });

  it('renders capture text verbatim without editing, escaping, or truncating', () => {
    const raw = 'She said "keep this <exact> & verbatim"\nsecond line…';
    setCaptures([capture({ id: 'c1', text: raw })]);
    const node = fixture.nativeElement.querySelector('.capture-text') as HTMLElement;
    expect(node.textContent).toBe(raw);
    expect(text()).toContain(raw);
  });

  it('labels capture types from the numeric enum', () => {
    setCaptures([
      capture({ id: 'c1', type: ReadingCaptureType.Thought, text: 't1' }),
      capture({ id: 'c2', type: ReadingCaptureType.Question, text: 't2' }),
      capture({ id: 'c3', type: ReadingCaptureType.Bookmark, text: 't3' }),
    ]);
    expect(text()).toContain('Thought');
    expect(text()).toContain('Question');
    expect(text()).toContain('Bookmark');
    // Unknown numeric values fall back to a neutral label.
    expect(component.captureTypeLabel(99 as ReadingCaptureType)).toBe('Capture');
  });

  it('shows the count badge only when captures exist', () => {
    setCaptures([]);
    expect(fixture.nativeElement.querySelector('.count-badge')).toBeNull();
    setCaptures([capture({ id: 'c1' }), capture({ id: 'c2' })]);
    expect((fixture.nativeElement.querySelector('.count-badge') as HTMLElement).textContent?.trim()).toBe('2');
  });

  it('resolves the book label from the display-only map and falls back to the raw book id', () => {
    setBookTitles({ 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb': 'Meditations' });
    setCaptures([
      capture({ id: 'c1' }),
      capture({ id: 'c2', bookId: 'unknown-book-id' }),
    ]);
    expect(text()).toContain('Meditations');
    expect(text()).toContain('unknown-book-id');
  });

  it('emits keep/promote/dismiss with the exact capture entity', () => {
    const kept: ReadingCapture[] = [];
    const promoted: ReadingCapture[] = [];
    const dismissed: ReadingCapture[] = [];
    component.keepRequested.subscribe((c) => kept.push(c));
    component.promoteRequested.subscribe((c) => promoted.push(c));
    component.dismiss.subscribe((c) => dismissed.push(c));
    const c = capture({ id: 'c1', text: 'A question worth keeping.' });
    setCaptures([c]);

    buttonByLabel('Keep capture: A question worth keeping.')?.click();
    buttonByLabel('Promote capture to a note: A question worth keeping.')?.click();
    buttonByLabel('Dismiss capture: A question worth keeping.')?.click();

    expect(kept).toEqual([c]);
    expect(promoted).toEqual([c]);
    expect(dismissed).toEqual([c]);
  });

  it('keeps the emitted entity identical even when a display title is mapped', () => {
    const c = capture({ id: 'c1', text: 'raw text' });
    setBookTitles({ [c.bookId]: 'Display Title' });
    setCaptures([c]);
    const kept: ReadingCapture[] = [];
    component.keepRequested.subscribe((x) => kept.push(x));
    buttonByLabel('Keep capture: raw text')?.click();
    expect(kept).toEqual([c]);
    expect(kept[0]?.text).toBe('raw text');
  });

  it('disables every action while mutating', () => {
    setCaptures([capture({ id: 'c1' }), capture({ id: 'c2' })]);
    fixture.componentRef.setInput('mutating', true);
    fixture.detectChanges();
    for (const button of buttons()) {
      expect(button.disabled).toBe(true);
    }
  });

  it('exposes an accessible heading, landmark, and labelled actions', () => {
    setCaptures([capture({ id: 'c1', text: 'x' })]);
    const heading = fixture.nativeElement.querySelector('h2#inbox-heading') as HTMLElement;
    expect(heading).toBeTruthy();
    expect(heading.textContent).toContain('Reading inbox');
    expect(fixture.nativeElement.querySelector('section[aria-labelledby="inbox-heading"]')).toBeTruthy();
    expect(buttonByLabel('Keep capture: x')).toBeTruthy();
    expect(buttonByLabel('Promote capture to a note: x')).toBeTruthy();
    expect(buttonByLabel('Dismiss capture: x')).toBeTruthy();
  });

  it('contains no streak/debt/guilt/failure language', () => {
    setCaptures([
      capture({ id: 'c1', text: 'ordinary note' }),
      capture({ id: 'c2', type: ReadingCaptureType.Bookmark, text: 'another note' }),
    ]);
    expect(text()).not.toMatch(FORBIDDEN);
  });
});
