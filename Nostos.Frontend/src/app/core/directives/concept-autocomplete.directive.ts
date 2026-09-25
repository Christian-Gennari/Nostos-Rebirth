import { Directive, ElementRef, EventEmitter, HostListener, Output } from '@angular/core';
import { ConceptAutocompleteService } from '../../ui/concept-autocomplete-panel/concept-autocomplete.service';
import { ConceptDto } from '../services/concepts.service';

@Directive({
  selector: '[noteAutocomplete]',
  standalone: true,
})
export class ConceptAutocompleteDirective {
  @Output() insertConcept = new EventEmitter<ConceptDto>();
  @Output() insertConceptName = new EventEmitter<string>();

  constructor(
    private el: ElementRef<HTMLTextAreaElement>,
    private auto: ConceptAutocompleteService,
  ) {}

  @HostListener('input')
  onInput(): void {
    const textarea = this.el.nativeElement;
    this.auto.update(textarea.value, textarea.selectionStart);
  }

  @HostListener('keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (!this.auto.pickerOpen()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.auto.clear();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.auto.moveDown();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.auto.moveUp();
      return;
    }

    if (event.key !== 'Enter') return;

    const chosen = this.auto.choose();
    const query = this.auto.query().trim();
    if (!chosen && !query) return;

    event.preventDefault();
    if (chosen) this.insertConcept.emit(chosen);
    else this.insertConceptName.emit(query);
    this.auto.clear();
  }
}
