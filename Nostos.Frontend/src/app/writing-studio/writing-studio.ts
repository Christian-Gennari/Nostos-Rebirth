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
import { MarkdownEditorComponent } from '../ui/markdown-editor/markdown-editor.component';

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
    MarkdownEditorComponent,
  ],
  templateUrl: './writing-studio.html',
  styleUrls: ['./writing-studio.css'],
})
export class WritingStudio implements OnInit {
  private writingsService = inject(WritingsService);
  private conceptsService = inject(ConceptsService);
  private destroyRef = inject(DestroyRef);

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
  isMobile = signal(window.innerWidth < 768);

  // On Desktop, default both to TRUE. On Mobile, default Files to TRUE, Brain to FALSE.
  showFileSidebar = signal(true);
  showBrainSidebar = signal(!this.isMobile());

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

  filteredConcepts = computed(() => {
    const q = this.brainQuery().toLowerCase();
    const list = this.concepts();
    if (!q) return list;
    return list.filter((c) => c.name.toLowerCase().includes(q));
  });

  constructor() {
    const onResize = () => {
      const mobile = window.innerWidth < 768;
      this.isMobile.set(mobile);

      // If we switch to desktop, force both sidebars open
      if (!mobile) {
        this.showFileSidebar.set(true);
        this.showBrainSidebar.set(true);
      } else {
        // Optional: When switching TO mobile, maybe close the brain sidebar to save space?
        // keeping current state or closing it is up to preference.
        // this.showBrainSidebar.set(false);
      }
    };

    window.addEventListener('resize', onResize);
    this.destroyRef.onDestroy(() => window.removeEventListener('resize', onResize));

    effect((onCleanup) => {
      const text = this.editorText();
      const title = this.editorTitle();
      const item = untracked(() => this.activeItem());

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
            if (title !== item.name) {
              this.loadTree();
            }
          },
          error: () => this.saveStatus.set('Unsaved'),
        });
      }, 2000);

      onCleanup(() => clearTimeout(timer));
    });
  }

  ngOnInit() {
    this.loadTree();
    this.loadBrain();
    // Logic moved to property initialization, but double check here if needed
    if (this.isMobile()) {
      this.showFileSidebar.set(false); // Start closed on mobile? Or true?
      // Original code had: if (this.isMobile()) this.showFileSidebar.set(false);
      // I'll keep that behavior for mobile.
      this.showFileSidebar.set(false);
    }
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
          traverse(node.children || []);
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

  onDrop(event: CdkDragDrop<WritingDto[]>) {
    if (event.previousContainer === event.container) {
      this.rootItems.update((items) => {
        moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
        return [...items];
      });
    } else {
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
    this.writingsService.move(event.item.id, event.newParentId).subscribe({
      next: () => {
        this.loadTree();
      },
      error: (err) => {
        console.error('Failed to move item', err);
        this.loadTree();
      },
    });
  }

  createItem(type: 'Folder' | 'Document') {
    const name = prompt(`Enter ${type} Name:`);
    if (!name) return;
    this.writingsService.create({ name, type, parentId: null }).subscribe(() => this.loadTree());
  }

  loadBrain() {
    this.conceptsService.list().subscribe((data) => this.concepts.set(data));
  }

  selectConcept(id: string) {
    this.selectedConceptId.set(id);
    this.conceptsService.get(id).subscribe((d) => this.selectedConceptNotes.set(d.notes));
  }

  insertNoteIntoEditor(text: string) {
    this.editorText.update((current) =>
      current ? `${current}\n\n> "${text}"\n` : `> "${text}"\n`
    );

    if (this.isMobile()) this.showBrainSidebar.set(false);
  }
}
