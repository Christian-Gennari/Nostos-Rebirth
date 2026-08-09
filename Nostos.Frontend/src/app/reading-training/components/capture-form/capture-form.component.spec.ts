import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ReadingCaptureType } from '../../../core/dtos/reading-training.dtos';
import { CaptureDraft, CaptureFormComponent, captureTypeLabel } from './capture-form.component';

const FORBIDDEN = /\b(streak|debt|catch-?up|guilt|fail|missed|delete|success)\b/i;

describe('CaptureFormComponent', () => {
  let fixture: ComponentFixture<CaptureFormComponent>;
  let component: CaptureFormComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CaptureFormComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(CaptureFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function textarea(): HTMLTextAreaElement {
    return fixture.nativeElement.querySelector('#capture-form-text') as HTMLTextAreaElement;
  }

  function typeSelect(): HTMLSelectElement {
    return fixture.nativeElement.querySelector('#capture-form-type') as HTMLSelectElement;
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')) as HTMLButtonElement[];
  }

  function setText(value: string): void {
    const ta = textarea();
    ta.value = value;
    ta.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function submit(): void {
    const button = buttons().find((b) => b.textContent?.includes('Save capture'));
    expect(button).toBeDefined();
    button?.click();
    fixture.detectChanges();
  }

  it('labels the capture kinds by enum: note, question, excerpt', () => {
    expect(captureTypeLabel(ReadingCaptureType.Thought)).toBe('Note');
    expect(captureTypeLabel(ReadingCaptureType.Question)).toBe('Question');
    expect(captureTypeLabel(ReadingCaptureType.Bookmark)).toBe('Excerpt');

    const options = Array.from(typeSelect().options).map((o) => ({ value: o.value, label: o.textContent }));
    expect(options).toEqual([
      { value: String(ReadingCaptureType.Thought), label: 'Note' },
      { value: String(ReadingCaptureType.Question), label: 'Question' },
      { value: String(ReadingCaptureType.Bookmark), label: 'Excerpt' },
    ]);
  });

  it('rejects whitespace-only text and never emits', () => {
    const drafts: CaptureDraft[] = [];
    component.capture.subscribe((d) => drafts.push(d));

    for (const blank of ['', '   ', '\n\t \n']) {
      setText(blank);
      submit();
      expect(drafts).toEqual([]);
      expect(text()).toContain('Enter the passage or thought to save.');
    }
  });

  it('emits the text verbatim, preserving leading and trailing whitespace', () => {
    const drafts: CaptureDraft[] = [];
    component.capture.subscribe((d) => drafts.push(d));

    const verbatim = '  "The unexamined life is not worth living."  \n  — from memory';
    setText(verbatim);
    submit();

    expect(drafts).toEqual([{ text: verbatim, type: ReadingCaptureType.Thought }]);
  });

  it('emits the selected capture type as its numeric enum value', () => {
    const drafts: CaptureDraft[] = [];
    component.capture.subscribe((d) => drafts.push(d));

    setText('Why does the argument rest on that premise?');
    typeSelect().value = String(ReadingCaptureType.Question);
    typeSelect().dispatchEvent(new Event('change'));
    fixture.detectChanges();
    submit();

    expect(drafts).toEqual([{ text: 'Why does the argument rest on that premise?', type: ReadingCaptureType.Question }]);

    typeSelect().value = String(ReadingCaptureType.Bookmark);
    typeSelect().dispatchEvent(new Event('change'));
    fixture.detectChanges();
    setText('p. 12, last paragraph');
    submit();
    expect(drafts[1]?.type).toBe(ReadingCaptureType.Bookmark);
    expect(drafts[1]?.text).toBe('p. 12, last paragraph');
  });

  it('relabels the text field heading to match the chosen kind', () => {
    setText('a note');
    expect(text()).toContain('Note text');
    typeSelect().value = String(ReadingCaptureType.Question);
    typeSelect().dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(text()).toContain('Question text');
  });

  it('wires keyboard-accessible labels and error regions', () => {
    const heading = fixture.nativeElement.querySelector('h2#capture-form-heading') as HTMLElement;
    expect(heading).toBeTruthy();
    expect(fixture.nativeElement.querySelector('section[aria-labelledby="capture-form-heading"]')).toBeTruthy();

    for (const id of ['capture-form-type', 'capture-form-text']) {
      const control = fixture.nativeElement.querySelector(`#${id}`) as HTMLElement;
      const label = fixture.nativeElement.querySelector(`label[for="${id}"]`) as HTMLElement;
      expect(control).toBeTruthy();
      expect(label).toBeTruthy();
    }

    setText('   ');
    submit();
    const ta = textarea();
    expect(ta.getAttribute('aria-invalid')).toBe('true');
    expect(ta.getAttribute('aria-describedby')).toBe('capture-form-text-error');
    expect(fixture.nativeElement.querySelector('#capture-form-text-error[role="alert"]')).toBeTruthy();
  });

  it('disables controls while busy', () => {
    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();
    for (const button of buttons()) {
      expect(button.disabled).toBe(true);
    }
    expect(textarea().disabled).toBe(true);
    expect(typeSelect().disabled).toBe(true);
  });

  it('contains no streak/debt/guilt/failure language', () => {
    setText('');
    submit();
    expect(text()).not.toMatch(FORBIDDEN);
  });
});
