import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, Search, BrainCircuit, ArrowLeft, ArrowRight } from 'lucide-angular';

import {
  ConceptsService,
  ConceptDto,
  ConceptDetailDto,
  NoteContextDto,
} from '../services/concepts.services';

// 👇 Refactor: Import the shared pipe
import { NoteFormatPipe } from '../ui/pipes/note-format.pipe';

@Component({
  standalone: true,
  selector: 'app-brain',
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    LucideAngularModule,
    NoteFormatPipe, // 👇 Added to imports
  ],
  templateUrl: './second-brain.html',
  styleUrls: ['./second-brain.css'],
})
export class SecondBrain implements OnInit {
  private conceptsService = inject(ConceptsService);

  // Icons
  SearchIcon = Search;
  BrainIcon = BrainCircuit;
  ArrowRightIcon = ArrowRight;
  ArrowLeftIcon = ArrowLeft;

  // State
  concepts = signal<ConceptDto[]>([]);
  searchQuery = signal('');

  selectedId = signal<string | null>(null);
  selectedDetail = signal<ConceptDetailDto | null>(null);
  loadingDetail = signal(false);

  // 👇 Refactor: Computed Map for the Pipe to look up IDs efficiently
  conceptMap = computed(() => {
    const map = new Map<string, ConceptDto>();
    this.concepts().forEach((c) => {
      // @ts-ignore (Handling potential casing mismatch from API)
      const name = c.name || c.Name || '';
      map.set(name.trim().toLowerCase(), c);
    });
    return map;
  });

  // Computed Filter
  filteredConcepts = computed(() => {
    const q = this.searchQuery().toLowerCase();
    return this.concepts().filter((c) => {
      // @ts-ignore
      const name = c.name || c.Name || '';
      return name.toLowerCase().includes(q);
    });
  });

  ngOnInit() {
    this.conceptsService.list().subscribe({
      next: (data) => {
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

  // New Method: Clears selection to return to Index on mobile
  clearSelection() {
    this.selectedId.set(null);
    this.selectedDetail.set(null);
  }

  shouldCardSpanTwoColumns(note: NoteContextDto): boolean {
    const combinedLength = (note.content?.length || 0) + (note.selectedText?.length || 0);
    return combinedLength > 300;
  }

  // 👇 Refactor: New handler for clicking concepts inside the text
  handleContentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    // The pipe adds the 'concept-tag' class and 'data-concept-id' attribute
    if (target.classList.contains('concept-tag')) {
      const conceptId = target.getAttribute('data-concept-id');
      if (conceptId) {
        event.preventDefault();
        event.stopPropagation();
        // Determine if we should just switch selection or navigate
        this.selectConcept(conceptId);
      }
    }
  }
}
