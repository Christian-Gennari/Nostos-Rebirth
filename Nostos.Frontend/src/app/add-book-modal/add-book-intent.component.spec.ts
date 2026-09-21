import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AddBookIntent } from './add-book-intent.component';

/**
 * The Add Book chooser. Its whole job is to ask one question and report the
 * answer, so the tests pin the two answers and that cancelling is a third.
 */
describe('AddBookIntent', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<AddBookIntent>>;
  let component: AddBookIntent;

  const choices = () => fixture.nativeElement.querySelectorAll('.add-intent-choice') as NodeListOf<HTMLElement>;

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

  it('offers exactly two ways to add a book, each said in full', () => {
    expect(choices().length).toBe(2);

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Add by hand');
    expect(text).toContain('Import from a source');
    // Each choice explains itself: the labels alone assume the user knows what
    // "from a source" means here.
    expect(text).toContain('Type the title, author and details yourself');
    expect(text).toContain('Project Gutenberg and LibriVox');
  });

  it('exposes the question as a labelled dialog', () => {
    const card = fixture.nativeElement.querySelector('[role="dialog"]');
    expect(card).toBeTruthy();
    expect(card.getAttribute('aria-labelledby')).toBe('add-intent-title');
    expect(fixture.nativeElement.querySelector('#add-intent-title').textContent).toContain(
      'Add a book',
    );
  });

  it('emits manual for the by-hand choice and source for the import one', () => {
    let manual = 0;
    let source = 0;
    component.manual.subscribe(() => manual++);
    component.source.subscribe(() => source++);

    choices()[0].click();
    choices()[1].click();

    expect(manual).toBe(1);
    expect(source).toBe(1);
  });

  it('uses the canonical button primitive for the ordinary Cancel action', () => {
    const cancel = fixture.nativeElement.querySelector('.add-intent-actions button') as HTMLButtonElement;
    expect(cancel.classList.contains('nostos-button')).toBe(true);
    expect(cancel.classList.contains('nostos-button--secondary')).toBe(true);
  });

  it('emits cancel on the Cancel button and on a backdrop click', () => {
    let cancelled = 0;
    component.cancel.subscribe(() => cancelled++);

    (fixture.nativeElement.querySelector('.add-intent-actions button') as HTMLElement).click();
    (fixture.nativeElement.querySelector('.modal-backdrop') as HTMLElement).click();

    expect(cancelled).toBe(2);
  });
});
