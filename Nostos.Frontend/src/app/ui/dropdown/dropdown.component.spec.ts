import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DropdownComponent, type DropdownOption } from './dropdown.component';

@Component({
  standalone: true,
  imports: [DropdownComponent],
  template: `
    <app-dropdown
      ariaLabel="Format"
      [options]="options"
      [value]="value"
      [disabled]="disabled()"
      (valueChange)="value = $event"
    />
  `,
})
class DropdownHarnessComponent {
  value = 'epub';
  readonly disabled = signal(false);
  readonly options: readonly DropdownOption[] = [
    { value: 'epub', label: 'EPUB' },
    { value: 'disabled', label: 'Unavailable', disabled: true },
    { value: 'pdf', label: 'PDF' },
  ];
}

describe('DropdownComponent', () => {
  let fixture: ComponentFixture<DropdownHarnessComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DropdownHarnessComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DropdownHarnessComponent);
    fixture.detectChanges();
  });

  it('exposes the selected value through the canonical combobox/listbox contract', () => {
    const trigger = fixture.nativeElement.querySelector(
      '.nostos-dropdown__trigger',
    ) as HTMLButtonElement;

    expect(trigger.getAttribute('role')).toBe('combobox');
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-label')).toBe('Format');
    expect(trigger.textContent).toContain('EPUB');
  });

  it('opens, selects an option, and restores focus to the trigger', async () => {
    const trigger = fixture.nativeElement.querySelector(
      '.nostos-dropdown__trigger',
    ) as HTMLButtonElement;

    trigger.click();
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const options = Array.from(
      fixture.nativeElement.querySelectorAll('[role="option"]'),
    ) as HTMLElement[];
    options.find((option) => option.textContent?.includes('PDF'))!.click();
    fixture.detectChanges();
    await Promise.resolve();

    expect(fixture.componentInstance.value).toBe('pdf');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('skips disabled options during keyboard navigation', () => {
    const trigger = fixture.nativeElement.querySelector(
      '.nostos-dropdown__trigger',
    ) as HTMLButtonElement;

    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance.value).toBe('pdf');
  });

  it('closes on Escape without changing the current value', () => {
    const trigger = fixture.nativeElement.querySelector(
      '.nostos-dropdown__trigger',
    ) as HTMLButtonElement;

    trigger.click();
    fixture.detectChanges();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance.value).toBe('epub');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps a disabled trigger closed', () => {
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector(
      '.nostos-dropdown__trigger',
    ) as HTMLButtonElement;

    expect(trigger.disabled).toBe(true);
    trigger.click();
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes when pointer interaction moves outside the component', () => {
    const trigger = fixture.nativeElement.querySelector(
      '.nostos-dropdown__trigger',
    ) as HTMLButtonElement;

    trigger.click();
    fixture.detectChanges();
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
