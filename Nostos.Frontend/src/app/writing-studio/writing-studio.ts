import {
  Component,
  inject,
  OnInit,
  signal,
  effect,
  computed,
  DestroyRef,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  DragDropModule,
  CdkDragDrop,
  moveItemInArray,
  transferArrayItem,
} from '@angular/cdk/drag-drop';
import {
  LucideAngularModule,
  Menu,
  Plus,
  FileText,
  FolderPlus,
  Save,
  BrainCircuit,
  Search,
  X,
  GripVertical,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  ArrowLeft,
} from 'lucide-angular';

import { WritingsService } from '../services/writings.services';
import { ConceptsService, ConceptDto } from '../services/concepts.services';
import { FileTreeItem } from './file-tree-item/file-tree-item';
import { NoteCardComponent } from '../ui/note-card.component/note-card.component';
import { WritingDto, WritingContentDto } from '../dtos/writing.dtos';

@Component({
  selector: 'app-writing-studio',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    DragDropModule,
    FileTreeItem,
    NoteCardComponent,
  ],
  templateUrl: './writing-studio.html',
  styleUrls: ['./writing-studio.css'],
})
export class WritingStudio implements OnInit {
  private writingsService = inject(WritingsService);
  private conceptsService = inject(ConceptsService);
  private destroyRef = inject(DestroyRef); // Used for cleanup

  Icons = {
    Menu,
    Plus,
    FileText,
    FolderPlus,
    Save,
    BrainCircuit,
    Search,
    Close: X,
    GripVertical,
    PanelLeftClose,
    PanelLeftOpen,
    PanelRightClose,
    ArrowLeft,
  };

  // --- Layout State ---
  showFileSidebar = signal(true);
  showBrainSidebar = signal(false);
  isMobile = signal(window.innerWidth < 768);

  // --- File System State ---
  rootItems = signal<WritingDto[]>([]);
  activeItem = signal<WritingContentDto | null>(null);
  allDropListIds = signal<string[]>(['root-list']);

  // --- Editor State ---
  editorText = signal('');
  editorTitle = signal('');
  saveStatus = signal<'Saved' | 'Saving...' | 'Unsaved'>('Saved');

  // --- Brain State ---
  brainQuery = signal('');
  concepts = signal<ConceptDto[]>([]);
  selectedConceptId = signal<string | null>(null);
  selectedConceptNotes = signal<any[]>([]);

  // OPTIMIZATION: Computed signal for search filtering
  // This caches the result and only re-runs when query or concepts change.
  filteredConcepts = computed(() => {
    const q = this.brainQuery().toLowerCase();
    const list = this.concepts();
    if (!q) return list;
    return list.filter((c) => c.name.toLowerCase().includes(q));
  });

  constructor() {
    // 1. Safe Window Resize Listener
    const onResize = () => {
      const mobile = window.innerWidth < 768;
      this.isMobile.set(mobile);
      // Only force sidebar state if crossing the breakpoint
      if (!mobile && !this.showFileSidebar()) this.showFileSidebar.set(true);
    };

    window.addEventListener('resize', onResize);
    // Cleanup to prevent memory leaks
    this.destroyRef.onDestroy(() => window.removeEventListener('resize', onResize));

    // 2. Robust Auto-save Effect
    effect((onCleanup) => {
      const text = this.editorText();
      const title = this.editorTitle();

      // Use untracked for activeItem so switching files doesn't trigger a "save" on the old one immediately
      const item = untracked(() => this.activeItem());

      if (!item) return;

      // Check if actually dirty
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

            // Update the active item source of truth so the cycle resets
            this.activeItem.set(updated);

            // Refresh tree if name changed
            if (title !== item.name) {
              this.loadTree();
            }
          },
          error: () => this.saveStatus.set('Unsaved'), // Handle error state
        });
      }, 2000); // 2 second debounce

      onCleanup(() => clearTimeout(timer));
    });
  }

  ngOnInit() {
    this.loadTree();
    this.loadBrain();
    if (this.isMobile()) this.showFileSidebar.set(false);
  }

  closeSidebars() {
    if (this.isMobile()) {
      this.showFileSidebar.set(false);
      this.showBrainSidebar.set(false);
    }
  }

  loadTree() {
    this.writingsService.list().subscribe((items) => {
      this.rootItems.set(items);
      this.recalculateDropLists(items);
    });
  }

  recalculateDropLists(items: WritingDto[]) {
    const ids = ['root-list'];
    const traverse = (nodes: WritingDto[]) => {
      for (const node of nodes) {
        if (node.type === 'Folder') {
          ids.push(`folder-${node.id}`);
          traverse(node.children || []); // Safe access
        }
      }
    };
    traverse(items);
    this.allDropListIds.set(ids);
  }

  handleItemSelected(item: WritingDto) {
    if (item.type === 'Folder') return;

    this.writingsService.get(item.id).subscribe({
      next: (contentDto) => {
        // Batch updates so effect runs once
        this.activeItem.set(contentDto);
        this.editorTitle.set(contentDto.name);
        this.editorText.set(contentDto.content);

        if (this.isMobile()) this.showFileSidebar.set(false);
      },
    });
  }

  // --- Drag & Drop Logic ---
  onDrop(event: CdkDragDrop<WritingDto[]>) {
    if (event.previousContainer === event.container) {
      // Reorder in same list
      // We must mutate the signal's array properly
      this.rootItems.update((items) => {
        // Create a shallow copy if needed, though Cdk acts on references
        moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
        return [...items]; // Trigger signal update
      });
    } else {
      // Move between folders
      transferArrayItem(
        event.previousContainer.data,
        event.container.data,
        event.previousIndex,
        event.currentIndex
      );

      const item = event.container.data[event.currentIndex];
      const newParentId =
        event.container.id === 'root-list' ? null : event.container.id.replace('folder-', '');

      this.handleItemMove({ item, newParentId });
    }
  }

  handleItemMove(event: { item: WritingDto; newParentId: string | null }) {
    console.log(`Moved ${event.item.name} to parent ${event.newParentId}`);
    // this.writingsService.move(...)
  }

  createItem(type: 'Folder' | 'Document') {
    const name = prompt(`Enter ${type} Name:`);
    if (!name) return;
    this.writingsService.create({ name, type, parentId: null }).subscribe(() => this.loadTree());
  }

  // --- Brain Logic ---
  loadBrain() {
    this.conceptsService.list().subscribe((data) => this.concepts.set(data));
  }

  selectConcept(id: string) {
    this.selectedConceptId.set(id);
    this.conceptsService.get(id).subscribe((d) => this.selectedConceptNotes.set(d.notes));
  }

  insertNoteIntoEditor(text: string) {
    // Cleaner append logic
    this.editorText.update((current) =>
      current ? `${current}\n\n> "${text}"\n` : `> "${text}"\n`
    );

    if (this.isMobile()) this.showBrainSidebar.set(false);
  }
}
