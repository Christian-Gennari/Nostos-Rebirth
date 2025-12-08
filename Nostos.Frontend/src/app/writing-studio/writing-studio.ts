import {
  Component,
  inject,
  OnInit,
  OnDestroy,
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
import { NoteCardComponent } from '../ui/note-card.component/note-card.component';
import { WritingDto, WritingContentDto } from '../dtos/writing.dtos';
import { MarkdownEditorComponent } from '../ui/markdown-editor/markdown-editor.component';
import { TreeNodeComponent } from '../ui/tree-node/tree-node.component';
import { TreeNode, TreeNodeMoveEvent } from '../ui/tree-node/tree-node.interface';
import { TreeDragService } from '../ui/tree-node/tree-drag.service'; // Ensure path is correct

@Component({
  selector: 'app-writing-studio',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    DragDropModule,
    TreeNodeComponent,
    NoteCardComponent,
    MarkdownEditorComponent,
  ],
  templateUrl: './writing-studio.html',
  styleUrls: ['./writing-studio.css'],
})
export class WritingStudio implements OnInit, OnDestroy {
  private writingsService = inject(WritingsService);
  private conceptsService = inject(ConceptsService);
  private treeDragService = inject(TreeDragService); // Inject the registry
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

  isMobile = signal(window.innerWidth < 768);
  showFileSidebar = signal(true);
  showBrainSidebar = signal(!this.isMobile());

  rootItems = signal<WritingDto[]>([]);
  activeItem = signal<WritingContentDto | null>(null);

  // CHANGED: Connect directly to the global service signal
  // This replaces 'allDropListIds' and ensures the root list sees all folders
  connectedLists = this.treeDragService.dropListIds;

  editingId = signal<string | null>(null);

  editorText = signal('');
  editorTitle = signal('');
  saveStatus = signal<'Saved' | 'Saving...' | 'Unsaved'>('Saved');

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

      if (!mobile) {
        this.showFileSidebar.set(true);
        this.showBrainSidebar.set(true);
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
    // Register the root list ID so children can be dragged back to the root
    this.treeDragService.register('root-list');

    this.loadTree();
    this.loadBrain();
    if (this.isMobile()) {
      this.showFileSidebar.set(false);
    }
  }

  ngOnDestroy() {
    // Cleanup the root list ID
    this.treeDragService.unregister('root-list');
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
    });
  }

  handleItemSelected(node: TreeNode | WritingDto) {
    const item = node as WritingDto;

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
      // If dropped on root, parent is null. Otherwise, parse 'folder-{id}'
      const newParentId =
        event.container.id === 'root-list' ? null : event.container.id.replace('folder-', '');

      this.handleItemMove({ item, newParentId });
    }
  }

  handleItemMove(event: TreeNodeMoveEvent | { item: WritingDto; newParentId: string | null }) {
    const item = event.item as WritingDto;
    const newParentId = event.newParentId;

    this.writingsService.move(item.id, newParentId).subscribe({
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

  startRename(node: TreeNode) {
    this.editingId.set(node.id);
  }

  saveRename(id: string, newName: string) {
    if (!newName.trim()) {
      this.cancelRename();
      return;
    }

    this.writingsService.update(id, { name: newName }).subscribe(() => {
      this.loadTree();
      this.editingId.set(null);

      if (this.activeItem()?.id === id) {
        this.editorTitle.set(newName);
      }
    });
  }

  cancelRename() {
    this.editingId.set(null);
  }

  deleteItem(id: string) {
    if (!confirm('Are you sure you want to delete this item?')) return;

    this.writingsService.delete(id).subscribe(() => {
      this.loadTree();

      if (this.activeItem()?.id === id) {
        this.activeItem.set(null);
        this.editorText.set('');
        this.editorTitle.set('');
      }
    });
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
