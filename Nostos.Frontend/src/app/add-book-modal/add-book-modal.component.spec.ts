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
