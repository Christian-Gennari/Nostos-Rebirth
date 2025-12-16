import { Component, inject, OnInit, signal, model } from '@angular/core';
import { ActivatedRoute, RouterLink, Router, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { filter } from 'rxjs/operators';

// Store
import { BookDetailStore } from './book-detail.store';

// DTOs
import { Book } from '../dtos/book.dtos';

// UI Components
import { AddBookModal } from '../add-book-modal/add-book-modal';
import { ConceptInputComponent } from '../ui/concept-input.component/concept-input.component';
import { NoteCardComponent } from '../ui/note-card.component/note-card.component';
import { StarRatingComponent } from '../ui/star-rating/star-rating.component';

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
  Hash,
  Layers,
  Building,
  BookDown,
  Image,
  Headphones,
  Clock,
  Heart,
  CheckCircle,
  Mic,
  MapPin,
  MessageSquareQuote,
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
    ConceptInputComponent,
    NoteCardComponent,
    StarRatingComponent,
  ],
  providers: [BookDetailStore],
  templateUrl: './book-detail.html',
  styleUrls: ['./book-detail.css'],
})
export class BookDetail implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  // Inject the Store
  readonly store = inject(BookDetailStore);

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
  HashIcon = Hash;
  LayersIcon = Layers;
  BuildingIcon = Building;
  BookDownIcon = BookDown;
  ImageIcon = Image;
  HeadphonesIcon = Headphones;
  ClockIcon = Clock;
  HeartIcon = Heart;
  CheckCircleIcon = CheckCircle;
  MicIcon = Mic;
  MapPinIcon = MapPin;
  QuoteIcon = MessageSquareQuote;

  // Local UI State
  isDescriptionExpanded = signal(false);
  showMetadataModal = signal(false);
  newNote = model<string>('');

  ngOnInit(): void {
    // 1. Initial Load
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) this.store.loadAllData(id);
    });

    // 2. Re-entry / Background Refresh
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => {
      const id = this.route.snapshot.paramMap.get('id');
      if (id && this.router.url.includes(`/library/${id}`)) {
        this.store.loadBook(id, { background: true });
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

  // 👇 ADDED MISSING METHOD HERE
  onConceptClick(conceptId: string): void {
    this.goToConcept(conceptId);
  }

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

  // --- Navigation & Helpers ---

  goToConcept(conceptId: string): void {
    this.router.navigate(['/second-brain'], { queryParams: { conceptId } });
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
    if (id) window.open(`/api/books/${id}/file`, '_blank');
  }

  openReader() {
    const id = this.store.book()?.id;
    if (id) this.router.navigate(['/read', id]);
  }

  triggerCoverPicker() {
    (document.querySelector('input[type=file][accept="image/*"]') as HTMLInputElement)?.click();
  }

  triggerFilePicker() {
    (
      document.querySelector(
        'input[type=file][accept=".epub,.pdf,.txt,.mobi,.mp3,.m4a,.m4b"]'
      ) as HTMLInputElement
    )?.click();
  }

  getCollectionName(id: string | null | undefined): string {
    if (!id) return '—';
    const col = this.store.collections().find((c) => c.id === id);
    return col ? col.name : '—';
  }

  isAudioBook(book: Book | null): boolean {
    return book?.type === 'audiobook';
  }
}
