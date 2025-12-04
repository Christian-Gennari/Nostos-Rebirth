import {
  Component,
  forwardRef,
  ViewChild,
  ElementRef,
  Input,
  Output,
  EventEmitter,
  inject,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';

// Adjust these import paths based on your actual folder structure
import { ConceptAutocompleteDirective } from '../../directives/concept-autocomplete.directive';
import { ConceptAutocompletePanel } from '../../misc-components/concept-autocomplete-panel/concept-autocomplete-panel';
// Import the global service that holds the master list
import { ConceptDto, ConceptsService } from '../../services/concepts.services';
// Import the local service that handles UI state for THIS input
import { ConceptAutocompleteService } from '../../misc-components/concept-autocomplete-panel/concept-autocomplete.service';

@Component({
  selector: 'app-concept-input',
  standalone: true,
  imports: [CommonModule, FormsModule, ConceptAutocompleteDirective, ConceptAutocompletePanel],
  templateUrl: './concept-input.component.html',
  styleUrls: ['./concept-input.component.css'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ConceptInputComponent),
      multi: true,
    },
    // Provide the autocomplete service at the component level.
    // This gives each input its own "UI State" (popup visibility, filter text),
    // while the DATA comes from the global ConceptsService.
    ConceptAutocompleteService,
  ],
})
export class ConceptInputComponent implements ControlValueAccessor, OnInit, OnDestroy {
  @Input() placeholder = '';
  @Input() rows = 3;

  // Optional: Emit an event if the user hits Ctrl+Enter (common for "Quick Save")
  @Output() submitTrigger = new EventEmitter<void>();

  @ViewChild('textarea') textarea!: ElementRef<HTMLTextAreaElement>;

  // Inject the local service for UI state
  private autocompleteService = inject(ConceptAutocompleteService);
  // Inject the global service for Data
  private conceptsService = inject(ConceptsService);

  private sub?: Subscription;

  value = '';
  isDisabled = false;

  // Callbacks for ControlValueAccessor
  onChange = (value: string) => {};
  onTouched = () => {};

  ngOnInit() {
    // Automatically load the master list from the global service.
    // This allows the component to be self-contained.
    this.sub = this.conceptsService.list().subscribe((list) => {
      this.autocompleteService.setConcepts(list);
    });
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  // --- Logic extracted from BookDetail ---

  insertConcept(concept: ConceptDto) {
    const el = this.textarea.nativeElement;
    const cursor = el.selectionStart;
    const text = this.value;

    const beforeCursor = text.substring(0, cursor);
    const afterCursor = text.substring(cursor);

    // Replace the text being typed (e.g., "[[no") with the full tag "[[Nostos]] "
    const newText = beforeCursor.replace(/\[\[[^\[]*$/, '[[' + concept.name + ']] ') + afterCursor;

    this.value = newText;
    this.onChange(this.value);

    // Optional: Return focus to textarea after insertion
    setTimeout(() => el.focus(), 0);
  }

  // --- ControlValueAccessor Implementation ---

  writeValue(obj: any): void {
    this.value = obj || '';
  }

  registerOnChange(fn: any): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }

  setDisabledState?(isDisabled: boolean): void {
    this.isDisabled = isDisabled;
  }

  handleInput(event: Event) {
    const val = (event.target as HTMLTextAreaElement).value;
    this.value = val;
    this.onChange(val);
  }
}
