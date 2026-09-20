import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';

import { NoteCardComponent } from './note-card.component';
import { Note } from '../../core/dtos/note.dtos';
import { AssistantStatusService } from '../assistant/assistant-status.service';

/**
 * The refine control on the shared note card (issue #287). The card only renders
 * and emits; these specs pin the honest availability rules (a model is needed for
 * the two rewrites, never for `Original`) and that the host's `refining` state
 * disables everything.
 */
describe('NoteCardComponent refine control', () => {
  let fixture: ComponentFixture<NoteCardComponent>;
  let component: NoteCardComponent;
  const status = { available: signal(false) };

  const note = (overrides: Partial<Note> = {}): Note => ({
    id: 'note-1',
    bookId: 'book-1',
    content: 'A thought as it came.',
    createdAt: '2026-09-01T10:00:00Z',
    ...overrides,
  });

  function setup(
    overrides: Partial<Note> = {},
    options: { showRefine?: boolean; refining?: boolean } = {},
  ): void {
    fixture = TestBed.createComponent(NoteCardComponent);
    component = fixture.componentInstance;
    component.note = note(overrides);
    component.showRefine = options.showRefine ?? true;
    component.refining = options.refining ?? false;
    fixture.detectChanges();
  }

  const el = (testId: string): HTMLButtonElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const trigger = (): HTMLButtonElement => el('note-refine-trigger') as HTMLButtonElement;
  const option = (mode: string): HTMLButtonElement =>
    el(`note-refine-option-${mode}`) as HTMLButtonElement;

  const open = (): void => {
    trigger().click();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    status.available.set(false);
    await TestBed.configureTestingModule({
      imports: [NoteCardComponent],
      providers: [provideRouter([]), { provide: AssistantStatusService, useValue: status }],
    }).compileComponents();
  });

  it('renders no control when showRefine is false', () => {
    setup({}, { showRefine: false });
    expect(el('note-refine-trigger')).toBeNull();
  });

  it('reads as the original when the note carries no processed mode', () => {
    setup();
    expect(trigger().textContent).toContain('Original');
  });

  it('reads as the mode the stored text reflects', () => {
    setup({ processingMode: 'light_polish' });
    expect(trigger().textContent).toContain('Light polish');
  });

  it('offers the three choices when opened', () => {
    setup();
    open();
    expect(option('light_polish').textContent).toContain('Light polish');
    expect(option('clarify').textContent).toContain('Clarify');
    expect(option('verbatim').textContent).toContain('Original');
  });

  it('marks the current mode active and the refined text in the meta row', () => {
    setup({ processingMode: 'clarify' });
    expect(el('note-mode-marker')?.textContent).toContain('Clarify');
    open();
    expect(option('clarify').classList.contains('active')).toBe(true);
    expect(option('clarify').getAttribute('aria-pressed')).toBe('true');
  });

  it('shows no refined marker for the original', () => {
    setup();
    expect(el('note-mode-marker')).toBeNull();
  });

  it('disables the rewrites when the assistant is unavailable, and says why', () => {
    setup();
    open();
    expect(option('light_polish').disabled).toBe(true);
    expect(option('clarify').disabled).toBe(true);
    expect(option('light_polish').getAttribute('title')).toContain('unavailable');
  });

  it('enables the rewrites when the assistant is available', () => {
    status.available.set(true);
    setup();
    open();
    expect(option('light_polish').disabled).toBe(false);
    expect(option('clarify').disabled).toBe(false);
  });

  it('keeps the original usable with no assistant configured', () => {
    status.available.set(false);
    setup();
    open();
    expect(option('verbatim').disabled).toBe(false);
  });

  it('emits the chosen note and mode', () => {
    status.available.set(true);
    setup();
    const emitted: Array<{ id: string; mode: string }> = [];
    component.refine.subscribe((event) => emitted.push(event));

    open();
    option('light_polish').click();

    expect(emitted).toEqual([{ id: 'note-1', mode: 'light_polish' }]);
  });

  it('emits nothing when the active mode is chosen', () => {
    status.available.set(true);
    setup({ processingMode: 'clarify' });
    const emitted: unknown[] = [];
    component.refine.subscribe((event) => emitted.push(event));

    open();
    option('clarify').click();

    expect(emitted).toEqual([]);
  });

  it('disables the control while a refine is in flight', () => {
    setup({}, { refining: true });
    expect(trigger().disabled).toBe(true);
    expect(trigger().textContent).toContain('Refining');
  });
});
