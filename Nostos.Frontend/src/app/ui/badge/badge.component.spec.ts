import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BadgeComponent } from './badge.component';

@Component({
  standalone: true,
  imports: [BadgeComponent],
  template: `
    <span appBadge>Pending</span>
    <span appBadge tone="success">Completed</span>
    <span appBadge tone="danger">Failed</span>
    <span appBadge tone="success" [dot]="true">On</span>
  `,
})
class BadgeHarnessComponent {}

describe('BadgeComponent', () => {
  let fixture: ComponentFixture<BadgeHarnessComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BadgeHarnessComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(BadgeHarnessComponent);
    fixture.detectChanges();
  });

  it('renders passive native spans without inventing interaction semantics', () => {
    const badges = fixture.nativeElement.querySelectorAll(
      'span.nostos-badge',
    ) as NodeListOf<HTMLSpanElement>;

    expect(badges.length).toBe(4);
    expect(badges[0].tagName).toBe('SPAN');
    expect(badges[0].getAttribute('role')).toBeNull();
    expect(badges[0].getAttribute('tabindex')).toBeNull();
    expect(badges[0].getAttribute('aria-pressed')).toBeNull();
  });

  it('applies state tones and the optional status-dot recipe', () => {
    const badges = fixture.nativeElement.querySelectorAll(
      'span.nostos-badge',
    ) as NodeListOf<HTMLSpanElement>;

    expect(badges[1].classList.contains('nostos-badge--success')).toBe(true);
    expect(badges[2].classList.contains('nostos-badge--danger')).toBe(true);
    expect(badges[3].classList.contains('nostos-badge--dot')).toBe(true);
    expect(badges[3].classList.contains('nostos-badge--success')).toBe(true);
  });
});
