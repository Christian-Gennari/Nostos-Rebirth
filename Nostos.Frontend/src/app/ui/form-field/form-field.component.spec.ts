import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { FormFieldComponent } from './form-field.component';

@Component({
  standalone: true,
  imports: [FormFieldComponent],
  template:
    '<app-form-field label="Title" forId="book-title" [required]="true" labelNote="(Harvard)" hint="Use the edition title." error="Title is required.">' +
    '<input id="book-title" />' +
    '</app-form-field>',
})
class FormFieldHarnessComponent {}

describe('FormFieldComponent', () => {
  let fixture: ComponentFixture<FormFieldHarnessComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FormFieldHarnessComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FormFieldHarnessComponent);
    fixture.detectChanges();
  });

  it('associates the label with the native control and renders required/note state', () => {
    const label = fixture.nativeElement.querySelector('label') as HTMLLabelElement;

    expect(label.htmlFor).toBe('book-title');
    expect(label.textContent).toContain('Title');
    expect(label.textContent).toContain('*');
    expect(label.textContent).toContain('(Harvard)');
  });

  it('renders reusable help and validation messaging with stable description ids', () => {
    const field = fixture.debugElement.query(By.directive(FormFieldComponent))
      .componentInstance as FormFieldComponent;
    const hint = fixture.nativeElement.querySelector('.nostos-form-field__hint') as HTMLElement;
    const error = fixture.nativeElement.querySelector('.nostos-form-field__error') as HTMLElement;

    expect(hint.id).toBe('book-title-hint');
    expect(error.id).toBe('book-title-error');
    expect(error.getAttribute('role')).toBe('alert');
    expect(field.describedBy()).toBe('book-title-hint book-title-error');
  });
});
