import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ReadingProgramme, ReadingWeekSummary } from '../../../core/dtos/reading-training.dtos';
import { WeekStripComponent } from './week-strip.component';

function week(overrides: Partial<ReadingWeekSummary> = {}): ReadingWeekSummary {
  return {
    weekKey: overrides.weekKey ?? '2026-W33',
    completedSessions: overrides.completedSessions ?? 4,
    qualifyingSessions: overrides.qualifyingSessions ?? 3,
    volumeMinutes: overrides.volumeMinutes ?? 320,
    completionThreshold: overrides.completionThreshold ?? 0.7,
    reviewCommitted: overrides.reviewCommitted ?? false,
  };
}

function programme(overrides: Partial<ReadingProgramme> = {}): ReadingProgramme {
  return {
    id: overrides.id ?? 'pppppppp-pppp-pppp-pppp-pppppppppppp',
    timezoneId: overrides.timezoneId ?? 'Europe/Stockholm',
    stateVersion: overrides.stateVersion ?? 'v1',
    deloadActive: overrides.deloadActive ?? false,
    targets: overrides.targets ?? {
      enduranceTargetMinutes: 120,
      deepTargetMinutes: 60,
      recoveryTargetMinutes: 30,
      enduranceEstablishedMinutes: 120,
      deepEstablishedMinutes: 60,
      recoveryEstablishedMinutes: 30,
    },
  };
}

const FORBIDDEN = /\b(streak|debt|catch-?up|guilt|fail|missed|delete|success)\b/i;

describe('WeekStripComponent', () => {
  let fixture: ComponentFixture<WeekStripComponent>;
  let component: WeekStripComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WeekStripComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(WeekStripComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function setWeek(w: ReadingWeekSummary | null): void {
    fixture.componentRef.setInput('week', w);
    fixture.detectChanges();
  }

  function setProgramme(p: ReadingProgramme | null): void {
    fixture.componentRef.setInput('programme', p);
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')) as HTMLButtonElement[];
  }

  function statValues(): Array<string | null> {
    return Array.from(fixture.nativeElement.querySelectorAll('.week-stats dd')).map((d) =>
      (d as HTMLElement).textContent?.trim() ?? null
    );
  }

  it('shows the empty state without a week and no stats or review action', () => {
    setWeek(null);
    expect(text()).toContain('Weekly totals appear here once sessions are completed.');
    expect(fixture.nativeElement.querySelector('dl')).toBeNull();
    expect(buttons()).toHaveLength(0);
  });

  it('renders exactly the server week facts with the week label derived from the key', () => {
    setWeek(week({ weekKey: '2026-W33', volumeMinutes: 320, completedSessions: 4, qualifyingSessions: 3 }));
    setProgramme(programme());
    expect(text()).toContain('Week 33');
    expect(statValues()).toEqual(['320 min', '210 min', '4', '3']);
  });

  it('falls back to the raw week key when it cannot be parsed', () => {
    setWeek(week({ weekKey: 'current' }));
    expect(text()).toContain('current');
    expect(text()).not.toContain('Week ');
  });

  it('sums the three mode targets including recovery, and shows a dash without a programme', () => {
    setWeek(week());
    setProgramme(
      programme({
        targets: {
          enduranceTargetMinutes: 100,
          deepTargetMinutes: 50,
          recoveryTargetMinutes: 25,
          enduranceEstablishedMinutes: 100,
          deepEstablishedMinutes: 50,
          recoveryEstablishedMinutes: 25,
        },
      })
    );
    // 100 + 50 + 25 = 175: the recovery target counts towards the total.
    expect(statValues()).toEqual(['320 min', '175 min', '4', '3']);

    setProgramme(null);
    expect(statValues()[1]).toBe('— min');
  });

  it('explains neutrally that constrained and recovery sessions add volume only', () => {
    setWeek(week());
    setProgramme(programme());
    expect(text()).toContain('Constrained and recovery sessions add volume only.');
  });

  it('emits reviewRequested with the exact week summary when not committed', () => {
    const emitted: ReadingWeekSummary[] = [];
    component.reviewRequested.subscribe((w) => emitted.push(w));
    const w = week({ weekKey: '2026-W33', reviewCommitted: false });
    setWeek(w);

    const button = buttons().find((b) => b.textContent?.includes('Review week'));
    expect(button).toBeDefined();
    button?.click();
    expect(emitted).toEqual([w]);
  });

  it('shows the committed note and no review button when the review is committed', () => {
    setWeek(week({ reviewCommitted: true }));
    expect(text()).toContain('Weekly review committed');
    expect(buttons()).toHaveLength(0);
  });

  it('does not judge figures as success or failure, even when volume exceeds the target', () => {
    setWeek(week({ volumeMinutes: 999, completedSessions: 99, qualifyingSessions: 99 }));
    setProgramme(
      programme({
        targets: {
          enduranceTargetMinutes: 10,
          deepTargetMinutes: 10,
          recoveryTargetMinutes: 10,
          enduranceEstablishedMinutes: 10,
          deepEstablishedMinutes: 10,
          recoveryEstablishedMinutes: 10,
        },
      })
    );
    expect(text()).not.toMatch(/great|amazing|excellent|perfect|ahead|behind/i);
    expect(text()).not.toMatch(FORBIDDEN);
  });

  it('exposes an accessible heading and section landmark', () => {
    setWeek(week());
    const heading = fixture.nativeElement.querySelector('h2#week-strip-heading') as HTMLElement;
    expect(heading).toBeTruthy();
    expect(heading.textContent).toContain('This week');
    expect(fixture.nativeElement.querySelector('section[aria-labelledby="week-strip-heading"]')).toBeTruthy();
  });
});
