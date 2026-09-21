import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { AddBookModal } from './add-book-modal.component';
import { Book, BooksService } from '../core/services/books.service';

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

  it('exposes the dialog role', () => {
    fixture.detectChanges();

    // The role now comes from `app-modal-shell`, so this targets the role rather
    // than a class the shell happens to use — and checks the label the shell was
    // handed, which is what makes the migration more than a markup move.
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Add New Book');
  });

  it('uses DialogActions and canonical native buttons for the ordinary create footer', () => {
    fixture.detectChanges();

    const actions = fixture.nativeElement.querySelector('app-dialog-actions') as HTMLElement;
    const buttons = Array.from(actions.querySelectorAll('button')) as HTMLButtonElement[];
    const cancelButton = buttons.find((button) => button.textContent?.trim() === 'Cancel')!;
    const submitButton = buttons.find((button) => button.textContent?.trim() === 'Create Book')!;

    expect(actions.classList).toContain('nostos-dialog-actions--footer');
    expect(cancelButton.type).toBe('button');
    expect(cancelButton.classList).toContain('nostos-button--secondary');
    expect(submitButton.type).toBe('submit');
    expect(submitButton.getAttribute('form')).toBe('add-book-form');
    expect(submitButton.classList).toContain('nostos-button--primary');
    expect(submitButton.disabled).toBe(true);
    expect(buttons.some((button) => button.textContent?.includes('Delete Book'))).toBe(false);
  });

  it('projects the edit-only destructive action into the leading slot and preserves callbacks', () => {
    const deleteSpy = vi.fn();
    const closeSpy = vi.fn();
    component.deleteBook.subscribe(deleteSpy);
    component.closeModal.subscribe(closeSpy);
    fixture.componentRef.setInput('book', {
      id: 'b1',
      title: 'Meditations',
      type: 'physical',
      collectionIds: [],
    } as unknown as Book);
    fixture.detectChanges();

    const actions = fixture.nativeElement.querySelector('app-dialog-actions') as HTMLElement;
    const start = actions.querySelector('.nostos-dialog-actions__start') as HTMLElement;
    const deleteButton = Array.from(start.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Delete Book'),
    ) as HTMLButtonElement;
    const cancelButton = Array.from(actions.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Cancel'),
    ) as HTMLButtonElement;

    expect(deleteButton).toBeTruthy();
    expect(deleteButton.type).toBe('button');
    expect(deleteButton.classList).toContain('nostos-button--danger');

    deleteButton.click();
    cancelButton.click();

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
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

  it('keeps physical books metadata-only in the create form', () => {
    component.setTab('Files & Personal');
    fixture.detectChanges();

    const digitalFileInput = fixture.nativeElement.querySelector(
      'input[type="file"][accept*=".epub"]',
    );
    expect(digitalFileInput).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Physical books are metadata-only');
    expect(fixture.nativeElement.textContent).toContain('separate book');
  });

  it('clears a chosen digital file when format changes to physical', () => {
    component.onTypeChange('ebook');
    component.selectedFile.set(
      new File(['ebook'], 'meditations.epub', { type: 'application/epub+zip' }),
    );

    component.onTypeChange('physical');

    expect(component.selectedFile()).toBeNull();
  });

  it('never uploads a stale file when creating a physical book', () => {
    const books = TestBed.inject(BooksService);
    vi.spyOn(books, 'create').mockReturnValue(of({ id: 'physical-new' } as unknown as Book));
    const uploadSpy = vi.spyOn(books, 'uploadFile');

    component.form.title = 'Physical Meditations';
    component.form.type = 'physical';
    component.selectedFile.set(new File(['stale'], 'stale.epub', { type: 'application/epub+zip' }));
    component.submit();

    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it('renders the multi-select picker with the hierarchy intact', () => {
    fixture.detectChanges();
    const options = Array.from<Element>(
      fixture.nativeElement.querySelectorAll('app-collection-picker .option'),
    ).map((b) => b.textContent?.trim() ?? '');

    expect(options).toContain('Root');
    expect(options).toContain('Child');
    expect(options).toContain('Other');
  });

  it('preselects the book collection when editing', () => {
    fixture.componentRef.setInput('book', {
      id: 'b1',
      title: 'Meditations',
      collectionIds: ['child'],
    } as unknown as Book);
    fixture.detectChanges();

    expect(component.form.collectionIds).toEqual(['child']);
  });

  it('preselects EVERY membership when the book is in several collections', () => {
    // The defect this replaces: a single <select> could only show one of them.
    fixture.componentRef.setInput('book', {
      id: 'b1',
      title: 'Meditations',
      collectionIds: ['child', 'other'],
    } as unknown as Book);
    fixture.detectChanges();

    expect(component.form.collectionIds).toEqual(['child', 'other']);
  });

  it('unchecking the last collection leaves an empty set, not a stale one', () => {
    fixture.componentRef.setInput('book', {
      id: 'b1',
      title: 'Meditations',
      collectionIds: ['child'],
    } as unknown as Book);
    fixture.detectChanges();
    expect(component.form.collectionIds).toEqual(['child']);

    // Click the option that is actually selected (the picker sorts by name, so
    // index 0 is not it) and confirm the set empties rather than keeping a
    // stale id — the behaviour the old <select> could not express at all.
    const picker = fixture.nativeElement.querySelector('app-collection-picker');
    const pressed = Array.from<Element>(picker.querySelectorAll('.option')).find(
      (b) => b.getAttribute('aria-pressed') === 'true',
    )!;
    (pressed as HTMLElement).click();
    fixture.detectChanges();

    expect(component.form.collectionIds).toEqual([]);
  });

  it('does not break when the book references a stale collection id', () => {
    fixture.componentRef.setInput('book', {
      id: 'b1',
      title: 'Meditations',
      collectionIds: ['gone'],
    } as unknown as Book);
    fixture.detectChanges();

    expect(component.form.collectionIds).toEqual(['gone']);
    expect(fixture.nativeElement.querySelector('app-collection-picker')).toBeTruthy();
  });

  it('submits the membership set as the only collection field', async () => {
    const books = TestBed.inject(BooksService);
    const createSpy = vi
      .spyOn(books, 'create')
      .mockReturnValue(of({ id: 'new' } as unknown as Book));
    fixture.detectChanges();

    component.form.title = 'Meditations';
    component.form.collectionIds = ['child', 'other'];
    component.submit();

    // No singular mirror is written any more — the column is gone, so sending
    // one would be a dead field on the wire.
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ collectionIds: ['child', 'other'] }),
    );
    expect(createSpy.mock.calls[0][0]).not.toHaveProperty('collectionId');
  });
});
