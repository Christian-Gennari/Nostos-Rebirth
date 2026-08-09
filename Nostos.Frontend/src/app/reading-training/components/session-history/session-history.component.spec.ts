import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  ReadingConstraint,
  ReadingMode,
  ReadingSession,
  ReadingSessionStatus,
} from '../../../core/dtos/reading-training.dtos';
import { SessionHistoryComponent } from './session-history.component';

function session(overrides: Partial<ReadingSession> = {}): ReadingSession {
  return {
    id: overrides.id ?? 'ssssssss-ssss-ssss-ssss-ssssssssssss',
    bookAssignmentId: overrides.bookAssignmentId ?? 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    bookId: overrides.bookId ?? 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    // Explicit null overrides must survive: rows fall back to a neutral label.
    bookTitle: overrides.bookTitle === undefined ? 'Meditations' : overrides.bookTitle,
    mode: overrides.mode ?? ReadingMode.Endurance,
    status: overrides.status ?? ReadingSessionStatus.Completed,
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
    startedAt: overrides.startedAt ?? null,
    lastStartedAt: overrides.lastStartedAt ?? null,
    pausedAt: overrides.pausedAt ?? null,
    completedAt: overrides.completedAt ?? '2026-08-09T09:00:00+02:00',
  };
}

const FORBIDDEN = /\b(streak|debt|catch-?up|guilt|fail|missed|delete|success)\b/i;

describe('SessionHistoryComponent', () => {
  let fixture: ComponentFixture<SessionHistoryComponent>;
  let component: SessionHistoryComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionHistoryComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(SessionHistoryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function setSessions(sessions: ReadingSession[]): void {
    fixture.componentRef.setInput('sessions', sessions);
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function items(): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.session-item')) as HTMLElement[];
  }

  function bookTitles(): Array<string | null> {
    return Array.from(fixture.nativeElement.querySelectorAll('.session-book')).map(
      (b) => (b as HTMLElement).textContent
    );
  }

  function selectFor(label: string): HTMLSelectElement {
    const fields = Array.from(fixture.nativeElement.querySelectorAll('label.filter-field')) as HTMLElement[];
    const field = fields.find((f) => f.querySelector('span')?.textContent === label);
    const select = field?.querySelector('select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    return select;
  }

  function bookInput(): HTMLInputElement {
    return fixture.nativeElement.querySelector('input[aria-label="Search sessions by book"]') as HTMLInputElement;
  }

  function setModeFilter(value: string): void {
    const select = selectFor('Mode');
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function setStatusFilter(value: string): void {
    const select = selectFor('Status');
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function setBookFilter(value: string): void {
    const input = bookInput();
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('shows the empty state when no sessions exist', () => {
    setSessions([]);
    expect(text()).toContain('No sessions yet');
    expect(items()).toHaveLength(0);
  });

  it('renders session facts: book, mode, constraint, status, minutes, and target', () => {
    setSessions([
      session({
        id: 's1',
        bookTitle: 'Being and Time',
        mode: ReadingMode.Deep,
        constraint: ReadingConstraint.TimeConstrained,
        status: ReadingSessionStatus.Completed,
        targetMinutes: 45,
        measuredSeconds: 1500,
        completedAt: '2026-08-09T09:00:00+02:00',
      }),
    ]);
    expect(text()).toContain('Being and Time');
    expect(text()).toContain('Deep');
    expect(text()).toContain('Time-constrained');
    expect(text()).toContain('Completed');
    expect(text()).toContain('25 min'); // 1500 s / 60
    expect(text()).toContain('target 45 min');
    expect(fixture.nativeElement.querySelector('.session-date')).toBeTruthy();
  });

  it('uses reported minutes when present, else rounds measured seconds', () => {
    setSessions([
      session({ id: 's1', reportedMinutes: 33, measuredSeconds: 1000, completedAt: '2026-08-08T09:00:00+02:00' }),
      session({ id: 's2', reportedMinutes: null, measuredSeconds: 1510, completedAt: '2026-08-07T09:00:00+02:00' }),
    ]);
    expect(text()).toContain('33 min');
    expect(text()).toContain('25 min'); // 1510 / 60 = 25.17 -> 25
  });

  it('sorts newest-first by completion time without mutating the input array', () => {
    const older = session({ id: 's1', bookTitle: 'Older Book', completedAt: '2026-08-01T09:00:00+02:00' });
    const newer = session({ id: 's2', bookTitle: 'Newer Book', completedAt: '2026-08-09T09:00:00+02:00' });
    const input = [older, newer];
    setSessions(input);
    expect(bookTitles()).toEqual(['Newer Book', 'Older Book']);
    expect(component.sessions()).toEqual(input);
  });

  it('sorts uncompleted sessions by plan time', () => {
    setSessions([
      session({ id: 's1', bookTitle: 'Planned Later', completedAt: null, status: ReadingSessionStatus.Planned, plannedAt: '2026-08-10T09:00:00+02:00' }),
      session({ id: 's2', bookTitle: 'Planned Earlier', completedAt: null, status: ReadingSessionStatus.Planned, plannedAt: '2026-08-01T09:00:00+02:00' }),
    ]);
    expect(bookTitles()).toEqual(['Planned Later', 'Planned Earlier']);
  });

  it('filters by mode, status, and book as display-only concerns', () => {
    setSessions([
      session({ id: 's1', bookTitle: 'Alpha', mode: ReadingMode.Endurance, status: ReadingSessionStatus.Completed, completedAt: '2026-08-09T09:00:00+02:00' }),
      session({ id: 's2', bookTitle: 'Beta', mode: ReadingMode.Deep, status: ReadingSessionStatus.AwaitingFeedback, completedAt: '2026-08-08T09:00:00+02:00' }),
      session({ id: 's3', bookTitle: 'Gamma', mode: ReadingMode.Recovery, status: ReadingSessionStatus.Cancelled, completedAt: '2026-08-07T09:00:00+02:00' }),
    ]);

    setModeFilter(String(ReadingMode.Deep));
    expect(bookTitles()).toEqual(['Beta']);

    setStatusFilter(String(ReadingSessionStatus.Completed));
    expect(text()).toContain('No sessions match these filters.');
    const clear = Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
      (b as HTMLButtonElement).textContent?.includes('Clear filters')
    ) as HTMLButtonElement;
    expect(clear).toBeTruthy();
    clear?.click();
    fixture.detectChanges();
    // Newest-first again: Alpha (Aug 9), Beta (Aug 8), Gamma (Aug 7).
    expect(bookTitles()).toEqual(['Alpha', 'Beta', 'Gamma']);

    setBookFilter('gamma');
    expect(bookTitles()).toEqual(['Gamma']);

    setBookFilter('nope');
    expect(text()).toContain('No sessions match these filters.');
  });

  it('filters by raw book id when the title is missing from the DTO', () => {
    setSessions([
      session({ id: 's1', bookTitle: null, bookId: 'unique-id-123', status: ReadingSessionStatus.Completed }),
      session({ id: 's2', bookTitle: 'Other', status: ReadingSessionStatus.Completed }),
    ]);
    setBookFilter('unique-id');
    // The row falls back to the neutral label; the raw id is what matched.
    expect(bookTitles()).toEqual(['Reading session']);
  });

  it('shows ratings only when the server supplied them, plus the skipped note', () => {
    setSessions([
      session({ id: 's1', effort: 7, focus: 4, rating: 3, completedAt: '2026-08-08T09:00:00+02:00' }),
      session({ id: 's2', ratingsSkipped: true, completedAt: '2026-08-07T09:00:00+02:00' }),
      session({ id: 's3', completedAt: '2026-08-06T09:00:00+02:00' }),
    ]);
    // Whitespace between the interpolation spans is insignificant.
    expect(text()).toMatch(/Effort 7 · Focus 4\s*· Rating 3\/5/);
    expect(text()).toContain('Ratings skipped');
    expect(fixture.nativeElement.querySelectorAll('.session-ratings')).toHaveLength(2);
  });

  it('never renders the countsAsFailure flag — no failure or guilt language', () => {
    setSessions([
      session({ id: 's1', countsAsFailure: true, status: ReadingSessionStatus.Completed }),
      session({ id: 's2', countsAsFailure: true, status: ReadingSessionStatus.Cancelled }),
    ]);
    expect(text()).not.toMatch(/fail/i);
    expect(text()).not.toMatch(FORBIDDEN);
  });

  it('maps every numeric enum to its label and neutral fallbacks', () => {
    expect(component.modeLabel(ReadingMode.Endurance)).toBe('Endurance');
    expect(component.modeLabel(ReadingMode.Deep)).toBe('Deep');
    expect(component.modeLabel(ReadingMode.Recovery)).toBe('Recovery');
    expect(component.constraintLabel(ReadingConstraint.TimeConstrained)).toBe('Time-constrained');
    expect(component.constraintLabel(ReadingConstraint.FatigueConstrained)).toBe('Fatigue-constrained');
    expect(component.constraintLabel(ReadingConstraint.None)).toBeNull();
    expect(component.statusLabel(ReadingSessionStatus.Completed)).toBe('Completed');
    expect(component.statusLabel(ReadingSessionStatus.Cancelled)).toBe('Cancelled');
    expect(component.statusLabel(ReadingSessionStatus.AwaitingFeedback)).toBe('Awaiting feedback');
    expect(component.statusLabel(ReadingSessionStatus.Idle)).toBeNull();
    expect(component.statusLabel(ReadingSessionStatus.Planned)).toBeNull();
  });

  it('renders recovery mode with a neutral constraint label and omits missing tags', () => {
    setSessions([
      session({
        id: 's1',
        bookTitle: 'Light Reading',
        mode: ReadingMode.Recovery,
        constraint: ReadingConstraint.FatigueConstrained,
        status: ReadingSessionStatus.Cancelled,
      }),
      session({ id: 's2', bookTitle: 'Plain', constraint: ReadingConstraint.None, status: ReadingSessionStatus.Planned }),
    ]);
    expect(text()).toContain('Recovery');
    expect(text()).toContain('Fatigue-constrained');
    // None-constraint and Planned-status rows render no constraint/status tag.
    const constraintTags = Array.from(fixture.nativeElement.querySelectorAll('.constraint-tag'));
    expect(constraintTags).toHaveLength(1);
    expect(text()).not.toContain('Time-constrained');
  });

  it('exposes an accessible heading, landmark, and labelled filter controls', () => {
    setSessions([session({ id: 's1' })]);
    const heading = fixture.nativeElement.querySelector('h2#history-heading') as HTMLElement;
    expect(heading).toBeTruthy();
    expect(heading.textContent).toContain('Session history');
    expect(fixture.nativeElement.querySelector('section[aria-labelledby="history-heading"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.filters[aria-label="Filter session history"]')).toBeTruthy();
    expect(selectFor('Mode')).toBeTruthy();
    expect(selectFor('Status')).toBeTruthy();
    expect(bookInput()).toBeTruthy();
  });

  it('contains no streak/debt/guilt/failure language in any state', () => {
    setSessions([
      session({ id: 's1', bookTitle: 'Quiet Book', status: ReadingSessionStatus.Completed }),
      session({ id: 's2', bookTitle: 'Another', status: ReadingSessionStatus.Cancelled }),
    ]);
    setBookFilter('zzz');
    expect(text()).not.toMatch(FORBIDDEN);
  });
});
