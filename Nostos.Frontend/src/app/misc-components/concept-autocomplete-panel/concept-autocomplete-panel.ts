import { Component, EventEmitter, inject, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
// 👇 Updated path to match your project structure
import { ConceptAutocompleteService } from '../concept-autocomplete-panel/concept-autocomplete.service';
import { ConceptDto } from '../../services/concepts.services';

@Component({
  standalone: true,
  selector: 'concept-autocomplete-panel',
  imports: [CommonModule],
  template: `
    <div
      class="autocomplete-panel"
      *ngIf="auto.suggestions().length > 0"
      (mousedown)="$event.preventDefault()"
      (touchstart)="$event.preventDefault()"
    >
      <div
        class="item"
        *ngFor="let c of auto.suggestions(); let i = index"
        [class.active]="i === auto.activeIndex()"
        (mousedown)="select(c, $event)"
        (touchstart)="select(c, $event)"
      >
        {{ c.name }}
      </div>
    </div>
  `,
  styleUrls: ['./concept-autocomplete-panel.css'],
})
export class ConceptAutocompletePanel {
  auto = inject(ConceptAutocompleteService);

  @Output() conceptSelected = new EventEmitter<ConceptDto>();

  // 👇 Updated to accept the event and stop propagation
  select(concept: ConceptDto, event: Event) {
    event.preventDefault();
    event.stopPropagation();

    this.conceptSelected.emit(concept);
    this.auto.clear();
  }
}
