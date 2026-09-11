import {
  Component,
  OnInit,
  inject,
  signal,
  model,
  computed,
  HostListener,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LibraryFilterService,
  StatusFilter,
  FormatFilter,
} from '../library-filter.service';
import {
  LucideAngularModule,
  Folder,
  Library,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Trash2,
  Edit2,
  Menu,
  Heart,
  BookOpen,
  CircleDashed,
  CheckCircle,
  Inbox,
  Headphones,
  FileText,
} from 'lucide-angular';

import { CollectionsService } from '../../core/services/collections.service';
import { Collection, CollectionCountDto } from '../../core/dtos/collection.dtos';
import { LibraryStatusCountsDto } from '../../core/dtos/book.dtos';
import { BooksService } from '../../core/services/books.service';
import { LibraryPreferencesService } from '../../core/services/library-preferences.service';
import { FlatTreeComponent } from '../../ui/flat-tree/flat-tree.component';
import { ToastService } from '../../core/services/toast.service';

@Component({
  standalone: true,
  selector: 'app-sidebar-collections',
  imports: [CommonModule, FormsModule, LucideAngularModule, FlatTreeComponent],
  templateUrl: './sidebar-collections.component.html',
  styleUrls: ['./sidebar-collections.component.css'],
})
export class SidebarCollections implements OnInit {
  private collectionsService = inject(CollectionsService);
  private booksService = inject(BooksService);
  private preferences = inject(LibraryPreferencesService);
  readonly filters = inject(LibraryFilterService);
  private elementRef = inject(ElementRef);
  private toast = inject(ToastService);

  // Icons
  FolderIcon = Folder;
  LibraryIcon = Library;
  PanelLeftCloseIcon = PanelLeftClose;
  PanelLeftOpenIcon = PanelLeftOpen;
  PlusIcon = Plus;
  Trash2Icon = Trash2;
  Edit2Icon = Edit2;
  MenuIcon = Menu;
  HeartIcon = Heart;
  BookOpenIcon = BookOpen;
  CircleDashedIcon = CircleDashed;
  CheckCircleIcon = CheckCircle;
  InboxIcon = Inbox;
  HeadphonesIcon = Headphones;
  FileTextIcon = FileText;

  // State
  collections = signal<Collection[]>([]);
  counts = signal<CollectionCountDto[]>([]);
  statusCounts = signal<LibraryStatusCountsDto | null>(null);
  expanded = this.preferences.sidebarExpanded;
  adding = signal(false);
  editingId = signal<string | null>(null);
  newName = model<string>('');
  private ignoreClick = false;

  readonly hasSelection = computed(
    () =>
      this.filters.status() !== 'all' ||
      this.filters.format() !== 'all' ||
      this.filters.collectionId() !== null,
  );

  readonly countsMap = computed(
    () => new Map<string, number>(this.counts().map((c) => [c.collectionId, c.bookCount])),
  );

  readonly treeItems = computed(() =>
    this.collections().map((c) => ({ ...c, count: this.countsMap().get(c.id) ?? 0 })),
  );

  // State to control initial animation
  isLoaded = signal(false);

  ngOnInit(): void {
    this.load();
    this.loadCounts();
    this.loadStatusCounts();
    if (window.innerWidth < 768) {
      this.setExpanded(false);
    }

    // Set isLoaded to true after a minimal timeout
    setTimeout(() => {
      this.isLoaded.set(true);
    }, 0);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.ignoreClick) {
      this.ignoreClick = false;
      return;
    }

    const target = event.target as HTMLElement;

    // Mobile: Close sidebar if clicking outside
    if (window.innerWidth < 768 && this.expanded()) {
      const clickedInside = this.elementRef.nativeElement.contains(target);
      if (!clickedInside) {
        this.setExpanded(false);
        // If the sidebar is closed via outside click, we can return early
        return;
      }
    }

    if (!this.adding() && !this.editingId()) return;

    const isInsideInputRow = target.closest('.nav-item.input-mode');

    if (!isInsideInputRow) {
      if (this.adding()) this.resetInput();
      if (this.editingId()) this.cancelRename();
    }
  }

  load(): void {
    this.collectionsService.list().subscribe({
      next: (cols) => this.collections.set(cols),
      error: () => this.toast.error('Failed to load collections'),
    });
  }

  loadCounts(): void {
    this.collectionsService.getCounts().subscribe({
      next: (counts) => this.counts.set(counts),
    });
  }

  loadStatusCounts(): void {
    this.booksService.getStatusCounts().subscribe({
      next: (counts) => this.statusCounts.set(counts),
      error: () => this.toast.error('Failed to load library status counts'),
    });
  }

  toggle(): void {
    this.setExpanded(!this.expanded());
  }

  private setExpanded(expanded: boolean): void {
    this.preferences.setSidebarExpanded(expanded);
  }

  /**
   * Filter buttons only manage the mobile drawer: after a selection the
   * drawer closes and focus returns to its opener (the floating toggle) so
   * it can be reopened immediately. Desktop selection leaves the sidebar
   * untouched.
   */
  private closeDrawerOnMobile(): void {
    if (window.innerWidth < 768 && this.expanded()) {
      this.setExpanded(false);
      (this.elementRef.nativeElement as HTMLElement)
        .querySelector<HTMLButtonElement>('.floating-toggle')
        ?.focus();
    }
  }

  toggleStatus(status: StatusFilter): void {
    this.filters.toggleStatus(status);
    this.closeDrawerOnMobile();
  }

  toggleFormat(format: FormatFilter): void {
    this.filters.toggleFormat(format);
    this.closeDrawerOnMobile();
  }

  clearFilters(): void {
    this.filters.clearAll();
    this.closeDrawerOnMobile();
  }

  select(id: string | null): void {
    this.filters.toggleCollection(id);
    this.closeDrawerOnMobile();
  }

  startAdd(): void {
    this.ignoreClick = true;
    this.adding.set(true);
    if (!this.expanded()) this.setExpanded(true);
  }

  resetInput(): void {
    this.adding.set(false);
    this.newName.set('');
    this.editingId.set(null);
  }

  create(): void {
    const name = this.newName().trim();
    if (!name) {
      this.resetInput();
      return;
    }
    this.collectionsService.create({ name }).subscribe({
      next: (newCol) => {
        this.resetInput();
        this.load();
        this.loadCounts();
        this.select(newCol.id);
      },
      error: () => this.toast.error('Could not create collection.'),
    });
  }

  startRename(item: any): void {
    this.ignoreClick = true;
    this.editingId.set(item.id);
  }

  cancelRename(): void {
    this.editingId.set(null);
  }

  saveRename(id: string, newName: string): void {
    if (!newName.trim()) {
      this.cancelRename();
      return;
    }
    const collection = this.collections().find((c) => c.id === id);
    // Full-replace PUT: always send the current parentId (explicit null for
    // root) so a rename never reads as "move to root".
    this.collectionsService
      .update(id, { name: newName, parentId: collection?.parentId ?? null })
      .subscribe({
        next: () => {
          this.editingId.set(null);
          this.load();
          this.loadCounts();
        },
        error: (err) => {
          this.editingId.set(null);
          this.toast.error(this.describeCollectionError(err));
          this.load();
        },
      });
  }

  deleteCollection(id: string): void {
    if (!confirm('Delete this collection?')) return;
    this.collectionsService.delete(id).subscribe({
      next: () => {
        this.toast.info('Collection deleted');
        this.load();
        this.loadCounts();
        if (this.filters.collectionId() === id) {
          this.filters.collectionId.set(null);
        }
      },
      error: (err) => {
        this.toast.error(this.describeCollectionError(err));
        this.load();
      },
    });
  }

  private describeCollectionError(err: unknown): string {
    const body = (err as { error?: { title?: string; detail?: string } })?.error;
    switch (body?.title) {
      case 'collection_has_children':
        return 'Move or delete the child collections first.';
      case 'collection_name_conflict':
        return body.detail || 'A collection with that name already exists here.';
      case 'collection_cycle':
        return 'A collection cannot be moved into itself or its children.';
      case 'invalid_collection_parent':
        return body.detail || 'The destination collection no longer exists.';
      default:
        return body?.detail || 'Something went wrong.';
    }
  }

  getNameForId(id: string): string {
    return this.collections().find((c) => c.id === id)?.name || '';
  }

  onItemMoved(event: { item: any; newParentId: string | null }) {
    this.moveCollection(event.item, event.newParentId);
  }

  moveCollection(item: Collection, newParentId: string | null) {
    if ((item.parentId ?? null) === newParentId) return;

    this.collectionsService
      .update(item.id, {
        name: item.name,
        parentId: newParentId,
      })
      .subscribe({
        next: () => {
          this.load();
          this.loadCounts();
        },
        error: (err) => {
          this.toast.error(this.describeCollectionError(err));
          this.load();
        },
      });
  }
}
