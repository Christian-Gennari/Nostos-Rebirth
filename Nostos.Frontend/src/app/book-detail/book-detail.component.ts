import { Component, effect, inject, OnInit, signal, model, computed, ViewChild, ElementRef, HostListener } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// Store
import { BookDetailStore } from './book-detail.store';

// DTOs
import { Book, EditionSummaryDto, LinkableBookDto } from '../core/dtos/book.dtos';

/** One book in the current work, as the management list needs it. */
interface WorkMember {
  id: string;
  title: string;
  author: string | null;
}

/**
 * A name for an edition that arrived without one. Defensive only: every server
 * response carries `title` now, but a cached/older payload must not render the
 * detach row as a blank line.
 */
function getEditionTitleOrFallback(edition: EditionSummaryDto): string {
  const format = edition.format?.trim().toUpperCase();
  return format ? `Unknown title (${format})` : 'Unknown title';
}

/** A work-membership action awaiting confirmation. */
interface PendingWorkAction {
  kind: 'link' | 'unlink';
  bookId: string;
  label: string;
  /** True when the action joins two multi-edition groups, not just two books. */
  merge: boolean;
}

// UI Components
import { AddBookModal } from '../add-book-modal/add-book-modal.component';
import { ConfirmModal } from '../ui/confirm-modal/confirm-modal.component';
import { ConceptInputComponent } from '../ui/concept-input.component/concept-input.component';
import { NoteCardComponent } from '../ui/note-card.component/note-card.component';
import { StarRatingComponent } from '../ui/star-rating/star-rating.component';
import { LibraryPreferencesService } from '../core/services/library-preferences.service';
import { BooksService } from '../core/services/books.service';
import { ToastService } from '../core/services/toast.service';

// Icons
import {
  LucideAngularModule,
  ArrowLeft,
  User,
  Calendar,
  Trash2,
  Edit2,
  CircleAlert,
  BookOpen,
  CheckIcon,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Hash,
  Layers,
  Building,
  BookDown,
  Image,
  Headphones,
  Clock,
  Heart,
  CheckCircle,
  RotateCcw,
  Mic,
  MapPin,
  MessageSquareQuote,
  FileText,
  CircleDashed,
} from 'lucide-angular';

@Component({
  standalone: true,
  selector: 'app-book-detail',
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    LucideAngularModule,
    AddBookModal,
    ConfirmModal,
    ConceptInputComponent,
    NoteCardComponent,
    StarRatingComponent,
  ],
  providers: [BookDetailStore],
  templateUrl: './book-detail.component.html',
  styleUrls: ['./book-detail.component.css'],
})
export class BookDetail implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  // Inject the Store
  readonly store = inject(BookDetailStore);
  private preferences = inject(LibraryPreferencesService);
  private booksService = inject(BooksService);
  private toast = inject(ToastService);
  private rememberActiveEdition = effect(() => {
    const book = this.store.book();
    if (book) this.preferences.setActiveEditionId(book.workId, book.id);
  });

  // Icons
  ArrowLeftIcon = ArrowLeft;
  UserIcon = User;
  CalendarIcon = Calendar;
  Trash2Icon = Trash2;
  Edit2Icon = Edit2;
  AlertCircleIcon = CircleAlert;
  BookOpenIcon = BookOpen;
  CheckIcon = CheckIcon;
  ChevronDownIcon = ChevronDown;
  ChevronUpIcon = ChevronUp;
  ChevronRightIcon = ChevronRight;
  HashIcon = Hash;
  LayersIcon = Layers;
  BuildingIcon = Building;
  BookDownIcon = BookDown;
  ImageIcon = Image;
  HeadphonesIcon = Headphones;
  ClockIcon = Clock;
  HeartIcon = Heart;
  CheckCircleIcon = CheckCircle;
  RotateCcwIcon = RotateCcw;
  MicIcon = Mic;
  MapPinIcon = MapPin;
  QuoteIcon = MessageSquareQuote;
  FileTextIcon = FileText;
  CircleDashedIcon = CircleDashed;

  // Local UI State
  isDescriptionExpanded = signal(false);
  showMetadataModal = signal(false);
  showDeleteConfirm = signal(false);
  statusDropdownOpen = signal(false);
  pendingStatus = signal<'notstarted' | 'reading' | 'finished' | null>(null);
  deleting = signal(false);

  /** A pending work link/unlink awaiting confirmation (issue #143). */
  pendingWorkAction = signal<PendingWorkAction | null>(null);

  /** The confirmation question, composed here so the modal stays generic. */
  deleteHeading = computed(() => {
    const title = this.store.book()?.title;
    return title ? `Delete “${title}”?` : 'Delete book?';
  });

  /** True when the hero's decorative cover art failed to load — the band falls back to flat colour. */
  heroArtFailed = signal(false);

  /**
   * True once the hero art has painted, so the band can fade it in.
   *
   * The art is a 128 KB webp. Measured on a throttled phone-class connection it
   * lands **~1.7 s after** the page's entrance fade has finished — i.e. it drops
   * into an already-visible, already-opaque band, which reads as a jolt rather
   * than as the entrance. On localhost the file is ready before the first frame,
   * so the defect is invisible there and only shows up on a real device.
   */
  heroArtLoaded = signal(false);

  /** True once the stage cover has painted, for the same reason as above. */
  coverLoaded = signal(false);

  onHeroArtError(): void {
    this.heroArtFailed.set(true);
  }

  onHeroArtLoad(): void {
    this.heroArtLoaded.set(true);
  }

  /**
   * Also bound to `error`, deliberately: a cover that fails must end up in the
   * same state it had before this fade existed (a visible, empty frame) rather
   * than being stranded at opacity 0.
   */
  onCoverLoad(): void {
    this.coverLoaded.set(true);
  }

  /**
   * URL for the hero band's art layers. Prefers the 640px thumbnail: the art is
   * defocused to the point where detail is irrelevant, and this keeps two
   * full-bleed layers cheap. Null when the book has no cover, which drops the
   * band back to a gradient.
   */
  readonly heroArtUrl = computed<string | null>(() => {
    const cover = this.store.book()?.coverUrl;
    return cover ? `${cover}/thumbnail?width=640` : null;
  });

  newNote = model<string>('');

  /**
   * Human-readable reading status used by the header status chip.
   * Finished wins over in-progress; any saved progress or location counts as
   * "Reading", otherwise the book has not been started.
   */
  readonly readingStatus = computed<{ label: string; modifier: string }>(() => {
    const b = this.store.book();
    if (!b) return { label: 'Not Started', modifier: 'not-started' };
    if (b.finishedAt) return { label: 'Finished', modifier: 'finished' };
    if (b.progressPercent > 0 || b.lastLocation) return { label: 'Reading', modifier: 'reading' };
    return { label: 'Not Started', modifier: 'not-started' };
  });

  // Template Refs for hidden file inputs
  @ViewChild('coverInput') coverInput!: ElementRef<HTMLInputElement>;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.statusDropdownOpen()) {
      this.statusDropdownOpen.set(false);
    }
  }

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.store.loadAllData(id);
      }
    });
  }

  // --- UI Actions (Delegating to Store) ---

  toggleFavorite() {
    this.store.toggleFavorite();
  }
  toggleFinished() {
    this.store.toggleFinished();
  }
  onRate(rating: number) {
    this.store.rate(rating);
  }

  toggleStatusDropdown(event: Event): void {
    event.stopPropagation();
    this.statusDropdownOpen.update((open) => !open);
  }

  selectStatusOption(target: 'notstarted' | 'reading' | 'finished'): void {
    this.statusDropdownOpen.set(false);
    const current = this.readingStatus().modifier;
    const currentCanonical = current === 'not-started' ? 'notstarted' : current;
    if (target === currentCanonical) return;
    this.pendingStatus.set(target);
  }

  cancelStatusChange(): void {
    this.pendingStatus.set(null);
  }

  confirmStatusChange(): void {
    const target = this.pendingStatus();
    if (!target) return;

    this.pendingStatus.set(null);
    if (target === 'notstarted') {
      this.store.resetProgress();
    } else if (target === 'finished') {
      this.store.setFinished(true);
    } else if (target === 'reading') {
      this.store.setFinished(false);
    }
  }

  addNote(): void {
    const content = this.newNote().trim();
    if (!content) return;
    this.store.addNote(content);
    this.newNote.set('');
  }

  onUpdateNote(event: { id: string; content: string; selectedText?: string }): void {
    this.store.updateNote(event.id, event.content, event.selectedText);
  }

  onDeleteNote(id: string): void {
    this.store.deleteNote(id);
  }

  onConceptClick(conceptId: string): void {
    this.goToConcept(conceptId);
  }

  // --- MANUAL WORK MEMBERSHIP (issue #143) ---
  // Secondary/advanced surface: collapsed by default, and it never replaces the
  // edition selector's own switch/read behaviour.

  /** Whether the advanced management block is expanded. */
  readonly manageOpen = signal(false);

  /** Search text for the "link another book" picker. */
  readonly linkQuery = signal('');

  /**
   * Every book in the current work, current book included.
   *
   * Each sibling is named from its OWN summary (`title`/`author`), which is why
   * those fields were added to `EditionSummaryDto`: an unlink row reading the
   * current book's title would name the wrong book as the one being detached.
   */
  readonly workMembers = computed<WorkMember[]>(() => {
    const book = this.store.book();
    if (!book) return [];

    const current: WorkMember = {
      id: book.id,
      title: book.title,
      author: book.author,
    };
    const others = (book.otherEditions ?? []).map<WorkMember>((edition) => ({
      id: edition.id,
      title: edition.title?.trim() || getEditionTitleOrFallback(edition),
      author: edition.author ?? null,
    }));
    return [current, ...others];
  });

  readonly linkCandidates = computed(() => this.store.linkCandidates());

  toggleManage(): void {
    const open = !this.manageOpen();
    this.manageOpen.set(open);
    // Candidates are only fetched when the picker is actually opened, so a
    // book-detail visit never costs a library query it does not need.
    if (open) this.store.loadLinkCandidates(this.linkQuery());
  }

  onLinkQueryChange(query: string): void {
    this.linkQuery.set(query);
    this.store.loadLinkCandidates(query);
  }

  /** A link always merges whole groups, so confirm what will actually happen. */
  askLink(candidate: LinkableBookDto): void {
    const current = this.store.book();
    if (!current) return;

    const groupSize = candidate.editionCount ?? 1;
    const merge = groupSize > 1 || (current.editionCount ?? 1) > 1;
    this.pendingWorkAction.set({
      kind: 'link',
      bookId: candidate.id,
      label: candidate.title,
      merge,
    });
  }

  /** Splitting a book out of a group is worth confirming too. */
  askUnlink(member: WorkMember): void {
    this.pendingWorkAction.set({ kind: 'unlink', bookId: member.id, label: member.title, merge: false });
  }

  cancelWorkAction(): void {
    if (this.store.linkingWork()) return;
    this.pendingWorkAction.set(null);
  }

  confirmWorkAction(): void {
    const action = this.pendingWorkAction();
    if (!action || this.store.linkingWork()) return;

    this.pendingWorkAction.set(null);
    if (action.kind === 'link') this.store.linkToWork(action.bookId);
    else this.store.unlinkFromWork(action.bookId);
  }

  /** Composed here so the shared confirm modal stays generic. */
  workActionHeading = computed(() => {
    const action = this.pendingWorkAction();
    if (!action) return '';
    return action.kind === 'link'
      ? `Link “${action.label}” to this work?`
      : `Unlink “${action.label}”?`;
  });

  workActionDescription = computed(() => {
    const action = this.pendingWorkAction();
    if (!action) return '';
    if (action.kind === 'unlink') {
      return 'This book becomes its own work. Its file, reading progress, notes, rating, review and collections are all kept.';
    }
    return action.merge
      ? 'Both works and everything already grouped with them become one work. Only work grouping changes; every book keeps its file, progress, notes, rating, review and collections.'
      : 'Both books become editions of one work. Only work grouping changes; nothing else about either book is touched.';
  });

  // --- File Actions ---

  onCoverSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.store.uploadCover(file);
  }

  deleteCover() {
    this.store.deleteCover();
  }

  onFileUploadSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.store.uploadFile(file);
  }

  openDeleteConfirm(): void {
    if (this.deleting()) return;
    this.closeMetadataModal();
    this.showDeleteConfirm.set(true);
  }

  cancelDeleteConfirm(): void {
    if (this.deleting()) return;
    this.showDeleteConfirm.set(false);
  }

  /**
   * Deletes the current book after an explicit in-app confirmation, then returns to
   * the Library. A local pending signal guards against duplicate submissions.
   */
  confirmDeleteBook(): void {
    const b = this.store.book();
    if (!b || this.deleting()) return;

    this.deleting.set(true);
    this.booksService.delete(b.id).subscribe({
      next: () => {
        this.toast.success('Book deleted');
        this.showDeleteConfirm.set(false);
        void this.router.navigate(['/library']);
      },
      error: () => {
        this.deleting.set(false);
        this.toast.error('Failed to delete book');
      },
    });
  }

  deleteBook(): void {
    this.openDeleteConfirm();
  }

  // --- Navigation & Helpers ---

  goToConcept(conceptId: string): void {
    this.router.navigate(['/second-brain'], { queryParams: { conceptId } });
  }

  switchEdition(id: string): void {
    this.preferences.setActiveEditionId(this.store.book()?.workId, id);
    void this.router.navigate(['/library', id]);
  }

  getEditionFormat(book: Book | EditionSummaryDto): string {
    const isAudio = book.type === 'audiobook' || book.type === 'audio';
    if (isAudio) return 'Audiobook';
    const fmt = 'format' in book ? book.format : undefined;
    const formatLabel = this.getFormatLabel(book.type, book.fileName, fmt);
    return formatLabel === 'EPUB' || formatLabel === 'PDF' ? formatLabel : 'EBook';
  }

  getEditionSubtitle(book: Book | EditionSummaryDto): string {
    const isAudio = book.type === 'audiobook' || book.type === 'audio';
    const details = isAudio
      ? [book.duration, book.narrator, book.edition]
      : [book.edition];
    return details.filter((d): d is string => !!d?.trim()).join(' • ');
  }

  getEditionLabel(book: Book): string {
    return this.buildEditionLabel(
      book.type,
      book.fileName,
      undefined,
      book.duration,
      book.narrator,
      book.edition,
    );
  }

  getSummaryEditionLabel(edition: EditionSummaryDto): string {
    return this.buildEditionLabel(
      edition.type,
      edition.fileName,
      edition.format,
      edition.duration,
      edition.narrator,
      edition.edition,
    );
  }

  private buildEditionLabel(
    type: string,
    fileName?: string | null,
    format?: string,
    duration?: string | null,
    narrator?: string | null,
    edition?: string | null,
  ): string {
    const normalizedType = type.toLowerCase();
    const isAudio = normalizedType === 'audiobook' || normalizedType === 'audio';
    const formatLabel = this.getFormatLabel(type, fileName, format);
    const label = isAudio
      ? 'Audiobook'
      : formatLabel === 'EPUB' || formatLabel === 'PDF'
        ? formatLabel
        : normalizedType === 'physical'
          ? 'Physical'
          : formatLabel;

    const details = isAudio
      ? [duration, narrator, edition]
      : [edition];
    const detailText = details.filter((detail): detail is string => !!detail?.trim()).join(', ');

    return detailText ? `${label} (${detailText})` : label;
  }

  private getFormatLabel(type: string, fileName?: string | null, format?: string): string {
    const extension = fileName?.split('.').pop()?.trim().toLowerCase();
    if (extension) return extension.toUpperCase();

    const normalizedFormat = format?.trim().toLowerCase();
    switch (normalizedFormat || type.toLowerCase()) {
      case 'audiobook':
      case 'audio':
        return 'AUDIO';
      case 'ebook':
      case 'epub':
        return 'EPUB';
      case 'physical':
        return 'PHYSICAL';
      default:
        return (normalizedFormat || type).toUpperCase();
    }
  }

  toggleDescription() {
    this.isDescriptionExpanded.update((v) => !v);
  }
  openMetadataModal() {
    if (this.store.book()) this.showMetadataModal.set(true);
  }
  closeMetadataModal() {
    this.showMetadataModal.set(false);
  }

  onBookUpdated(updatedBook: Book): void {
    this.store.book.set(updatedBook);
  }

  downloadFile() {
    const id = this.store.book()?.id;
    if (id) window.open(`/api/books/${id}/file/download`, '_blank');
  }

  openReader() {
    const id = this.store.book()?.id;
    if (id) this.router.navigate(['/read', id]);
  }

  triggerCoverPicker() {
    this.coverInput?.nativeElement.click();
  }

  triggerFilePicker() {
    this.fileInput?.nativeElement.click();
  }

  getCollectionName(id: string | null | undefined): string {
    if (!id) return '—';
    const col = this.store.collections().find((c) => c.id === id);
    return col ? col.name : '—';
  }

  /**
   * Every collection this book belongs to, by name. Membership is the set; a
   * collection that no longer exists is skipped rather than rendered as a dash.
   */
  getCollectionNames(book: Book): string[] {
    const byId = new Map(this.store.collections().map((c) => [c.id, c.name]));
    return (book.collectionIds ?? [])
      .map((id) => byId.get(id))
      .filter((name): name is string => !!name);
  }

  isAudioBook(book: Book | null): boolean {
    return book?.type === 'audiobook';
  }
}
