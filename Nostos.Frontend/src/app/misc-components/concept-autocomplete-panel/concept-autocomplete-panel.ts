import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConceptAutocompleteService } from '../../services/concept-autocomplete.service';

@Component({
  standalone: true,
  selector: 'concept-autocomplete-panel',
  imports: [CommonModule],
  template: `
    <div class="autocomplete-panel" *ngIf="auto.suggestions().length > 0">
      <div
        class="item"
        *ngFor="let c of auto.suggestions(); let i = index"
        [class.active]="i === auto.activeIndex()"
      >
        {{ c.name }}
      </div>
    </div>
  `,
  styleUrls: ['./concept-autocomplete-panel.css'],
})
export class ConceptAutocompletePanel {
  auto = inject(ConceptAutocompleteService);
}
