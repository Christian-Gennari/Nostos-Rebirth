import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  ConceptsService,
  ConceptDto,
  ConceptDetailDto,
  NoteContextDto,
} from '../services/concepts.services';
import { LucideAngularModule, Search, BrainCircuit, ArrowRight } from 'lucide-angular';

@Component({
  standalone: true,
  selector: 'app-brain',
  imports: [CommonModule, FormsModule, RouterLink, LucideAngularModule],
  templateUrl: './second-brain.html',
  styleUrls: ['./second-brain.css'],
})
export class SecondBrain implements OnInit {
  private conceptsService = inject(ConceptsService);

  // Icons
  SearchIcon = Search;
  BrainIcon = BrainCircuit;
  ArrowRightIcon = ArrowRight;

  // State
  concepts = signal<ConceptDto[]>([]);
  searchQuery = signal('');

  selectedId = signal<string | null>(null);
  selectedDetail = signal<ConceptDetailDto | null>(null);
  loadingDetail = signal(false);

  // Computed Filter (Now Crash-Proof)
  filteredConcepts = computed(() => {
    const q = this.searchQuery().toLowerCase();

    return this.concepts().filter((c) => {
      // Handle potential casing mismatch (Name vs name)
      // @ts-ignore
      const name = c.name || c.Name || '';
      return name.toLowerCase().includes(q);
    });
  });

  ngOnInit() {
    this.conceptsService.list().subscribe({
      next: (data) => {
        console.log('Concepts loaded:', data); // Debugging: Check console to see if data arrives
        this.concepts.set(data);
      },
      error: (err) => console.error('Failed to load concepts:', err),
    });
  }

  selectConcept(id: string) {
    this.selectedId.set(id);
    this.loadingDetail.set(true);

    this.conceptsService.get(id).subscribe({
      next: (detail) => {
        this.selectedDetail.set(detail);
        this.loadingDetail.set(false);
      },
      error: (err) => {
        console.error(err);
        this.loadingDetail.set(false);
      },
    });
  }

  // NEW METHOD: Determines if a card should span two columns
  shouldCardSpanTwoColumns(note: NoteContextDto): boolean {
    // Heuristic: If the combined length of the selected text and the user's comment
    // is over 300 characters, we make the card span two columns.
    const combinedLength = (note.content?.length || 0) + (note.selectedText?.length || 0);
    return combinedLength > 300;
  }

  formatNote(content: string): string {
    return content.replace(/\[\[(.*?)\]\]/g, '<span class="concept-tag">$1</span>');
  }
}
