import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { TodaySessionComponent } from './today-session.component';
import {
  ReadingConstraint,
  ReadingMode,
  ReadingSession,
  ReadingSessionStatus,
} from '../../../core/dtos/reading-training.dtos';

function makeSession(overrides: Partial<ReadingSession> = {}): ReadingSession {
  return {
    id: 's1',
    bookAssignmentId: 'a1',
    bookId: 'b1',
    bookTitle: 'Meditations',
    mode: ReadingMode.Endurance,
    status: ReadingSessionStatus.Active,
    targetMinutes: 40,
    plannedTargetMinutes: 40,
    constraint: ReadingConstraint.None,
    progressionEligible: true,
    countsAsFailure: false,
    accumulatedSeconds: 900,
    measuredSeconds: 900,
    reportedMinutes: null,
    effort: 0,
    focus: 0,
    rating: null,
    ratingsSkipped: false,
    plannedAt: '2026-08-09T08:00:00+02:00',
    startedAt: '2026-08-09T08:05:00+02:00',
    lastStartedAt: '2026-08-09T08:05:00+02:00',
    pausedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe('TodaySessionComponent', () => {
  let fixture: ComponentFixture<TodaySessionComponent>;
  let component: TodaySessionComponent;

  const complete = vi.fn();
  const pause = vi.fn();
  const resume = vi.fn();
  const cancel = vi.fn();

  beforeEach(async () => {
    complete.mockClear();
    pause.mockClear();
    resume.mockClear();
    cancel.mockClear();
    await TestBed.configureTestingModule({
      imports: [TodaySessionComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(TodaySessionComponent);
    component = fixture.componentInstance;
    component.complete.subscribe(complete);
    component.pause.subscribe(pause);
    component.resume.subscribe(resume);
    component.cancel.subscribe(cancel);
    fixture.componentRef.setInput('openSession', makeSession());
    fixture.detectChanges();
  });

  function setSession(overrides: Partial<ReadingSession> = {}): void {
    fixture.componentRef.setInput('openSession', makeSession(overrides));
    fixture.detectChanges();
  }

  function clickButton(text: string): void {
    const buttons = fixture.nativeElement.querySelectorAll('button');
    const button = Array.from(buttons).find((b) => (b as HTMLButtonElement).textContent?.trim() === text);
    expect(button, `button "${text}"`).toBeTruthy();
    (button as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  function setMinutes(value: string): void {
    const el = fixture.nativeElement.querySelector(
      'input[aria-label="Actual minutes read (optional)"]'
    ) as HTMLInputElement;
    expect(el, 'optional actual-minutes input').toBeTruthy();
    el.value = value;
    el.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function buttonLabels(): string[] {
    return Array.from(fixture.nativeElement.querySelectorAll('button')).map(
      (b) => (b as HTMLButtonElement).textContent?.trim() ?? ''
    );
  }

  it('exposes Pause and Finish while Active; Finish emits complete with undefined by default', () => {
    expect(buttonLabels()).toEqual(['Pause', 'Finish']);

    clickButton('Finish');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(undefined);
    expect(pause).not.toHaveBeenCalled();
  });

  it('exposes Resume, Finish, and Cancel while Paused; Finish emits complete with undefined', () => {
    setSession({ status: ReadingSessionStatus.Paused });
    expect(buttonLabels()).toEqual(['Resume', 'Finish', 'Cancel']);

    clickButton('Finish');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(undefined);
    expect(resume).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('keeps Pause and Resume working alongside Finish', () => {
    clickButton('Pause');
    expect(pause).toHaveBeenCalledTimes(1);

    setSession({ status: ReadingSessionStatus.Paused });
    clickButton('Resume');
    expect(resume).toHaveBeenCalledTimes(1);
    clickButton('Cancel');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('carries an optional reported minutes value when finishing an Active session', () => {
    setMinutes('35');
    clickButton('Finish');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(35);
  });

  it('carries an optional reported minutes value when finishing a Paused session', () => {
    setSession({ status: ReadingSessionStatus.Paused });
    setMinutes('45');
    clickButton('Finish');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(45);
  });

  it('emits undefined for blank, zero, or negative minutes rather than an invalid value', () => {
    setMinutes('0');
    clickButton('Finish');
    expect(complete).toHaveBeenLastCalledWith(undefined);

    setMinutes('-5');
    clickButton('Finish');
    expect(complete).toHaveBeenLastCalledWith(undefined);

    // Blank again (fresh session value) resolves to undefined, not 0.
    setMinutes('12');
    setSession({ id: 's2' });
    clickButton('Finish');
    expect(complete).toHaveBeenLastCalledWith(undefined);
  });

  it('never offers Finish or Complete while AwaitingFeedback and never emits complete from that state', () => {
    setSession({ status: ReadingSessionStatus.AwaitingFeedback });
    expect(buttonLabels()).toEqual(['Cancel']);
    expect(
      fixture.nativeElement.querySelector('input[aria-label="Actual minutes read (optional)"]')
    ).toBeNull();

    clickButton('Cancel');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
  });

  it('does not offer Finish for Planned or already-finished sessions', () => {
    setSession({ status: ReadingSessionStatus.Planned });
    expect(buttonLabels()).toEqual(['Start']);

    setSession({ status: ReadingSessionStatus.Completed });
    expect(buttonLabels()).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('This session is finished.');
  });

  it('clears a previously typed minutes value when the session changes or leaves the in-progress states', () => {
    setMinutes('25');

    // A different session in the same state must not inherit the typed value.
    setSession({ id: 's2' });
    expect(
      (fixture.nativeElement.querySelector(
        'input[aria-label="Actual minutes read (optional)"]'
      ) as HTMLInputElement).value
    ).toBe('');

    setMinutes('30');
    setSession({ id: 's1', status: ReadingSessionStatus.AwaitingFeedback });
    expect(
      fixture.nativeElement.querySelector('input[aria-label="Actual minutes read (optional)"]')
    ).toBeNull();

    // Coming back to an in-progress session starts blank again.
    setSession({ id: 's1', status: ReadingSessionStatus.Active });
    expect(
      (fixture.nativeElement.querySelector(
        'input[aria-label="Actual minutes read (optional)"]'
      ) as HTMLInputElement).value
    ).toBe('');
  });

  it('keeps controls keyboard-native and labelled, and disables them while mutating', () => {
    const buttons = fixture.debugElement.queryAll(By.css('button'));
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      const el = button.nativeElement as HTMLButtonElement;
      expect(el.tagName).toBe('BUTTON');
      expect(el.type).toBe('button');
      expect(el.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }

    const minutes = fixture.nativeElement.querySelector(
      'input[aria-label="Actual minutes read (optional)"]'
    ) as HTMLInputElement;
    expect(minutes).toBeTruthy();
    expect(minutes.getAttribute('aria-label')).toBe('Actual minutes read (optional)');
    expect((minutes.closest('label') as HTMLLabelElement).textContent).toContain('optional');

    const section = fixture.nativeElement.querySelector('section') as HTMLElement;
    const heading = fixture.nativeElement.querySelector('h2') as HTMLElement;
    expect(section.getAttribute('aria-labelledby')).toBe(heading.id);

    fixture.componentRef.setInput('mutating', true);
    fixture.detectChanges();
    const finish = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (b) => (b as HTMLButtonElement).textContent?.trim() === 'Finish'
    ) as HTMLButtonElement;
    expect(finish.disabled).toBe(true);
    clickButton('Pause');
    expect(pause).not.toHaveBeenCalled();
  });
});
