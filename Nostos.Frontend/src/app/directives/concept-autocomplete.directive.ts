import { Directive, HostListener, Input, Output, EventEmitter, ElementRef } from '@angular/core';
import { ConceptAutocompleteService } from '../services/concept-autocomplete.service';
import { ConceptDto } from '../services/concepts.services';

@Directive({
  selector: '[noteAutocomplete]',
  standalone: true,
})
export class ConceptAutocompleteDirective {
  @Output() insertConcept = new EventEmitter<ConceptDto>();

  constructor(
    private el: ElementRef<HTMLTextAreaElement>,
    private auto: ConceptAutocompleteService
  ) {}

  @HostListener('input')
  onInput() {
    const textarea = this.el.nativeElement;
    this.auto.update(textarea.value, textarea.selectionStart);
  }

  @HostListener('keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    const list = this.auto.suggestions();
    if (list.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.auto.moveDown();
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.auto.moveUp();
    }

    if (event.key === 'Enter') {
      const chosen = this.auto.choose();
      if (chosen) {
        event.preventDefault();
        this.insertConcept.emit(chosen);

        this.auto.clear();
      }
    }
  }
}
