import { Component, inject, OnInit, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Sidebar,
  Plus,
  FileText,
  FolderPlus,
  Save,
  BrainCircuit,
  Search,
  X,
} from 'lucide-angular';

// Services
import { WritingsService } from '../services/writings.services';
import { ConceptsService, ConceptDto } from '../services/concepts.services';

// Components
import { FileTreeItem } from './file-tree-item/file-tree-item';
import { NoteCardComponent } from '../ui/note-card.component/note-card.component';

// DTOs
import { WritingDto, WritingContentDto } from '../dtos/writing.dtos';

@Component({
  selector: 'app-writing-studio',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, FileTreeItem, NoteCardComponent],
  templateUrl: './writing-studio.html',
  styleUrls: ['./writing-studio.css'],
})
export class WritingStudio implements OnInit {
  private writingsService = inject(WritingsService);
  private conceptsService = inject(ConceptsService);

  // Icons
  Icons = { Sidebar, Plus, FileText, FolderPlus, Save, BrainCircuit, Search, Close: X };

  // --- State: File System ---
  rootItems = signal<WritingDto[]>([]);
  activeItem = signal<WritingContentDto | null>(null);
  isLoadingContent = signal(false);

  // --- State: Editor ---
  // We keep a separate signal for the editor text so we can debounce saves
  editorText = signal('');
  editorTitle = signal('');
  saveStatus = signal<'Saved' | 'Saving...' | 'Unsaved'>('Saved');

  // --- State: Brain Sidebar ---
  isBrainOpen = signal(true);
  brainQuery = signal('');
  concepts = signal<ConceptDto[]>([]);
  selectedConceptId = signal<string | null>(null);
  selectedConceptNotes = signal<any[]>([]); // To store notes for the sidebar

  // Map for Note Cards
  conceptMap = signal<Map<string, ConceptDto>>(new Map());

  constructor() {
    // Auto-save Effect
    effect((onCleanup) => {
      const text = this.editorText();
      const title = this.editorTitle();
      const item = this.activeItem();

      if (!item) return;

      // Don't save if it matches the DB exactly (initial load)
      if (text === item.content && title === item.name) {
        this.saveStatus.set('Saved');
        return;
      }

      this.saveStatus.set('Unsaved');

      const timer = setTimeout(() => {
        this.saveStatus.set('Saving...');
        this.writingsService.update(item.id, { name: title, content: text }).subscribe({
          next: (updated) => {
            this.saveStatus.set('Saved');
            // Update the local item reference silently
            this.activeItem.set(updated);
            // Refresh tree names if title changed
            if (title !== item.name) this.loadTree();
          },
        });
      }, 2000); // 2-second debounce

      onCleanup(() => clearTimeout(timer));
    });
  }

  ngOnInit() {
    this.loadTree();
    this.loadBrain();
  }

  // --- File System Actions ---

  loadTree() {
    this.writingsService.list().subscribe((items) => this.rootItems.set(items));
  }

  handleItemSelected(item: WritingDto) {
    if (item.type === 'Folder') return; // Folders handle themselves in the tree component

    this.isLoadingContent.set(true);
    this.writingsService.get(item.id).subscribe({
      next: (contentDto) => {
        this.activeItem.set(contentDto);
        this.editorTitle.set(contentDto.name);
        this.editorText.set(contentDto.content);
        this.isLoadingContent.set(false);
      },
    });
  }

  createItem(type: 'Folder' | 'Document') {
    // Simple prompt for now. In a real app, use a modal or inline input.
    const name = prompt(`Enter ${type} Name:`);
    if (!name) return;

    // TODO: Support creating inside the currently selected folder
    // For now, we create at root
    this.writingsService.create({ name, type, parentId: null }).subscribe(() => {
      this.loadTree();
    });
  }

  deleteActiveItem() {
    const item = this.activeItem();
    if (!item || !confirm(`Delete "${item.name}"?`)) return;

    this.writingsService.delete(item.id).subscribe(() => {
      this.activeItem.set(null);
      this.loadTree();
    });
  }

  // --- Brain Actions ---

  loadBrain() {
    this.conceptsService.list().subscribe((data) => {
      this.concepts.set(data);
      // Build map for the Note Cards
      const map = new Map<string, ConceptDto>();
      data.forEach((c) => map.set(c.name.toLowerCase(), c));
      this.conceptMap.set(map);
    });
  }

  get filteredConcepts() {
    const q = this.brainQuery().toLowerCase();
    return this.concepts().filter((c) => c.name.toLowerCase().includes(q));
  }

  selectConcept(id: string) {
    this.selectedConceptId.set(id);
    this.conceptsService.get(id).subscribe((detail) => {
      this.selectedConceptNotes.set(detail.notes);
    });
  }

  insertNoteIntoEditor(noteContent: string) {
    // Append to editor
    const current = this.editorText();
    this.editorText.set(current + `\n\n> "${noteContent}"\n`);
  }
}
