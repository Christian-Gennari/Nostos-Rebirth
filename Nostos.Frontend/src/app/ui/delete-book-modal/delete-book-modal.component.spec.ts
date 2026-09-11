import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DeleteBookModal } from './delete-book-modal.component';

describe('DeleteBookModal', () => {
  let component: DeleteBookModal;
  let fixture: ComponentFixture<DeleteBookModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeleteBookModal],
    }).compileComponents();

    fixture = TestBed.createComponent(DeleteBookModal);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();
  });

  it('is not visible when isOpen is false', () => {
    expect(fixture.nativeElement.querySelector('.delete-modal-card')).toBeNull();
  });

  it('renders title, description and actions when isOpen is true', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('bookTitle', 'Meditations');
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('.delete-modal-card');
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('Delete "Meditations"?');
    expect(card.textContent).toContain('cannot be undone');
    expect(card.querySelector('.btn-delete-confirm')).toBeTruthy();
    expect(card.querySelector('.btn-cancel')).toBeTruthy();
  });

  it('emits cancel on Cancel button click', () => {
    const cancelSpy = vi.fn();
    component.cancel.subscribe(cancelSpy);

    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    const cancelBtn = fixture.nativeElement.querySelector('.btn-cancel') as HTMLButtonElement;
    cancelBtn.click();

    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it('emits confirm on Delete button click', () => {
    const confirmSpy = vi.fn();
    component.confirm.subscribe(confirmSpy);

    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    const deleteBtn = fixture.nativeElement.querySelector('.btn-delete-confirm') as HTMLButtonElement;
    deleteBtn.click();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it('emits cancel on Escape keydown while open', () => {
    const cancelSpy = vi.fn();
    component.cancel.subscribe(cancelSpy);

    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it('disables buttons and shows spinner when deleting is true', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('deleting', true);
    fixture.detectChanges();

    const deleteBtn = fixture.nativeElement.querySelector('.btn-delete-confirm') as HTMLButtonElement;
    const cancelBtn = fixture.nativeElement.querySelector('.btn-cancel') as HTMLButtonElement;

    expect(deleteBtn.disabled).toBe(true);
    expect(cancelBtn.disabled).toBe(true);
    expect(deleteBtn.textContent).toContain('Deleting…');
  });
});
