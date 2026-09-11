import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AddBookModal } from './add-book-modal.component';
import { Book } from '../core/services/books.service';

const collections = [
  { id: 'root', name: 'Root', parentId: null },
  { id: 'child', name: 'Child', parentId: 'root' },
  { id: 'other', name: 'Other', parentId: null },
];

describe('AddBookModal', () => {
  let component: AddBookModal;
  let fixture: ComponentFixture<AddBookModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AddBookModal],
    }).compileComponents();

    fixture = TestBed.createComponent(AddBookModal);
    component = fixture.componentInstance;
    // isOpen and collections are required inputs; provide them before the first
    // change detection so the constructor effect and template can read them.
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('collections', collections);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('exposes the dialog role', () => {
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('.modal-content');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('emits closeModal on Escape while open', () => {
    const closeSpy = vi.fn();
    component.closeModal.subscribe(closeSpy);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('does not emit closeModal on Escape while closed', () => {
    const closeSpy = vi.fn();
    component.closeModal.subscribe(closeSpy);
    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('focuses the title input on open', async () => {
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const title = fixture.nativeElement.querySelector('input[name="title"]');
    expect(document.activeElement).toBe(title);
  });

  it('renders hierarchical options with indentation derived from parentId', () => {
    fixture.detectChanges();
    const select = fixture.nativeElement.querySelector(
      'select[name="collectionId"]',
    ) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent?.trim() ?? '');

    expect(labels[0]).toBe('No collection');
    expect(labels).toContain('Root');
    expect(labels).toContain('— Child');
    expect(labels).toContain('Other');
  });

  it('preselects the book current collection when editing', () => {
    fixture.componentRef.setInput('book', {
      id: 'b1',
      title: 'Meditations',
      collectionId: 'child',
    } as unknown as Book);
    fixture.detectChanges();

    expect(component.form.collectionId).toBe('child');
  });

  it('selecting "No collection" assigns null', () => {
    fixture.componentRef.setInput('book', {
      id: 'b1',
      title: 'Meditations',
      collectionId: 'child',
    } as unknown as Book);
    fixture.detectChanges();
    expect(component.form.collectionId).toBe('child');

    const select = fixture.nativeElement.querySelector(
      'select[name="collectionId"]',
    ) as HTMLSelectElement;
    const nullOption = Array.from(select.options).find(
      (o) => o.textContent?.trim() === 'No collection',
    )!;
    select.selectedIndex = nullOption.index;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(component.form.collectionId).toBeNull();
  });

  it('does not break when the book references a stale collection id', () => {
    fixture.componentRef.setInput('book', {
      id: 'b1',
      title: 'Meditations',
      collectionId: 'gone',
    } as unknown as Book);
    fixture.detectChanges();

    expect(component.form.collectionId).toBe('gone');
    expect(
      fixture.nativeElement.querySelector('select[name="collectionId"]'),
    ).toBeTruthy();
  });
});
