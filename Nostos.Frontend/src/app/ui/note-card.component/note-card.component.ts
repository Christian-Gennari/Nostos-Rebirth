// Nostos.Frontend/src/app/ui/note-card.component/note-card.component.ts
import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { Note, NoteProcessingMode, UpdateNoteDto } from '../../core/dtos/note.dtos';
import { ConceptDto } from '../../core/services/concepts.service';
import { AssistantStatusService } from '../assistant/assistant-status.service';
import { ConceptInputComponent } from '../concept-input.component/concept-input.component';
import { IconButtonComponent } from '../icon-button/icon-button.component';
import { NoteFormatPipe } from '../pipes/note-format.pipe';
import { NostosIconComponent } from '../icon/nostos-icon.component';

/** One entry of the inline refine row. */
interface RefineOption {
  mode: NoteProcessingMode;
  label: string;
}

@Component({
  selector: 'app-note-card',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NostosIconComponent,
    IconButtonComponent,
    ConceptInputComponent,
    NoteFormatPipe,
    RouterLink,
  ],
  templateUrl: './note-card.component.html',
  styleUrls: ['./note-card.component.css'],
})
export class NoteCardComponent {
  @Input({ required: true }) note!: Note;
  @Input() conceptMap: Map<string, ConceptDto> = new Map();
  @Input() showNavigation = false;
  @Input() showActions = true;
  @Input() showSource = false;
  @Input() showDate = true;
  /** Opt-in: only surfaces that offer refining render the control. */
  @Input() showRefine = false;
  /** The host owns the in-flight state; the card only reflects it. */
  @Input() refining = false;

  // Updated Output signature to match UpdateNoteDto
  @Output() update = new EventEmitter<{ id: string; content: string; selectedText?: string }>();
  @Output() delete = new EventEmitter<string>();
  @Output() conceptClick = new EventEmitter<string>();
  @Output() quoteClick = new EventEmitter<void>();
  @Output() cardClick = new EventEmitter<void>();
  @Output() refine = new EventEmitter<{ id: string; mode: NoteProcessingMode }>();

  isEditing = false;
  editContent = '';
  editSelectedText = '';

  /**
   * Availability is the server fact `AssistantStatusService` owns; the card must
   * not invent a second source. `Light polish`/`Clarify` need a model, so they
   * are disabled when it is false — `Original` never is, because it is a storage
   * operation.
   */
  private readonly assistantStatus = inject(AssistantStatusService);
  readonly assistantAvailable = this.assistantStatus.available;

  readonly refineOpen = signal(false);
  /** Presentation order: the two rewrites first, the original last. */
  readonly refineOptions: readonly RefineOption[] = [
    { mode: 'light_polish', label: 'Light polish' },
    { mode: 'clarify', label: 'Clarify' },
    { mode: 'verbatim', label: 'Original' },
  ];

  /** The mode the stored text currently reflects; absent means the original. */
  get currentMode(): NoteProcessingMode {
    return this.note.processingMode === 'light_polish' || this.note.processingMode === 'clarify'
      ? this.note.processingMode
      : 'verbatim';
  }

  /** True when the text on screen is a version rather than the original. */
  get isRefined(): boolean {
    return this.currentMode !== 'verbatim';
  }

  /** The label for a mode; `verbatim` reads as the note's original state. */
  modeLabel(mode: string | null | undefined): string {
    if (mode === 'light_polish') return 'Light polish';
    if (mode === 'clarify') return 'Clarify';
    return 'Original';
  }

  isModeActive(mode: NoteProcessingMode): boolean {
    return this.currentMode === mode;
  }

  isModeDisabled(mode: NoteProcessingMode): boolean {
    if (this.refining) return true;
    return mode !== 'verbatim' && !this.assistantAvailable();
  }

  /** Why a disabled option is disabled, so the state is never a silent dead end. */
  modeTitle(mode: NoteProcessingMode): string {
    if (this.isModeDisabled(mode) && mode !== 'verbatim' && !this.assistantAvailable()) {
      return 'The assistant is unavailable — connect a model to use this.';
    }
    return '';
  }

  toggleRefine(event?: Event): void {
    event?.stopPropagation();
    if (this.refining) return;
    this.refineOpen.update((open) => !open);
  }

  chooseMode(mode: NoteProcessingMode, event?: Event): void {
    event?.stopPropagation();
    if (this.isModeDisabled(mode)) return;
    // Choosing the mode already on screen changes nothing, so it emits nothing.
    if (mode === this.currentMode) return;
    this.refine.emit({ id: this.note.id, mode });
    this.refineOpen.set(false);
  }

  // Collapse logic
  isExpanded = false;
  readonly CHAR_THRESHOLD = 250;
  // A quoted card has no commentary-collapse path (below), so an unusually long
  // quotation would otherwise expand to its full height — the Combeferre note
  // imported from the vault is 5,871 characters and filled the whole feed. Above
  // this length a quote collapses too, behind the same "Show more" affordance.
  // Set at 1000 characters of total note text: measured against live data it
  // collapses the four oversized imported cards and exactly one pre-existing
  // note, and never a quote a reader would call short.
  readonly QUOTE_COLLAPSE_THRESHOLD = 1000;
  get shouldShowExpandBtn(): boolean {
    if (this.isEditing) return false;

    // A quote is the reason the note exists and is set as the card's hero, so it
    // is not truncated merely for existing: collapsing a normal quotation buries
    // the very thing the reader came for. A quotation long enough to swamp the
    // feed is the exception — it collapses, and the hero survives because
    // expanding it is one click away.
    const totalLength =
      (this.note.selectedText?.length || 0) + (this.note.content?.length || 0);

    if (this.note.selectedText) {
      return totalLength > this.QUOTE_COLLAPSE_THRESHOLD;
    }

    const contentLen = this.note.content?.length || 0;
    return contentLen > this.CHAR_THRESHOLD;
  }

  toggleExpand(event: Event) {
    event.stopPropagation();
    this.isExpanded = !this.isExpanded;
  }

  startEdit(event?: Event) {
    event?.stopPropagation();
    this.editContent = this.note.content;
    this.editSelectedText = this.note.selectedText || ''; // Initialize quote editor
    this.isEditing = true;
    this.isExpanded = true;
  }

  cancelEdit(event?: Event) {
    event?.stopPropagation();
    this.isEditing = false;
    this.editContent = '';
    this.editSelectedText = '';
    this.isExpanded = false;
  }

  saveEdit(event?: Event) {
    event?.stopPropagation();
    const cleanContent = this.editContent.trim();
    const cleanQuote = this.editSelectedText.trim();

    // Check if either field changed
    const contentChanged = cleanContent !== this.note.content;
    const quoteChanged = cleanQuote !== (this.note.selectedText || '');

    if (contentChanged || quoteChanged) {
      this.update.emit({
        id: this.note.id,
        content: cleanContent,
        selectedText: cleanQuote, // Emit the new quote
      });
    }
    this.isEditing = false;
    this.isExpanded = false;
  }

  onDelete(event?: Event) {
    event?.stopPropagation();
    this.delete.emit(this.note.id);
  }

  onCardClick(event?: Event) {
    event?.stopPropagation();
    this.cardClick.emit();
  }

  onContentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (target.classList.contains('concept-tag')) {
      const id = target.getAttribute('data-concept-id');
      if (id) {
        event.preventDefault();
        event.stopPropagation();
        this.conceptClick.emit(id);
      }
    }
  }
}
