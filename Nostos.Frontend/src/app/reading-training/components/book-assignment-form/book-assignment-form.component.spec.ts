import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ReadingMode } from '../../../core/dtos/reading-training.dtos';
import {
  AvailableBook,
  BookAssignmentDraft,
  BookAssignmentFormComponent,
  modeLabel,
} from './book-assignment-form.component';

function book(overrides: Partial<AvailableBook>): AvailableBook {
  return {
    bookId: overrides.bookId ?? 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    title: overrides.title ?? 'Meditations',
    author: overrides.author ?? 'Marcus Aurelius',
  };
}

const FORBIDDEN = /\b(streak|debt|catch-?up|guilt|fail|missed|delete|success)\b/i;

describe('BookAssignmentFormComponent', () => {
  let fixture: ComponentFixture<BookAssignmentFormComponent>;
  let component: BookAssignmentFormComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BookAssignmentFormComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(BookAssignmentFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function setBooks(books: AvailableBook[]): void {
    fixture.componentRef.setInput('availableBooks', books);
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function bookSelect(): HTMLSelectElement {
    return fixture.nativeElement.querySelector('#book-assignment-book') as HTMLSelectElement;
  }

  function modeSelect(): HTMLSelectElement {
    return fixture.nativeElement.querySelector('#book-assignment-mode') as HTMLSelectElement;
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')) as HTMLButtonElement[];
  }

  function submit(): void {
    const button = buttons().find((b) => b.textContent?.includes('Add book'));
    expect(button).toBeDefined();
    button?.click();
    fixture.detectChanges();
  }

  it('defaults to the first available book from the input and shows title and author', () => {
    setBooks([
      book({ bookId: 'b1', title: 'Letters', author: null }),
      book({ bookId: 'b2', title: 'Meditations', author: 'Marcus Aurelius' }),
    ]);
    expect(bookSelect().value).toBe('b1');
    expect(text()).toContain('Letters');
    expect(text()).toContain('Meditations');
    expect(text()).toContain('Marcus Aurelius');
  });

  it('emits the exact add-book draft with numeric enum mode', () => {
    setBooks([book({ bookId: 'b9', title: 'Being and Time', author: 'Heidegger' })]);
    const drafts: BookAssignmentDraft[] = [];
    component.add.subscribe((d) => drafts.push(d));

    modeSelect().value = String(ReadingMode.Deep);
    modeSelect().dispatchEvent(new Event('change'));
    fixture.detectChanges();
    submit();

    expect(drafts).toEqual([
      { bookId: 'b9', mode: ReadingMode.Deep, makeDefault: false },
    ]);
  });

  it('emits makeDefault when the queue/default intent is opted in', () => {
    setBooks([book({ bookId: 'b1' })]);
    const drafts: BookAssignmentDraft[] = [];
    component.add.subscribe((d) => drafts.push(d));

    const checkbox = fixture.nativeElement.querySelector('#book-assignment-make-default') as HTMLInputElement;
    checkbox.click();
    fixture.detectChanges();
    submit();

    expect(drafts).toEqual([
      { bookId: 'b1', mode: ReadingMode.Endurance, makeDefault: true },
    ]);
  });

  it('shows the empty state and never emits when no books are available', () => {
    setBooks([]);
    expect(text()).toContain('No books available to assign.');

    const drafts: BookAssignmentDraft[] = [];
    component.add.subscribe((d) => drafts.push(d));
    expect(bookSelect()).toBeFalsy();
    expect(buttons().length).toBe(0);
    expect(drafts).toEqual([]);
  });

  it('wires keyboard-accessible labels and error regions', () => {
    setBooks([book({ bookId: 'b1' })]);
    const heading = fixture.nativeElement.querySelector('h2#book-assignment-heading') as HTMLElement;
    expect(heading).toBeTruthy();
    expect(fixture.nativeElement.querySelector('section[aria-labelledby="book-assignment-heading"]')).toBeTruthy();

    for (const id of ['book-assignment-book', 'book-assignment-mode', 'book-assignment-make-default']) {
      const control = fixture.nativeElement.querySelector(`#${id}`) as HTMLElement;
      const label = fixture.nativeElement.querySelector(`label[for="${id}"]`) as HTMLElement;
      expect(control).toBeTruthy();
      expect(label).toBeTruthy();
    }
  });

  it('disables all controls while busy', () => {
    setBooks([book({ bookId: 'b1' })]);
    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();
    for (const button of buttons()) {
      expect(button.disabled).toBe(true);
    }
    expect(bookSelect().disabled).toBe(true);
    expect(modeSelect().disabled).toBe(true);
    const checkbox = fixture.nativeElement.querySelector('#book-assignment-make-default') as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });

  it('contains no streak/debt/guilt/failure language', () => {
    setBooks([book({ bookId: 'b1' }), book({ bookId: 'b2', title: 'Letters' })]);
    expect(text()).not.toMatch(FORBIDDEN);
  });

  it('exposes the mode label helper', () => {
    expect(modeLabel(ReadingMode.Endurance)).toBe('Endurance');
    expect(modeLabel(ReadingMode.Deep)).toBe('Deep');
    expect(modeLabel(ReadingMode.Recovery)).toBe('Recovery');
  });
});
