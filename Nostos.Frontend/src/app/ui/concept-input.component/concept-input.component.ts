import {
  Component,
  forwardRef,
  ViewChild,
  ElementRef,
  Input,
  Output,
  EventEmitter,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

// Adjust these import paths based on your actual folder structure
import { ConceptAutocompleteDirective } from '../../directives/concept-autocomplete.directive';
import { ConceptAutocompletePanel } from '../../misc-components/concept-autocomplete-panel/concept-autocomplete-panel';
import { ConceptDto } from '../../services/concepts.services';

@Component({
  selector: 'app-concept-input',
  standalone: true,
  imports: [CommonModule, FormsModule, ConceptAutocompleteDirective, ConceptAutocompletePanel],
  templateUrl: './concept-input.component.html',
  styleUrls: ['./concept-input.component.css'], // Optional, if you add styles
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ConceptInputComponent),
      multi: true,
    },
  ],
})
export class ConceptInputComponent implements ControlValueAccessor {
  @Input() placeholder = '';
  @Input() rows = 3;

  // Optional: Emit an event if the user hits Ctrl+Enter (common for "Quick Save")
  @Output() submitTrigger = new EventEmitter<void>();

  @ViewChild('textarea') textarea!: ElementRef<HTMLTextAreaElement>;

  value = '';
  isDisabled = false;

  // Callbacks for ControlValueAccessor
  onChange = (value: string) => {};
  onTouched = () => {};

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
