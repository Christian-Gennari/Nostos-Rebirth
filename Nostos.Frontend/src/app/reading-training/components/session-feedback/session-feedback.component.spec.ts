import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  ReadingConstraint,
  ReadingMode,
  ReadingSession,
  ReadingSessionStatus,
} from '../../../core/dtos/reading-training.dtos';
import {
  EFFORT_MAX,
  EFFORT_MIN,
  FOCUS_MAX,
  FOCUS_MIN,
  RateSessionDraft,
  SessionFeedbackComponent,
  SkipRatingsDraft,
  isWholeNumberInRange,
  modeLabel,
} from './session-feedback.component';

function session(overrides: Partial<ReadingSession> = {}): ReadingSession {
  return {
    id: overrides.id ?? 'ssssssss-ssss-ssss-ssss-ssssssssssss',
    bookAssignmentId: overrides.bookAssignmentId ?? 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    bookId: overrides.bookId ?? 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    bookTitle: overrides.bookTitle ?? 'Meditations',
    mode: overrides.mode ?? ReadingMode.Endurance,
    status: overrides.status ?? ReadingSessionStatus.AwaitingFeedback,
    targetMinutes: overrides.targetMinutes ?? 30,
    plannedTargetMinutes: overrides.plannedTargetMinutes ?? 30,
    constraint: overrides.constraint ?? ReadingConstraint.None,
    progressionEligible: overrides.progressionEligible ?? true,
    countsAsFailure: overrides.countsAsFailure ?? false,
    accumulatedSeconds: overrides.accumulatedSeconds ?? 1500,
    measuredSeconds: overrides.measuredSeconds ?? 1500,
    reportedMinutes: overrides.reportedMinutes ?? null,
    effort: overrides.effort ?? 0,
    focus: overrides.focus ?? 0,
    rating: overrides.rating ?? null,
    ratingsSkipped: overrides.ratingsSkipped ?? false,
    plannedAt: overrides.plannedAt ?? '2026-08-09T08:00:00+02:00',
    startedAt: overrides.startedAt ?? '2026-08-09T08:05:00+02:00',
    lastStartedAt: overrides.lastStartedAt ?? null,
    pausedAt: overrides.pausedAt ?? null,
    completedAt: overrides.completedAt ?? null,
  };
}

const FORBIDDEN = /\b(streak|debt|catch-?up|guilt|fail|missed|delete|success)\b/i;

describe('SessionFeedbackComponent', () => {
  let fixture: ComponentFixture<SessionFeedbackComponent>;
  let component: SessionFeedbackComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionFeedbackComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(SessionFeedbackComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function setSession(s: ReadingSession | null = null): void {
    fixture.componentRef.setInput('session', s);
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function inputById(id: string): HTMLInputElement {
    return fixture.nativeElement.querySelector(`#${id}`) as HTMLInputElement;
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')) as HTMLButtonElement[];
  }

  function setValue(id: string, value: string): void {
    const input = inputById(id);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function clickButton(label: string): void {
    const button = buttons().find((b) => b.textContent?.includes(label));
    expect(button).toBeDefined();
    button?.click();
    fixture.detectChanges();
  }

  it('renders the session identity and awaits feedback', () => {
    setSession(session({ bookTitle: 'Letters', mode: ReadingMode.Deep }));
    expect(text()).toContain('Letters');
    expect(text()).toContain('Deep');
    expect(text()).toContain('Actual minutes');
    expect(text()).toContain('Effort');
    expect(text()).toContain('Focus');
  });

  it('shows the empty state without a session and never emits', () => {
    setSession(null);
    expect(text()).toContain('No session awaiting feedback.');

    const rated: RateSessionDraft[] = [];
    const skipped: SkipRatingsDraft[] = [];
    component.rate.subscribe((d) => rated.push(d));
    component.skip.subscribe((d) => skipped.push(d));
    expect(buttons()).toHaveLength(0);
    expect(rated).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it('validates minutes, effort, and focus before emitting rate', () => {
    setSession(session());
    const rated: RateSessionDraft[] = [];
    component.rate.subscribe((d) => rated.push(d));

    setValue('session-feedback-minutes', '0');
    setValue('session-feedback-effort', '7');
    setValue('session-feedback-focus', '7');
    clickButton('Log ratings');
    expect(rated).toEqual([]);
    expect(text()).toContain('Enter the actual minutes as a whole number (1 or more).');

    setValue('session-feedback-minutes', '25');
    setValue('session-feedback-effort', '11');
    clickButton('Log ratings');
    expect(rated).toEqual([]);
    expect(text()).toContain(`Effort must be a whole number from ${EFFORT_MIN} to ${EFFORT_MAX}.`);

    setValue('session-feedback-effort', '7');
    setValue('session-feedback-focus', '0');
    clickButton('Log ratings');
    expect(rated).toEqual([]);
    expect(text()).toContain(`Focus must be a whole number from ${FOCUS_MIN} to ${FOCUS_MAX}.`);

    setValue('session-feedback-focus', '1.5');
    clickButton('Log ratings');
    expect(rated).toEqual([]);

    setValue('session-feedback-focus', '3');
    clickButton('Log ratings');
    expect(rated.length).toBe(1);
  });

  it('emits the exact rate draft with the session id and numeric ratings', () => {
    const s = session({ id: 'session-1' });
    setSession(s);
    const rated: RateSessionDraft[] = [];
    component.rate.subscribe((d) => rated.push(d));

    setValue('session-feedback-minutes', '22');
    setValue('session-feedback-effort', '7');
    setValue('session-feedback-focus', '4');
    clickButton('Log ratings');

    expect(rated).toEqual([
      { sessionId: 'session-1', reportedMinutes: 22, effort: 7, focus: 4 },
    ]);
  });

  it('emits skip as a typed intent with only the session id, even with empty fields', () => {
    const s = session({ id: 'session-2' });
    setSession(s);
    const skipped: SkipRatingsDraft[] = [];
    component.skip.subscribe((d) => skipped.push(d));

    clickButton('Skip ratings');
    expect(skipped).toEqual([{ sessionId: 'session-2' }]);
  });

  it('does not infer success or outcome from ratings', () => {
    setSession(session());
    setValue('session-feedback-minutes', '20');
    setValue('session-feedback-effort', '10');
    setValue('session-feedback-focus', '10');
    clickButton('Log ratings');
    expect(text()).not.toMatch(/great|amazing|success|excellent/i);
    expect(text()).not.toMatch(FORBIDDEN);
  });

  it('wires keyboard-accessible labels and per-field error regions', () => {
    setSession(session());
    const heading = fixture.nativeElement.querySelector('h2#session-feedback-heading') as HTMLElement;
    expect(heading).toBeTruthy();
    expect(fixture.nativeElement.querySelector('section[aria-labelledby="session-feedback-heading"]')).toBeTruthy();

    for (const id of ['session-feedback-minutes', 'session-feedback-effort', 'session-feedback-focus']) {
      const control = fixture.nativeElement.querySelector(`#${id}`) as HTMLElement;
      const label = fixture.nativeElement.querySelector(`label[for="${id}"]`) as HTMLElement;
      expect(control).toBeTruthy();
      expect(label).toBeTruthy();
    }

    setValue('session-feedback-effort', '');
    clickButton('Log ratings');
    const effort = inputById('session-feedback-effort');
    expect(effort.getAttribute('aria-invalid')).toBe('true');
    expect(effort.getAttribute('aria-describedby')).toBe('session-feedback-effort-error');
    expect(fixture.nativeElement.querySelector('#session-feedback-effort-error[role="alert"]')).toBeTruthy();
  });

  it('disables all controls while busy', () => {
    setSession(session());
    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();
    for (const button of buttons()) {
      expect(button.disabled).toBe(true);
    }
    expect(inputById('session-feedback-minutes').disabled).toBe(true);
  });

  it('exposes the backend rating bounds contract', () => {
    expect(EFFORT_MIN).toBe(1);
    expect(EFFORT_MAX).toBe(10);
    expect(FOCUS_MIN).toBe(1);
    expect(FOCUS_MAX).toBe(10);
    expect(isWholeNumberInRange('7', 1, 10)).toBe(true);
    expect(isWholeNumberInRange('11', 1, 10)).toBe(false);
    expect(isWholeNumberInRange('2.5', 1, 10)).toBe(false);
    expect(modeLabel(ReadingMode.Recovery)).toBe('Recovery');
  });
});
