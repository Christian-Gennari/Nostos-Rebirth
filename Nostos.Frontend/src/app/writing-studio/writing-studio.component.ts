import {
  Component,
  inject,
  OnInit,
  signal,
  effect,
  computed,
  DestroyRef,
  untracked,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DragDropModule } from '@angular/cdk/drag-drop';

import { WritingsService } from '../core/services/writings.service';
import { ToastService } from '../core/services/toast.service';
import { ConceptsService, ConceptDto, NoteContextDto } from '../core/services/concepts.service';
import { BooksService, Book as BookDto } from '../core/services/books.service';
import { NotesService } from '../core/services/notes.service';
import { NoteCardComponent } from '../ui/note-card.component/note-card.component';
import { WritingDto, WritingContentDto, WritingSourceDto } from '../core/dtos/writing.dtos';
import { Note } from '../core/dtos/note.dtos';
import { MarkdownEditorComponent } from '../ui/markdown-editor/markdown-editor.component';
import { FlatTreeComponent } from '../ui/flat-tree/flat-tree.component';
import { IconButtonComponent } from '../ui/icon-button/icon-button.component';
import { ButtonComponent } from '../ui/button/button.component';
import { InputDirective } from '../ui/form-control/form-control.directive';
import { BadgeComponent } from '../ui/badge/badge.component';
import { ConfirmModal } from '../ui/confirm-modal/confirm-modal.component';
import { NostosIconComponent } from '../ui/icon/nostos-icon.component';

/** localStorage flag for typewriter mode in the studio. */
const TYPEWRITER_KEY = 'nostos.typewriter';
const STUDIO_SIDEBAR_WIDTH_KEY = 'nostos.studio.leftSidebarWidth';
const STUDIO_SIDEBAR_MIN = 220;
const STUDIO_SIDEBAR_MAX = 420;
const STUDIO_SIDEBAR_DEFAULT = 280;

function studioSidebarMaxWidth(): number {
  return Math.max(
    STUDIO_SIDEBAR_MIN,
    Math.min(STUDIO_SIDEBAR_MAX, Math.floor(window.innerWidth * 0.42)),
  );
}

function clampStudioSidebarWidth(width: number): number {
  return Math.min(studioSidebarMaxWidth(), Math.max(STUDIO_SIDEBAR_MIN, Math.round(width)));
}

function readStudioSidebarWidth(): number {
  try {
    const stored = Number(localStorage.getItem(STUDIO_SIDEBAR_WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0
      ? clampStudioSidebarWidth(stored)
      : STUDIO_SIDEBAR_DEFAULT;
  } catch {
    return STUDIO_SIDEBAR_DEFAULT;
  }
}

function readTypewriter(): boolean {
  try {
    return localStorage.getItem(TYPEWRITER_KEY) === '1';
  } catch {
    return false;
  }
}

@Component({
  selector: 'app-writing-studio',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NostosIconComponent,
    DragDropModule,
    FlatTreeComponent,
    NoteCardComponent,
    MarkdownEditorComponent,
    IconButtonComponent,
    ButtonComponent,
    InputDirective,
    BadgeComponent,
    ConfirmModal,
  ],
  templateUrl: './writing-studio.component.html',
  styleUrls: ['./writing-studio.component.css'],
})
export class WritingStudio implements OnInit {
  private writingsService = inject(WritingsService);
  private toast = inject(ToastService);
  private conceptsService = inject(ConceptsService);
  private booksService = inject(BooksService);
  private notesService = inject(NotesService);

  private destroyRef = inject(DestroyRef);
  private hostElement = inject(ElementRef<HTMLElement>);
  isMobile = signal(window.innerWidth < 768);
  showFileSidebar = signal(true);
  showBrainSidebar = signal(!this.isMobile());

  /** Desktop file tree width. The divider is user-resizable; mobile owns its drawer width. */
  leftSidebarWidth = signal(readStudioSidebarWidth());

  activeSidebarTab = signal<'brain' | 'notes'>('brain');

  /** Reference surface top-level mode: "For this writing" vs "Library" (issue #491) */
  referenceMode = signal<'writing' | 'library'>('writing');

  /** Kept source notes for the active writing document */
  keptSources = signal<WritingSourceDto[]>([]);

  /** Note IDs currently being kept (in-flight addSource request) to prevent concurrent races */
  keepingNoteIds = signal<Set<string>>(new Set());

  /** Set of kept note IDs for fast lookup */
  keptNoteIds = computed(() => new Set(this.keptSources().map((s) => s.id)));

  /**
   * Kept sources mapped to Note shape for NoteCardComponent,
   * in addedAt ascending order (chronological accretion).
   */
  keptNotes = computed<Note[]>(() => {
    return [...this.keptSources()]
      .sort((a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime())
      .map((s) => ({
        id: s.id,
        bookId: s.bookId,
        content: s.content,
        selectedText: s.selectedText ?? undefined,
        cfiRange: s.cfiRange ?? undefined,
        createdAt: s.createdAt,
        bookTitle: s.bookTitle ?? undefined,
        sourceAnchorKind: s.sourceAnchorKind ?? undefined,
        sourceAnchorValue: s.sourceAnchorValue ?? undefined,
        anchorVerified: s.anchorVerified ?? undefined,
      }));
  });

  rootItems = signal<WritingDto[]>([]);
  activeItem = signal<WritingContentDto | null>(null);

  editingId = signal<string | null>(null);

  editorText = signal('');
  editorTitle = signal('');
  saveStatus = signal<'Saved' | 'Saving...' | 'Unsaved'>('Saved');

  // Zen (focus) mode — issue #49. Session-only: never persisted.
  isZen = signal(false);

  /** Typewriter mode: keep the caret line centered. Persisted across visits. */
  typewriter = signal(readTypewriter());

  toggleTypewriter(): void {
    const next = !this.typewriter();
    try {
      localStorage.setItem(TYPEWRITER_KEY, next ? '1' : '0');
    } catch {
      // Toggle still applies for the session even if it won't persist.
    }
    this.typewriter.set(next);
  }

  leftSidebarMaxWidth(): number {
    return studioSidebarMaxWidth();
  }

  startLeftSidebarResize(event: PointerEvent): void {
    if (this.isMobile() || event.button !== 0) return;

    const handle = event.currentTarget as HTMLElement | null;
    if (!handle) return;

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = this.leftSidebarWidth();

    handle.setPointerCapture?.(event.pointerId);

    const onPointerMove = (moveEvent: PointerEvent) => {
      this.leftSidebarWidth.set(
        clampStudioSidebarWidth(startWidth + moveEvent.clientX - startX),
      );
    };

    const finish = (finishEvent: PointerEvent) => {
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      if (handle.hasPointerCapture?.(finishEvent.pointerId)) {
        handle.releasePointerCapture(finishEvent.pointerId);
      }
      this.persistLeftSidebarWidth();
    };

    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }

  resizeLeftSidebarWithKeyboard(event: KeyboardEvent): void {
    if (this.isMobile()) return;

    const delta = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0;
    if (delta === 0) return;

    event.preventDefault();
    this.leftSidebarWidth.set(clampStudioSidebarWidth(this.leftSidebarWidth() + delta));
    this.persistLeftSidebarWidth();
  }

  private persistLeftSidebarWidth(): void {
    try {
      localStorage.setItem(STUDIO_SIDEBAR_WIDTH_KEY, String(this.leftSidebarWidth()));
    } catch {
      // Resizing still works for the session if storage is unavailable.
    }
  }

  /** Element that had focus when zen was entered; restored on exit. */
  private zenFocusReturn: HTMLElement | null = null;

  wordCount = computed(() => {
    const text = this.editorText().trim();
    return text ? text.split(/\s+/).length : 0;
  });

  /**
   * Word count reported by the TinyMCE wordcount plugin (authoritative for
   * the rendered document). Falls back to the markdown-derived count until
   * the editor boots and emits its first count.
   */
  editorWordCount = signal<number | null>(null);
  displayWordCount = computed(() => this.editorWordCount() ?? this.wordCount());

  // Brain / Concepts State
  brainQuery = signal('');
  concepts = signal<ConceptDto[]>([]);
  selectedConceptId = signal<string | null>(null);
  selectedConceptNotes = signal<Note[]>([]);

  // Books / Notes State
  books = signal<BookDto[]>([]);
  bookQuery = signal('');
  selectedBookId = signal<string | null>(null);
  selectedBookNotes = signal<Note[]>([]);

  // Computed Map for highlighting concepts in notes
  conceptMap = computed(() => {
    const map = new Map<string, ConceptDto>();
    for (const c of this.concepts()) {
      map.set(c.name.toLowerCase(), c);
    }
    return map;
  });

  filteredConcepts = computed(() => {
    const q = this.brainQuery().toLowerCase();
    const list = this.concepts();
    if (!q) return list;
    return list.filter((c) => c.name.toLowerCase().includes(q));
  });

  filteredBooks = computed(() => {
    const q = this.bookQuery().toLowerCase();
    const list = this.books();
    if (!q) return list;
    return list.filter(
      (b) => b.title.toLowerCase().includes(q) || (b.author && b.author.toLowerCase().includes(q)),
    );
  });

  constructor() {
    const onResize = () => {
      const mobile = window.innerWidth < 768;
      this.isMobile.set(mobile);
      this.leftSidebarWidth.set(clampStudioSidebarWidth(this.leftSidebarWidth()));

      if (!mobile) {
        this.showFileSidebar.set(true);
        this.showBrainSidebar.set(true);
      }
    };

    window.addEventListener('resize', onResize);
    this.destroyRef.onDestroy(() => window.removeEventListener('resize', onResize));

    // Zen mode: Esc exits focus mode; listener removed on destroy.
    window.addEventListener('keydown', this.onKeyDown);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('keydown', this.onKeyDown);
      // Never leave the body class behind if the component is torn down mid-zen.
      document.body.classList.remove('nostos-zen');
    });

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
    this.loadBooks();

    if (this.isMobile()) {
      this.showFileSidebar.set(false);
    }
  }

  closeSidebars() {
    if (this.isMobile()) {
      this.showFileSidebar.set(false);
      this.showBrainSidebar.set(false);
    }
  }

  // --- Zen (focus) mode — issue #49 ---

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.isZen()) {
      this.exitZen();
    }
  };

  enterZen() {
    if (this.isZen()) return;
    this.isZen.set(true);
    // Remember where focus was so it can be restored on exit (accessibility).
    this.zenFocusReturn =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.classList.add('nostos-zen');
  }

  exitZen() {
    if (!this.isZen()) return;
    this.isZen.set(false);
    document.body.classList.remove('nostos-zen');

    // Restore focus to the element that opened zen, falling back to the
    // (now visible again) zen toggle in the document-action cluster.
    const fallback = this.hostElement.nativeElement.querySelector(
      '.zen-toggle',
    ) as HTMLButtonElement | null;
    const target =
      this.zenFocusReturn && this.zenFocusReturn.isConnected ? this.zenFocusReturn : fallback;
    this.zenFocusReturn = null;
    target?.focus();
  }

  loadTree() {
    this.writingsService.list().subscribe((items) => {
      this.rootItems.set(items);
    });
  }

  getNameForId(id: string): string {
    return this.rootItems().find((item) => item.id === id)?.name || '';
  }

  loadKeptSources(writingId: string) {
    this.writingsService.listSources(writingId).subscribe({
      next: (sources) => {
        // A slow response for a document that is no longer active must not overwrite the
        // kept list of the document the writer has since switched to.
        if (this.activeItem()?.id !== writingId) return;
        this.keptSources.set(sources);
      },
      error: () => this.toast.error('Failed to load kept sources'),
    });
  }

  keepNote(noteId: string) {
    const active = this.activeItem();
    if (!active) return;

    if (this.keptNoteIds().has(noteId)) {
      // Already kept: no-op
      return;
    }

    if (this.keepingNoteIds().has(noteId)) {
      // Request already in flight: return early to prevent concurrent race
      return;
    }

    this.keepingNoteIds.update((s) => new Set(s).add(noteId));

    this.writingsService.addSource(active.id, noteId).subscribe({
      next: (source) => {
        this.keepingNoteIds.update((s) => {
          const next = new Set(s);
          next.delete(noteId);
          return next;
        });
        // The writer may have switched documents while the request was in flight; the
        // response belongs to `active`, not to whatever is open now.
        if (this.activeItem()?.id !== active.id) return;
        // Update keptSources locally without full reload if already present or append
        this.keptSources.update((prev) => {
          if (prev.some((s) => s.id === source.id)) return prev;
          return [...prev, source];
        });
      },
      error: () => {
        this.keepingNoteIds.update((s) => {
          const next = new Set(s);
          next.delete(noteId);
          return next;
        });
        this.toast.error('Failed to keep source');
        // Re-fetch kept list on error so UI does not leave an optimistic lie
        if (this.activeItem()?.id === active.id) this.loadKeptSources(active.id);
      },
    });
  }

  removeKeptSource(noteId: string, event?: Event) {
    event?.stopPropagation();
    const active = this.activeItem();
    if (!active) return;

    this.writingsService.removeSource(active.id, noteId).subscribe({
      next: () => {
        if (this.activeItem()?.id !== active.id) return;
        this.keptSources.update((prev) => prev.filter((s) => s.id !== noteId));
      },
      error: () => {
        this.toast.error('Failed to remove source');
        if (this.activeItem()?.id === active.id) this.loadKeptSources(active.id);
      },
    });
  }

  handleItemSelected(node: any) {
    const item = node as WritingDto;

    if (item.type === 'Folder') return;

    this.writingsService.get(item.id).subscribe({
      next: (contentDto) => {
        this.activeItem.set(contentDto);
        this.editorTitle.set(contentDto.name);
        this.editorText.set(contentDto.content);
        this.loadKeptSources(contentDto.id);

        if (this.isMobile()) this.showFileSidebar.set(false);
      },
    });
  }

  handleItemMove(event: { item: any; newParentId: string | null }) {
    const item = event.item as WritingDto;
    const newParentId = event.newParentId;

    this.writingsService.move(item.id, newParentId).subscribe({
      next: () => {
        this.loadTree();
      },
      error: () => {
        this.toast.error('Failed to move item');
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

  /** Writing id awaiting delete confirmation (asked through ConfirmModal). */
  pendingDelete = signal<string | null>(null);

  deleteItem(id: string) {
    this.pendingDelete.set(id);
  }

  cancelDeleteItem(): void {
    this.pendingDelete.set(null);
  }

  confirmDeleteItem(): void {
    const id = this.pendingDelete();
    if (!id) return;
    this.pendingDelete.set(null);

    this.writingsService.delete(id).subscribe(() => {
      this.loadTree();

      if (this.activeItem()?.id === id) {
        this.activeItem.set(null);
        this.editorText.set('');
        this.editorTitle.set('');
        this.keptSources.set([]);
      }
    });
  }

  // --- Brain & Notes Logic ---

  loadBrain() {
    this.conceptsService.list().subscribe((data) => this.concepts.set(data));
  }

  loadBooks() {
    this.booksService
      .list({
        page: 1,
        pageSize: 50,
      })
      .subscribe((data) => {
        this.books.set(data.items);
      });
  }

  selectConcept(id: string) {
    this.selectedConceptId.set(id);
    this.conceptsService.get(id).subscribe((d) => {
      // Map NoteContextDto (noteId) → Note (id) for NoteCardComponent compatibility
      const mapped: Note[] = d.notes.map((n: NoteContextDto) => ({
        id: n.noteId,
        bookId: n.bookId,
        content: n.content,
        cfiRange: n.cfiRange,
        selectedText: n.selectedText,
        createdAt: '',
        bookTitle: n.bookTitle,
      }));
      this.selectedConceptNotes.set(mapped);
    });
  }

  selectBook(id: string) {
    this.selectedBookId.set(id);
    this.notesService.list(id).subscribe((notes) => this.selectedBookNotes.set(notes));
  }

  insertNoteIntoEditor(text: string) {
    if (!text) return;

    this.editorText.update((current) =>
      current ? `${current}\n\n> "${text}"\n` : `> "${text}"\n`,
    );

    if (this.isMobile()) this.showBrainSidebar.set(false);
  }
}
