import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  ReadingMode,
  ReadingNotification,
  TargetReachedNotificationPayload,
} from '../../../core/dtos/reading-training.dtos';
import { PendingNoticesComponent } from './pending-notices.component';

const NOTIFICATION_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const BOOK_ID = '33333333-3333-4333-8333-333333333333';
const LEASE_UNTIL = '2026-08-09T19:00:00+02:00';

function payload(overrides: Partial<TargetReachedNotificationPayload> = {}): TargetReachedNotificationPayload {
  return {
    notificationId: NOTIFICATION_ID,
    sessionId: SESSION_ID,
    bookId: BOOK_ID,
    mode: ReadingMode.Deep,
    plannedTargetMinutes: 10,
    effectiveElapsedSeconds: 605,
    message: 'Reading target reached: 10 minutes elapsed (planned 10 minutes).',
    ...overrides,
  };
}

function notice(
  overrides: Partial<ReadingNotification> = {},
  payloadValue: unknown = payload()
): ReadingNotification {
  return {
    notificationId: NOTIFICATION_ID,
    payload: payloadValue as TargetReachedNotificationPayload,
    leaseUntil: LEASE_UNTIL,
    ...overrides,
  };
}

const FORBIDDEN = /\b(streak|debt|catch-?up|guilt|fail|missed|delete|success)\b/i;

describe('PendingNoticesComponent', () => {
  let fixture: ComponentFixture<PendingNoticesComponent>;
  let component: PendingNoticesComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PendingNoticesComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(PendingNoticesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function setNotices(notices: ReadingNotification[]): void {
    fixture.componentRef.setInput('notices', notices);
    fixture.detectChanges();
  }

  function setBusy(busy: boolean): void {
    fixture.componentRef.setInput('busy', busy);
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')) as HTMLButtonElement[];
  }

  function buttonByLabel(label: string): HTMLButtonElement | undefined {
    return buttons().find((b) => b.getAttribute('aria-label') === label);
  }

  function noticeItems(): HTMLElement[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.notice-item')) as HTMLElement[];
  }

  it('shows the empty state with no count badge, no list, and no buttons when nothing is pending', () => {
    setNotices([]);
    expect(text()).toContain('No reading notices waiting.');
    expect(fixture.nativeElement.querySelector('.count-badge')).toBeNull();
    expect(fixture.nativeElement.querySelector('.notice-list')).toBeNull();
    expect(buttons()).toHaveLength(0);
  });

  it('renders pending notices in input order with the count badge', () => {
    const second = notice({ notificationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, payload({ mode: ReadingMode.Recovery }));
    const first = notice({ notificationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, payload({ mode: ReadingMode.Endurance }));
    setNotices([first, second]);

    expect((fixture.nativeElement.querySelector('.count-badge') as HTMLElement).textContent?.trim()).toBe('2');
    const items = noticeItems();
    expect(items).toHaveLength(2);
    // Input order is preserved: Endurance renders before Recovery.
    expect(items[0]?.textContent).toContain('Endurance');
    expect(items[1]?.textContent).toContain('Recovery');
  });

  it('shows neutral facts for a known target-reached payload delivered as an object', () => {
    setNotices([notice()]);

    expect(text()).toContain('Mode');
    expect(text()).toContain('Deep');
    expect(text()).toContain('Target');
    expect(text()).toContain('10 min');
    expect(text()).toContain('Elapsed');
    expect(text()).toContain('10 min 5 s');
    // Book and session facts are shown in restrained short form; the full
    // internal identifiers only appear as a hover title.
    expect(text()).toContain('33333333');
    expect(text()).toContain('22222222');
    const bookDd = fixture.nativeElement.querySelector('.fact dd[title]') as HTMLElement;
    expect(bookDd?.getAttribute('title')).toBe(BOOK_ID);
    // The lease timestamp is a delivery detail, never rendered.
    expect(text()).not.toContain('2026-08-09');
    expect(text()).not.toContain('19:00');
  });

  it('parses a known target-reached payload delivered as a JSON string', () => {
    setNotices([notice({}, JSON.stringify(payload()))]);

    expect(text()).toContain('Deep');
    expect(text()).toContain('10 min 5 s');
    expect(text()).toContain('33333333');
  });

  it('falls back to a restrained label for malformed or unknown payloads without raw JSON or ids', () => {
    const cases: unknown[] = [
      'not-json{',
      JSON.stringify({ unrelated: true }),
      JSON.stringify('just a string'),
      42,
      null,
      [],
      { mode: 99, plannedTargetMinutes: 10, effectiveElapsedSeconds: 605 },
      { mode: '1', plannedTargetMinutes: 10, effectiveElapsedSeconds: 605 },
      { mode: 1, plannedTargetMinutes: '10', effectiveElapsedSeconds: 605 },
      { mode: 1, plannedTargetMinutes: 10, effectiveElapsedSeconds: -5 },
    ];
    for (const bad of cases) {
      setNotices([notice({ notificationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, bad)]);
      expect(text()).toContain('Reading notice');
      expect(text()).toContain('Acknowledge');
      expect(text()).not.toContain('Deep');
      expect(text()).not.toContain('10 min 5 s');
      expect(text()).not.toContain('33333333');
      expect(text()).not.toContain('22222222');
      expect(text()).not.toContain('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
      expect(text()).not.toContain(JSON.stringify(bad));
      expect(text()).not.toContain('unrelated');
      expect(text()).not.toContain('not-json');
    }
  });

  it('emits the exact notice entity once per click', () => {
    const emitted: ReadingNotification[] = [];
    component.acknowledge.subscribe((n) => emitted.push(n));
    const first = notice({ notificationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const second = notice({ notificationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, payload({ mode: ReadingMode.Recovery }));
    setNotices([first, second]);

    buttonByLabel('Acknowledge reading notice: Deep, 10 min 5 s')?.click();
    buttonByLabel('Acknowledge reading notice: Recovery, 10 min 5 s')?.click();

    expect(emitted).toHaveLength(2);
    expect(emitted[0]).toBe(first);
    expect(emitted[1]).toBe(second);

    // A second click emits the same entity again; nothing is removed locally.
    buttonByLabel('Acknowledge reading notice: Deep, 10 min 5 s')?.click();
    expect(emitted).toHaveLength(3);
    expect(emitted[2]).toBe(first);
    expect(noticeItems()).toHaveLength(2);
  });

  it('disables every acknowledge button while busy and emits nothing on click', () => {
    const emitted: ReadingNotification[] = [];
    component.acknowledge.subscribe((n) => emitted.push(n));
    setNotices([notice()]);
    setBusy(true);

    for (const button of buttons()) {
      expect(button.disabled).toBe(true);
    }
    buttons()[0]?.click();
    expect(emitted).toHaveLength(0);
  });

  it('never mutates or reorders the input notices', () => {
    const first = notice({ notificationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const second = notice({ notificationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, payload({ mode: ReadingMode.Recovery }));
    const input = [second, first];
    setNotices(input);

    buttonByLabel('Acknowledge reading notice: Recovery, 10 min 5 s')?.click();

    expect(component.notices()).toBe(input);
    expect(component.notices().map((n) => n.notificationId)).toEqual([
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ]);
    expect(component.entries()[0]?.notice).toBe(second);
    expect(component.entries()[1]?.notice).toBe(first);
    // Display order follows the untouched input order.
    expect(noticeItems()[0]?.textContent).toContain('Recovery');
    expect(noticeItems()[1]?.textContent).toContain('Deep');
  });

  it('exposes an accessible labelled section, list, buttons, and a polite live region for the count/state', () => {
    setNotices([notice()]);
    const heading = fixture.nativeElement.querySelector('h2#pending-notices-heading') as HTMLElement;
    expect(heading).toBeTruthy();
    expect(heading.textContent).toContain('Reading notices');
    expect(fixture.nativeElement.querySelector('section[aria-labelledby="pending-notices-heading"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('ul.notice-list')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('ul.notice-list li')).toHaveLength(1);

    const live = fixture.nativeElement.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live).toBeTruthy();
    expect(live.textContent?.trim()).toBe('1 reading notice waiting.');
    expect(buttonByLabel('Acknowledge reading notice: Deep, 10 min 5 s')).toBeTruthy();

    // The live region tracks the empty state too.
    setNotices([]);
    expect(live.textContent?.trim()).toBe('No reading notices waiting.');
  });

  it('contains no streak/debt/guilt/catch-up/success language and no telegram references', () => {
    setNotices([
      notice(),
      notice({ notificationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }, { nope: true }),
    ]);
    expect(text()).not.toMatch(FORBIDDEN);
    expect(text().toLowerCase()).not.toContain('telegram');
  });
});
