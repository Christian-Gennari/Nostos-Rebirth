import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChipComponent } from './chip.component';

@Component({
  standalone: true,
  imports: [ChipComponent],
  template: `
    <button appChip type="button" aria-label="Remove Philosophy filter">
      Philosophy
    </button>
    <button appChip type="button" aria-pressed="false">Unread</button>
    <button appChip type="button" aria-pressed="true">Finished</button>
  `,
})
class ChipHarnessComponent {}

describe('ChipComponent', () => {
  let fixture: ComponentFixture<ChipHarnessComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChipHarnessComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ChipHarnessComponent);
    fixture.detectChanges();
  });

  it('keeps native button and caller-owned accessibility semantics', () => {
    const chips = fixture.nativeElement.querySelectorAll(
      'button.nostos-chip',
    ) as NodeListOf<HTMLButtonElement>;

    expect(chips[0].tagName).toBe('BUTTON');
    expect(chips[0].type).toBe('button');
    expect(chips[0].getAttribute('aria-label')).toBe('Remove Philosophy filter');
    expect(chips[0].getAttribute('aria-pressed')).toBeNull();
    expect(chips[1].getAttribute('aria-pressed')).toBe('false');
    expect(chips[2].getAttribute('aria-pressed')).toBe('true');
  });

  it('does not turn an ordinary action into a chip through extra semantics', () => {
    const chip = fixture.nativeElement.querySelector(
      'button.nostos-chip',
    ) as HTMLButtonElement;

    expect(chip.getAttribute('role')).toBeNull();
    expect(chip.disabled).toBe(false);
  });
});
