import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AddBookIntent } from './add-book-intent.component';

/**
 * The Add Book chooser answers one acquisition question. These tests keep the
 * four user-facing paths stable without coupling them to provider internals.
 */
describe('AddBookIntent', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<AddBookIntent>>;
  let component: AddBookIntent;

  const choices = () =>
    fixture.nativeElement.querySelectorAll('.add-intent-choice') as NodeListOf<HTMLElement>;

  const pressBackdrop = () => {
    const backdrop = fixture.nativeElement.querySelector('.modal-backdrop') as HTMLElement;
    for (const type of ['pointerdown', 'pointerup'] as const) {
      const event = new Event(type, { bubbles: true }) as PointerEvent;
      Object.defineProperty(event, 'pointerId', { value: 1 });
      backdrop.dispatchEvent(event);
    }
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AddBookIntent] }).compileComponents();

    fixture = TestBed.createComponent(AddBookIntent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('isOpen', true);
    await fixture.whenStable();
  });

  it('renders nothing while closed', async () => {
    fixture.componentRef.setInput('isOpen', false);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.add-intent-card')).toBeNull();
  });

  it('offers four acquisition-oriented ways to add a book', () => {
    expect(choices().length).toBe(4);

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Upload a book file');
    expect(text).toContain('Find a free book');
    expect(text).toContain('Add a physical book');
    expect(text).toContain('Enter manually');

    expect(text).toContain('EPUB, PDF, or supported audiobook file');
    expect(text).toContain('Search free books and audiobooks in one place');
    expect(text).toContain('Identify a print book by ISBN');
    expect(text).toContain('Create a library record when no file or lookup is useful');

    expect(text).not.toContain('Project Gutenberg');
    expect(text).not.toContain('LibriVox');
    expect(text).not.toContain('Wikisource');
  });

  it('exposes the question as a labelled dialog', () => {
    const card = fixture.nativeElement.querySelector('[role="dialog"]');
    expect(card).toBeTruthy();
    expect(card.getAttribute('aria-labelledby')).toBe('add-intent-title');
    expect(fixture.nativeElement.querySelector('#add-intent-title').textContent).toContain(
      'Add a book',
    );
  });

  it('emits the selected acquisition intent', () => {
    let upload = 0;
    let source = 0;
    let physical = 0;
    let manual = 0;

    component.upload.subscribe(() => upload++);
    component.source.subscribe(() => source++);
    component.physical.subscribe(() => physical++);
    component.manual.subscribe(() => manual++);

    choices()[0].click();
    choices()[1].click();
    choices()[2].click();
    choices()[3].click();

    expect(upload).toBe(1);
    expect(source).toBe(1);
    expect(physical).toBe(1);
    expect(manual).toBe(1);
  });

  it('uses semantic buttons for every acquisition choice', () => {
    for (const choice of Array.from(choices())) {
      expect(choice.tagName).toBe('BUTTON');
      expect((choice as HTMLButtonElement).type).toBe('button');
    }
  });

  it('uses the canonical button primitive for the ordinary Cancel action', () => {
    const cancel = fixture.nativeElement.querySelector(
      '.add-intent-actions button',
    ) as HTMLButtonElement;
    expect(cancel.classList.contains('nostos-button')).toBe(true);
    expect(cancel.classList.contains('nostos-button--secondary')).toBe(true);
  });

  it('emits cancel on the Cancel button and on a backdrop press', () => {
    let cancelled = 0;
    component.cancel.subscribe(() => cancelled++);

    (fixture.nativeElement.querySelector('.add-intent-actions button') as HTMLElement).click();
    pressBackdrop();

    expect(cancelled).toBe(2);
  });
});
