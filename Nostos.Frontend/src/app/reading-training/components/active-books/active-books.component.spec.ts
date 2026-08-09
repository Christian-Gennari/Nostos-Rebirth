import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  ReadingAssignmentStatus,
  ReadingBookAssignment,
  ReadingMode,
} from '../../../core/dtos/reading-training.dtos';
import { ActiveBooksComponent } from './active-books.component';

function assignment(overrides: Partial<ReadingBookAssignment>): ReadingBookAssignment {
  return {
    id: overrides.id ?? 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    bookId: overrides.bookId ?? 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    // Explicit null overrides must survive: the component falls back to the
    // raw library id when the title/author are missing from the DTO.
    bookTitle: overrides.bookTitle === undefined ? 'Meditations' : overrides.bookTitle,
    bookAuthor: overrides.bookAuthor === undefined ? 'Marcus Aurelius' : overrides.bookAuthor,
    mode: overrides.mode ?? ReadingMode.Endurance,
    status: overrides.status ?? ReadingAssignmentStatus.Active,
    queueOrder: overrides.queueOrder ?? 0,
    isDefault: overrides.isDefault ?? false,
    createdAt: overrides.createdAt ?? '2026-08-09T08:00:00+02:00',
    startedAt: overrides.startedAt ?? null,
    completedAt: overrides.completedAt ?? null,
  };
}

const FORBIDDEN = /\b(streak|debt|catch-?up|guilt|fail|missed|delete|success)\b/i;

describe('ActiveBooksComponent', () => {
  let fixture: ComponentFixture<ActiveBooksComponent>;
  let component: ActiveBooksComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ActiveBooksComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(ActiveBooksComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function setBooks(books: ReadingBookAssignment[]): void {
    fixture.componentRef.setInput('books', books);
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')) as HTMLButtonElement[];
  }

  it('renders mode groups in order with queue order and default marker', () => {
    const enduranceDefault = assignment({ id: 'a1', bookTitle: 'Meditations', queueOrder: 1, isDefault: true });
    const enduranceQueued = assignment({ id: 'a2', bookTitle: 'Letters', queueOrder: 0 });
    const deep = assignment({ id: 'b1', bookTitle: 'Being and Time', mode: ReadingMode.Deep, bookAuthor: 'Heidegger' });
    const recovery = assignment({ id: 'c1', bookTitle: 'Meditations II', mode: ReadingMode.Recovery });
    setBooks([recovery, deep, enduranceDefault, enduranceQueued]);

    const headings = Array.from(fixture.nativeElement.querySelectorAll('h3')).map((h) => (h as HTMLElement).textContent);
    expect(headings).toEqual(['Endurance', 'Deep', 'Recovery']);

    const books = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.book-title'));
    // Endurance queue is sorted by queueOrder: Letters (0) before Meditations (1).
    expect(books[0]?.textContent).toContain('Letters');
    expect(books[1]?.textContent).toContain('Meditations');
    expect(books[1]?.textContent).toContain('Default');
    expect(text()).toContain('by Heidegger');
  });

  it('preserves library identity: title, author, and book id fallback', () => {
    setBooks([
      assignment({ id: 'a1', bookTitle: 'Meditations' }),
      assignment({ id: 'a2', bookTitle: null, bookAuthor: null, queueOrder: 1 }),
    ]);
    expect(text()).toContain('Meditations');
    expect(text()).toContain('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  });

  it('emits finish with the exact assignment and never says delete', () => {
    const emitted: ReadingBookAssignment[] = [];
    component.finish.subscribe((book) => emitted.push(book));
    const book = assignment({ id: 'a1', bookTitle: 'Meditations' });
    setBooks([book]);

    const finishButton = buttons().find((b) => b.textContent?.includes('Finish training book'));
    expect(finishButton).toBeDefined();
    finishButton?.click();

    expect(emitted).toEqual([book]);
    expect(text()).not.toMatch(/delete/i);
  });

  it('emits setDefault with the assignment only for active non-default books', () => {
    const emitted: ReadingBookAssignment[] = [];
    component.setDefault.subscribe((book) => emitted.push(book));
    const active = assignment({ id: 'a1', queueOrder: 0 });
    const queued = assignment({ id: 'a2', queueOrder: 1, status: ReadingAssignmentStatus.Queued });
    const alreadyDefault = assignment({ id: 'a3', queueOrder: 2, isDefault: true });
    setBooks([active, queued, alreadyDefault]);

    const makeDefaultButtons = buttons().filter((b) => b.textContent?.includes('Make default'));
    expect(makeDefaultButtons.length).toBe(1);
    makeDefaultButtons[0]?.click();
    expect(emitted).toEqual([active]);
  });

  it('reorders via keyboard-safe buttons and emits the full new queue order', () => {
    const events: Array<{ mode: ReadingMode; assignmentIds: string[] }> = [];
    component.reorder.subscribe((event) => events.push(event));
    const first = assignment({ id: 'a1', queueOrder: 0 });
    const second = assignment({ id: 'a2', queueOrder: 1 });
    setBooks([first, second]);

    const items = Array.from(fixture.nativeElement.querySelectorAll('.queue-item')) as HTMLElement[];
    const firstUp = items[0]?.querySelector('button[aria-label*="up"]') as HTMLButtonElement;
    const firstDown = items[0]?.querySelector('button[aria-label*="down"]') as HTMLButtonElement;
    const secondDown = items[1]?.querySelector('button[aria-label*="down"]') as HTMLButtonElement;

    // Boundaries are disabled: first item cannot move up, last cannot move down.
    expect(firstUp.disabled).toBe(true);
    expect(secondDown.disabled).toBe(true);
    expect(firstDown.disabled).toBe(false);
    const secondUpButton = items[1]?.querySelector('button[aria-label*="up"]') as HTMLButtonElement | undefined;
    expect(secondUpButton?.disabled).toBe(false);

    firstDown?.click();
    expect(events).toEqual([{ mode: ReadingMode.Endurance, assignmentIds: ['a2', 'a1'] }]);

    // Pure presentation: the emitted intent never mutates the component's own
    // input — the parent applies the order and feeds the new server DTOs back.
    expect(component.books()).toEqual([first, second]);

    setBooks([assignment({ id: 'a2', queueOrder: 0 }), assignment({ id: 'a1', queueOrder: 1 })]);
    const after = Array.from(fixture.nativeElement.querySelectorAll('.queue-item')) as HTMLElement[];
    const movedSecondUp = after[1]?.querySelector('button[aria-label*="up"]') as HTMLButtonElement;
    movedSecondUp?.click();
    expect(events).toEqual([
      { mode: ReadingMode.Endurance, assignmentIds: ['a2', 'a1'] },
      { mode: ReadingMode.Endurance, assignmentIds: ['a1', 'a2'] },
    ]);
  });

  it('emits addRequested with the group mode', () => {
    const modes: ReadingMode[] = [];
    component.addRequested.subscribe((mode) => modes.push(mode));
    setBooks([]);
    const addButtons = buttons().filter((b) => b.textContent?.includes('Add book'));
    expect(addButtons.length).toBe(3);
    addButtons[0]?.click();
    addButtons[2]?.click();
    expect(modes).toEqual([ReadingMode.Endurance, ReadingMode.Recovery]);
  });

  it('renders an empty state when no books are assigned', () => {
    setBooks([]);
    expect(text()).toContain('No training books yet');
  });

  it('renders finished books without a finish action', () => {
    setBooks([
      assignment({ id: 'a1' }),
      assignment({ id: 'a2', queueOrder: 1, status: ReadingAssignmentStatus.Completed }),
    ]);
    expect(text()).toContain('Finished');
    expect(buttons().some((b) => b.textContent?.includes('Finish training book'))).toBe(true);
    // Only one finish button: for the active book, not the finished one.
    const finishButtons = buttons().filter((b) => b.textContent?.includes('Finish training book'));
    expect(finishButtons.length).toBe(1);
  });

  it('disables every action button while mutating', () => {
    const book = assignment({ id: 'a1' });
    setBooks([book]);
    fixture.componentRef.setInput('mutating', true);
    fixture.detectChanges();
    for (const button of buttons()) {
      expect(button.disabled).toBe(true);
    }
  });

  it('exposes an accessible heading and aria-labelled reorder buttons', () => {
    setBooks([assignment({ id: 'a1' }), assignment({ id: 'a2', queueOrder: 1 })]);
    const heading = fixture.nativeElement.querySelector('h2#active-books-heading') as HTMLElement;
    expect(heading).toBeTruthy();
    expect(heading.textContent).toContain('Active books');
    const reorder = fixture.nativeElement.querySelector('button[aria-label="Move Meditations down"]') as HTMLButtonElement;
    expect(reorder).toBeTruthy();
    expect(fixture.nativeElement.querySelector('section[aria-labelledby="active-books-heading"]')).toBeTruthy();
  });

  it('contains no streak/debt/guilt/failure language', () => {
    setBooks([
      assignment({ id: 'a1' }),
      assignment({ id: 'a2', queueOrder: 1, status: ReadingAssignmentStatus.Completed }),
    ]);
    expect(text()).not.toMatch(FORBIDDEN);
  });
});
