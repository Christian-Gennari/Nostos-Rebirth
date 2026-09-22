import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InputDirective, TextareaDirective } from './form-control.directive';

@Component({
  standalone: true,
  imports: [InputDirective, TextareaDirective],
  template:
    '<input appInput controlSize="compact" type="email" name="email" aria-label="Email" [invalid]="true" />' +
    '<textarea appTextarea name="notes" rows="3" aria-label="Notes"></textarea>',
})
class FormControlHarnessComponent {}

describe('canonical form-control directives', () => {
  let fixture: ComponentFixture<FormControlHarnessComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FormControlHarnessComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FormControlHarnessComponent);
    fixture.detectChanges();
  });

  it('keeps input semantics while applying the canonical compact and invalid contract', () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    expect(input.tagName).toBe('INPUT');
    expect(input.type).toBe('email');
    expect(input.name).toBe('email');
    expect(input.getAttribute('size')).toBeNull();
    expect(input.getAttribute('aria-label')).toBe('Email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.classList.contains('nostos-form-control')).toBe(true);
    expect(input.classList.contains('nostos-form-control--input')).toBe(true);
    expect(input.classList.contains('nostos-form-control--compact')).toBe(true);
  });

  it('keeps textarea semantics and uses the default normal size', () => {
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;

    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea.name).toBe('notes');
    expect(textarea.rows).toBe(3);
    expect(textarea.getAttribute('aria-invalid')).toBeNull();
    expect(textarea.classList.contains('nostos-form-control--textarea')).toBe(true);
    expect(textarea.classList.contains('nostos-form-control--compact')).toBe(false);
  });
\n});
