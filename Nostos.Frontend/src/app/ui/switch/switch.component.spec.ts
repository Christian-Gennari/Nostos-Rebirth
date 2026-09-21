import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SwitchComponent } from './switch.component';

@Component({
  standalone: true,
  imports: [SwitchComponent],
  template: `
    <label appSwitch>
      <input type="checkbox" aria-label="Automatic backup" />
    </label>
    <label appSwitch>
      <input type="checkbox" aria-label="Unavailable setting" disabled aria-disabled="true" />
    </label>
  `,
})
class SwitchHarnessComponent {}

describe('SwitchComponent', () => {
  let fixture: ComponentFixture<SwitchHarnessComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SwitchHarnessComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SwitchHarnessComponent);
    fixture.detectChanges();
  });

  it('keeps checkbox state and accessibility semantics on the native input', () => {
    const input = fixture.nativeElement.querySelector(
      'label.nostos-switch input',
    ) as HTMLInputElement;

    expect(input.type).toBe('checkbox');
    expect(input.getAttribute('aria-label')).toBe('Automatic backup');
    expect(input.getAttribute('role')).toBeNull();
    expect(input.checked).toBe(false);

    input.click();
    fixture.detectChanges();

    expect(input.checked).toBe(true);
  });

  it('preserves native disabled semantics and owns only the visual track', () => {
    const labels = fixture.nativeElement.querySelectorAll(
      'label.nostos-switch',
    ) as NodeListOf<HTMLLabelElement>;
    const disabledInput = labels[1].querySelector('input') as HTMLInputElement;

    expect(disabledInput.disabled).toBe(true);
    expect(disabledInput.getAttribute('aria-disabled')).toBe('true');
    expect(labels[1].querySelectorAll('.nostos-switch-track').length).toBe(1);

    disabledInput.click();
    expect(disabledInput.checked).toBe(false);
  });
});
