import {
  Component,
  inject,
  OnInit,
  signal,
  effect,
  computed,
  ViewChildren,
  QueryList,
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
  // --- NEW ICONS ADDED HERE ---
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

  // Updated Icons object with missing icons
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
  showFileSidebar = signal(true); // Open by default on desktop
  showBrainSidebar = signal(false);
  isMobile = signal(window.innerWidth < 768);

  // --- File System State ---
  rootItems = signal<WritingDto[]>([]);
  activeItem = signal<WritingContentDto | null>(null);

  // Collect all DropList IDs to enable dragging between folders
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

  constructor() {
    // Handle Window Resize for Mobile logic
    window.addEventListener('resize', () => {
      this.isMobile.set(window.innerWidth < 768);
      if (!this.isMobile()) {
        this.showFileSidebar.set(true); // Always show on desktop
      } else {
        this.showFileSidebar.set(false); // Default hide on mobile
      }
    });

    // Auto-save effect (Debounced)
    effect((onCleanup) => {
      const text = this.editorText();
      const title = this.editorTitle();
      const item = this.activeItem();

      if (!item) return;
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
            this.activeItem.set(updated);
            if (title !== item.name) this.loadTree();
          },
        });
      }, 2000);
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

  // Flatten tree to get all Folder IDs for DnD connection
  recalculateDropLists(items: WritingDto[]) {
    const ids = ['root-list'];
    const traverse = (nodes: WritingDto[]) => {
      for (const node of nodes) {
        if (node.type === 'Folder') {
          ids.push(`folder-${node.id}`);
          traverse(node.children);
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
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
      // TODO: Call service to persist order
    } else {
      // Move to another folder
      transferArrayItem(
        event.previousContainer.data,
        event.container.data,
        event.previousIndex,
        event.currentIndex
      );

      const item = event.container.data[event.currentIndex];
      // container.id is "folder-{id}" or "root-list"
      const newParentId =
        event.container.id === 'root-list' ? null : event.container.id.replace('folder-', '');

      this.handleItemMove({ item, newParentId });
    }
  }

  // Called when Child emits a move event (bubbling up)
  handleItemMove(event: { item: WritingDto; newParentId: string | null }) {
    // Optimistic update is done by CdkDragDrop visual transfer
    // Now call API
    // Assuming service has a move method. If not, implement update with parentId
    // this.writingsService.move(event.item.id, event.newParentId).subscribe();
    console.log(`Moved ${event.item.name} to parent ${event.newParentId}`);
  }

  // ... (Create/Delete logic remains similar)
  createItem(type: 'Folder' | 'Document') {
    const name = prompt(`Enter ${type} Name:`);
    if (!name) return;
    this.writingsService.create({ name, type, parentId: null }).subscribe(() => this.loadTree());
  }

  // --- Brain Logic ---
  loadBrain() {
    this.conceptsService.list().subscribe((data) => this.concepts.set(data));
  }

  get filteredConcepts() {
    const q = this.brainQuery().toLowerCase();
    return this.concepts().filter((c) => c.name.toLowerCase().includes(q));
  }

  selectConcept(id: string) {
    this.selectedConceptId.set(id);
    this.conceptsService.get(id).subscribe((d) => this.selectedConceptNotes.set(d.notes));
  }

  insertNoteIntoEditor(text: string) {
    const current = this.editorText();
    this.editorText.set(current + `\n\n> "${text}"\n`);
    if (this.isMobile()) this.showBrainSidebar.set(false);
  }
}
