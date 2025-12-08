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
import { DragDropModule } from '@angular/cdk/drag-drop';
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
// 👇 CHANGED: Import the new Flat Tree Component
import { FlatTreeComponent } from '../ui/flat-tree/flat-tree.component';

@Component({
  selector: 'app-writing-studio',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    DragDropModule,
    FlatTreeComponent, // 👈 CHANGED: Use FlatTreeComponent
    NoteCardComponent,
    MarkdownEditorComponent,
  ],
  templateUrl: './writing-studio.html',
  styleUrls: ['./writing-studio.css'],
})
export class WritingStudio implements OnInit {
  private writingsService = inject(WritingsService);
  private conceptsService = inject(ConceptsService);
  // REMOVED: private treeDragService
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

  // REMOVED: connectedLists (Not needed for Flat Tree)

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
    // REMOVED: treeDragService.register (No longer needed)

    this.loadTree();
    this.loadBrain();
    if (this.isMobile()) {
      this.showFileSidebar.set(false);
    }
  }

  // REMOVED: ngOnDestroy (No longer needed for drag registry)

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

  // 👇 ADDED: Helper for Template Input
  getNameForId(id: string): string {
    return this.rootItems().find((item) => item.id === id)?.name || '';
  }

  handleItemSelected(node: any) {
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

  // REMOVED: onDrop() method (FlatTreeComponent handles drops internally)

  // 👇 UPDATED: Event signature matches FlatTree output
  handleItemMove(event: { item: any; newParentId: string | null }) {
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

  startRename(node: any) {
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
