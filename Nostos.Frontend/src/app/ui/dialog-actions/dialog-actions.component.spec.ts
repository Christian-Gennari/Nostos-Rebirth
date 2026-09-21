import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ButtonComponent } from '../button/button.component';
import { DialogActionsComponent } from './dialog-actions.component';

@Component({
  standalone: true,
  imports: [ButtonComponent, DialogActionsComponent],
  template: `
    <app-dialog-actions class="footer-actions">
      <button appButton dialogActionsStart variant="danger" type="button" disabled>
        Delete
      </button>
      <button appButton variant="secondary" type="button">Cancel</button>
      <button appButton variant="primary" type="submit" form="book-form">Save</button>
    </app-dialog-actions>

    <app-dialog-actions variant="inset" [stackOnNarrow]="true" class="inset-actions">
      <button appButton variant="secondary" type="button">No</button>
      <button appButton variant="danger" type="button">Yes, delete</button>
    </app-dialog-actions>
  `,
})
class DialogActionsHarnessComponent {}

describe('DialogActionsComponent', () => {
  let fixture: ComponentFixture<DialogActionsHarnessComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DialogActionsHarnessComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DialogActionsHarnessComponent);
    fixture.detectChanges();
  });

  it('projects a leading action separately from the ordinary trailing actions', () => {
    const footer = fixture.nativeElement.querySelector('.footer-actions') as HTMLElement;
    const start = footer.querySelector('.nostos-dialog-actions__start') as HTMLElement;
    const end = footer.querySelector('.nostos-dialog-actions__end') as HTMLElement;

    expect(start.textContent).toContain('Delete');
    expect(end.textContent).toContain('Cancel');
    expect(end.textContent).toContain('Save');
    expect(end.textContent).not.toContain('Delete');
  });

  it('keeps the projected actions as native buttons with caller-owned semantics', () => {
    const footer = fixture.nativeElement.querySelector('.footer-actions') as HTMLElement;
    const buttons = footer.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
    const deleteButton = buttons[0];
    const cancelButton = buttons[1];
    const saveButton = buttons[2];

    expect(deleteButton.tagName).toBe('BUTTON');
    expect(deleteButton.type).toBe('button');
    expect(deleteButton.disabled).toBe(true);
    expect(deleteButton.classList).toContain('nostos-button--danger');

    expect(cancelButton.type).toBe('button');
    expect(cancelButton.classList).toContain('nostos-button--secondary');

    expect(saveButton.type).toBe('submit');
    expect(saveButton.getAttribute('form')).toBe('book-form');
    expect(saveButton.classList).toContain('nostos-button--primary');
  });

  it('distinguishes the divided footer from inset compact-dialog actions', () => {
    const footer = fixture.nativeElement.querySelector('.footer-actions') as HTMLElement;
    const inset = fixture.nativeElement.querySelector('.inset-actions') as HTMLElement;

    expect(footer.classList).toContain('nostos-dialog-actions--footer');
    expect(footer.classList).not.toContain('nostos-dialog-actions--inset');

    expect(inset.classList).toContain('nostos-dialog-actions--inset');
    expect(inset.classList).toContain('nostos-dialog-actions--stack-narrow');
    expect(inset.classList).not.toContain('nostos-dialog-actions--footer');
  });
});
