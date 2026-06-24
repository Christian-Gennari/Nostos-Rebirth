import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AudioReader, parseTimeString } from './audio-reader.component';

describe('parseTimeString (issue #6)', () => {
  it('parses M:SS', () => {
    expect(parseTimeString('1:30')).toBe(90);
    expect(parseTimeString('0:00')).toBe(0);
    expect(parseTimeString('0:05')).toBe(5);
    expect(parseTimeString('12:34')).toBe(754);
  });

  it('parses H:MM:SS', () => {
    expect(parseTimeString('1:05:20')).toBe(3920);
    expect(parseTimeString('0:00:00')).toBe(0);
    expect(parseTimeString('0:01:00')).toBe(60);
  });

  it('accepts single-digit segments', () => {
    expect(parseTimeString('5:3')).toBe(303);
    expect(parseTimeString('1:2:3')).toBe(3723);
  });

  it('trims surrounding whitespace', () => {
    expect(parseTimeString('  1:30  ')).toBe(90);
  });

  it('returns null for empty / whitespace input', () => {
    expect(parseTimeString('')).toBeNull();
    expect(parseTimeString('   ')).toBeNull();
  });

  it('returns null for non-numeric or partial input', () => {
    expect(parseTimeString('abc')).toBeNull();
    expect(parseTimeString('1:')).toBeNull();
    expect(parseTimeString(':30')).toBeNull();
    expect(parseTimeString('1:30:00:00')).toBeNull();
    expect(parseTimeString('1:2:3:4')).toBeNull();
  });

  it('returns null for negative input', () => {
    expect(parseTimeString('-1:00')).toBeNull();
  });

  it('returns null for null / undefined input', () => {
    expect(parseTimeString(null as unknown as string)).toBeNull();
    expect(parseTimeString(undefined as unknown as string)).toBeNull();
  });

  it('returns permissive totals (caller clamps to duration)', () => {
    // Plan: 99:99 -> 6039s, then clamp to duration(). Parser does not reject.
    expect(parseTimeString('99:99')).toBe(6039);
    expect(parseTimeString('1:60')).toBe(120);
    expect(parseTimeString('1:00:99')).toBe(3699);
    expect(parseTimeString('1:99:00')).toBe(9540);
  });

  it('handles large hour values without overflow (caller clamps to duration)', () => {
    expect(parseTimeString('99:00:00')).toBe(356400);
  });
});

describe('AudioReader jump-to-timestamp (issue #6)', () => {
  let fixture: ComponentFixture<AudioReader>;
  let component: AudioReader;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AudioReader],
    }).compileComponents();

    fixture = TestBed.createComponent(AudioReader);
    component = fixture.componentInstance;
    // bookId is a required input; provide a placeholder so the constructor effect
    // does not throw before our individual tests can set up state.
    fixture.componentRef.setInput('bookId', 'test-book-id');
  });

  it('does not enter edit mode when duration is zero', () => {
    expect(component.duration()).toBe(0);
    component.startEditingTime();
    expect(component.isEditingTime()).toBe(false);
  });

  it('cancels cleanly without seeking', () => {
    component.duration.set(600);
    component.startEditingTime();
    expect(component.isEditingTime()).toBe(true);
    component.cancelTimeEdit();
    expect(component.isEditingTime()).toBe(false);
  });

  it('is idempotent on commit when not editing (no double-blur seek)', () => {
    component.duration.set(600);
    expect(component.isEditingTime()).toBe(false);
    component.commitTimeEdit('5:00');
    // isEditingTime was never set true; commit must be a no-op.
    expect(component.isEditingTime()).toBe(false);
  });

  it('cancels silently on malformed input and exits edit mode', () => {
    component.duration.set(600);
    component.startEditingTime();
    component.commitTimeEdit('not-a-time');
    expect(component.isEditingTime()).toBe(false);
  });

  it('clamps a value greater than duration via commitTimeEdit (no direct seek past end)', () => {
    component.duration.set(600);
    // Spy on goToTime so we can assert that commitTimeEdit invoked it with the
    // clamped value, not the raw 99:99 (=6039s) value.
    const seen: number[] = [];
    const original = (component as unknown as { goToTime: (n: number) => void }).goToTime;
    (component as unknown as { goToTime: (n: number) => void }).goToTime = (n: number) => {
      seen.push(n);
    };
    try {
      component.startEditingTime();
      component.commitTimeEdit('99:99');
    } finally {
      (component as unknown as { goToTime: (n: number) => void }).goToTime = original;
    }
    expect(seen).toEqual([600]);
    expect(component.isEditingTime()).toBe(false);
  });
});
