import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  ReadingBookAssignment,
  ReadingConstraint,
  ReadingMode,
} from '../../../core/dtos/reading-training.dtos';
import {
  SessionPlanDraft,
  SessionPlannerComponent,
  isPositiveWholeMinutes,
  modeLabel,
} from './session-planner.component';

function assignment(overrides: Partial<ReadingBookAssignment>): ReadingBookAssignment {
  return {
    id: overrides.id ?? 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    bookId: overrides.bookId ?? 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    bookTitle: overrides.bookTitle ?? 'Meditations',
    bookAuthor: overrides.bookAuthor ?? 'Marcus Aurelius',
    mode: overrides.mode ?? ReadingMode.Endurance,
    status: overrides.status ?? 0,
    queueOrder: overrides.queueOrder ?? 0,
    isDefault: overrides.isDefault ?? false,
    createdAt: overrides.createdAt ?? '2026-08-09T08:00:00+02:00',
    startedAt: overrides.startedAt ?? null,
    completedAt: overrides.completedAt ?? null,
  };
}

const FORBIDDEN = /\b(streak|debt|catch-?up|guilt|fail|missed|delete|success)\b/i;

describe('SessionPlannerComponent', () => {
  let fixture: ComponentFixture<SessionPlannerComponent>;
  let component: SessionPlannerComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionPlannerComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(SessionPlannerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function setBooks(books: ReadingBookAssignment[], preferredMode: ReadingMode | null = null): void {
    fixture.componentRef.setInput('books', books);
    fixture.componentRef.setInput('preferredMode', preferredMode);
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function selectById(id: string): HTMLSelectElement {
    return fixture.nativeElement.querySelector(`#${id}`) as HTMLSelectElement;
  }

  function inputById(id: string): HTMLInputElement {
    return fixture.nativeElement.querySelector(`#${id}`) as HTMLInputElement;
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')) as HTMLButtonElement[];
  }

  function clickButton(label: string): void {
    const button = buttons().find((b) => b.textContent?.includes(label));
    expect(button).toBeDefined();
    button?.click();
    fixture.detectChanges();
  }

  function fillTarget(minutes: string): void {
    const input = inputById('session-planner-target');
    input.value = minutes;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function pickMode(mode: ReadingMode): void {
    const select = selectById('session-planner-mode');
    select.value = String(mode);
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  it('defaults from inputs only: first eligible book and preferred mode', () => {
    setBooks([assignment({ id: 'a1', bookTitle: 'Letters' }), assignment({ id: 'a2' })], ReadingMode.Deep);
    expect(selectById('session-planner-book').value).toBe('a1');
    expect(selectById('session-planner-mode').value).toBe(String(ReadingMode.Deep));
  });

  it('falls back to the first book mode when no preferred mode is given', () => {
    setBooks([assignment({ id: 'a1', mode: ReadingMode.Recovery })]);
    expect(selectById('session-planner-mode').value).toBe(String(ReadingMode.Recovery));
  });

  it('shows the empty state and blocks emission when no books are eligible', () => {
    setBooks([]);
    expect(text()).toContain('No eligible training books.');

    const drafts: SessionPlanDraft[] = [];
    component.plan.subscribe((d) => drafts.push(d));
    expect(buttons()).toHaveLength(0);
    expect(drafts).toEqual([]);
  });

  it('validates the target as a positive whole number before emitting', () => {
    setBooks([assignment({ id: 'a1' })]);
    const drafts: SessionPlanDraft[] = [];
    component.plan.subscribe((d) => drafts.push(d));

    for (const bad of ['', '0', '-5', '1.5', 'abc']) {
      fillTarget(bad);
      clickButton('Plan session');
      expect(drafts).toEqual([]);
      expect(text()).toContain('Enter a whole number of minutes (1 or more).');
    }

    fillTarget('25');
    clickButton('Plan session');
    expect(drafts.length).toBe(1);
    expect(text()).not.toContain('Enter a whole number of minutes');
  });

  it('emits the exact typed draft with numeric enum values', () => {
    setBooks([assignment({ id: 'a1', bookTitle: 'Meditations' })]);
    pickMode(ReadingMode.Deep);

    const drafts: SessionPlanDraft[] = [];
    component.plan.subscribe((d) => drafts.push(d));
    fillTarget('40');
    clickButton('Plan session');

    expect(drafts).toEqual([
      {
        bookAssignmentId: 'a1',
        mode: ReadingMode.Deep, // 1
        targetMinutes: 40,
        constraint: ReadingConstraint.None, // 0
        constrainedMinutes: null,
      },
    ]);
  });

  it('emits startNew through the secondary button with the same draft shape', () => {
    setBooks([assignment({ id: 'a1', mode: ReadingMode.Recovery })]);
    const drafts: SessionPlanDraft[] = [];
    component.startNew.subscribe((d) => drafts.push(d));
    fillTarget('15');
    clickButton('Start now');

    expect(drafts).toEqual([
      {
        bookAssignmentId: 'a1',
        mode: ReadingMode.Recovery, // 2
        targetMinutes: 15,
        constraint: ReadingConstraint.None,
        constrainedMinutes: null,
      },
    ]);
  });

  it('supports a constrained session: extra field, validation, and TimeConstrained draft', () => {
    setBooks([assignment({ id: 'a1' })]);
    fillTarget('40');
    const toggle = inputById('session-planner-constrained');
    toggle.click();
    fixture.detectChanges();

    expect(inputById('session-planner-constrained-minutes')).toBeTruthy();
    const startNow = buttons().find((button) => button.textContent?.includes('Start now'));
    expect(startNow?.disabled).toBe(true);
    expect(startNow?.getAttribute('aria-describedby')).toBe('session-planner-start-note');

    // Invalid constrained minutes block the emission.
    const drafts: SessionPlanDraft[] = [];
    component.plan.subscribe((d) => drafts.push(d));
    const constrainedInput = inputById('session-planner-constrained-minutes');
    constrainedInput.value = '0';
    constrainedInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    clickButton('Plan session');
    expect(drafts).toEqual([]);
    expect(text()).toContain('Constrained minutes must be a whole number (1 or more).');

    constrainedInput.value = '10';
    constrainedInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    clickButton('Plan session');
    expect(drafts).toEqual([
      {
        bookAssignmentId: 'a1',
        mode: ReadingMode.Endurance, // 0
        targetMinutes: 40,
        constraint: ReadingConstraint.TimeConstrained, // 1
        constrainedMinutes: 10,
      },
    ]);
  });

  it('recovery is volume-only: note shown, constraint disabled, draft always unconstrained', () => {
    setBooks([assignment({ id: 'a1' })]);
    pickMode(ReadingMode.Recovery);

    expect(text()).toContain('Recovery sessions count volume only.');
    const toggle = inputById('session-planner-constrained');
    expect(toggle.disabled).toBe(true);
    toggle.click();
    fixture.detectChanges();
    expect(component.constrained()).toBe(false);
    expect(inputById('session-planner-constrained-minutes')).toBeFalsy();

    const drafts: SessionPlanDraft[] = [];
    component.plan.subscribe((d) => drafts.push(d));
    fillTarget('20');
    clickButton('Plan session');
    expect(drafts[0]?.constraint).toBe(ReadingConstraint.None);
    expect(drafts[0]?.constrainedMinutes).toBeNull();
  });

  it('shows the recovery note as the constrained toggle description', () => {
    setBooks([assignment({ id: 'a1' })]);
    pickMode(ReadingMode.Recovery);
    const toggle = inputById('session-planner-constrained');
    expect(toggle.getAttribute('aria-describedby')).toBe('session-planner-recovery-note');
  });

  it('wires keyboard-accessible labels and error regions', () => {
    setBooks([assignment({ id: 'a1' })]);
    const heading = fixture.nativeElement.querySelector('h2#session-planner-heading') as HTMLElement;
    expect(heading).toBeTruthy();
    expect(fixture.nativeElement.querySelector('section[aria-labelledby="session-planner-heading"]')).toBeTruthy();

    for (const id of ['session-planner-book', 'session-planner-mode', 'session-planner-target']) {
      const control = fixture.nativeElement.querySelector(`#${id}`) as HTMLElement;
      const label = fixture.nativeElement.querySelector(`label[for="${id}"]`) as HTMLElement;
      expect(control).toBeTruthy();
      expect(label).toBeTruthy();
    }

    fillTarget('');
    clickButton('Plan session');
    const target = inputById('session-planner-target');
    expect(target.getAttribute('aria-invalid')).toBe('true');
    expect(target.getAttribute('aria-describedby')).toBe('session-planner-target-error');
    expect(fixture.nativeElement.querySelector('#session-planner-target-error[role="alert"]')).toBeTruthy();
  });

  it('disables all controls while busy', () => {
    setBooks([assignment({ id: 'a1' })]);
    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();
    for (const button of buttons()) {
      expect(button.disabled).toBe(true);
    }
    expect(selectById('session-planner-book').disabled).toBe(true);
    expect(inputById('session-planner-target').disabled).toBe(true);
  });

  it('contains no streak/debt/guilt/failure language', () => {
    setBooks([
      assignment({ id: 'a1', bookTitle: 'Meditations' }),
      assignment({ id: 'a2', bookTitle: 'Letters', mode: ReadingMode.Deep }),
    ]);
    pickMode(ReadingMode.Recovery);
    fillTarget('');
    clickButton('Plan session');
    expect(text()).not.toMatch(FORBIDDEN);
  });

  it('exposes the mode label and positive-minutes helpers', () => {
    expect(modeLabel(ReadingMode.Endurance)).toBe('Endurance');
    expect(modeLabel(ReadingMode.Deep)).toBe('Deep');
    expect(modeLabel(ReadingMode.Recovery)).toBe('Recovery');
    expect(isPositiveWholeMinutes('1')).toBe(true);
    expect(isPositiveWholeMinutes('05')).toBe(true);
    expect(isPositiveWholeMinutes('0')).toBe(false);
    expect(isPositiveWholeMinutes('-3')).toBe(false);
    expect(isPositiveWholeMinutes('2.5')).toBe(false);
    expect(isPositiveWholeMinutes('')).toBe(false);
    expect(isPositiveWholeMinutes('  ')).toBe(false);
  });
});
