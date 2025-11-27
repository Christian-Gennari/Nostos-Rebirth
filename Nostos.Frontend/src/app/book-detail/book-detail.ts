import { Component, inject, OnInit, signal, model } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BooksService, Book } from '../services/books.services';
import { NotesService } from '../services/notes.services';
import { Note } from '../dtos/note.dtos';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SidebarCollections } from '../sidebar-collections/sidebar-collections';
import {
  LucideAngularModule,
  ArrowLeft,
  User,
  Calendar,
  Trash2,
  Edit2,
  AlertCircle,
  BookOpen,
  CheckIcon,
} from 'lucide-angular';

@Component({
  standalone: true,
  selector: 'app-book-detail',
  imports: [CommonModule, FormsModule, RouterLink, SidebarCollections, LucideAngularModule],
  templateUrl: './book-detail.html',
  styleUrls: ['./book-detail.css'],
})
export class BookDetail implements OnInit {
  private route = inject(ActivatedRoute);
  private booksService = inject(BooksService);
  private notesService = inject(NotesService);

  // Icons
  ArrowLeftIcon = ArrowLeft;
  UserIcon = User;
  CalendarIcon = Calendar;
  Trash2Icon = Trash2;
  Edit2Icon = Edit2;
  AlertCircleIcon = AlertCircle;
  BookOpenIcon = BookOpen;
  CheckIcon = CheckIcon;

  // State
  loading = signal(true);
  book = signal<Book | null>(null);
  error = signal<string | null>(null);

  // Notes State
  notes = signal<Note[]>([]);
  newNote = model<string>('');

  editingNote = signal<Note | null>(null);
  editNoteContent = model<string>('');

  coverInput!: HTMLInputElement;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('Invalid book ID');
      this.loading.set(false);
      return;
    }

    this.loadBook(id);
    this.loadNotes(id);
  }

  loadBook(id: string): void {
    this.booksService.get(id).subscribe({
      next: (book) => {
        this.book.set(book);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Book not found');
        this.loading.set(false);
      },
    });
  }

  loadNotes(bookId: string): void {
    this.notesService.list(bookId).subscribe({
      next: (notes) => this.notes.set(notes),
    });
  }

  addNote(): void {
    const book = this.book();
    if (!book) return;

    const content = this.newNote().trim();
    if (!content) return;

    this.notesService.create(book.id, { content }).subscribe({
      next: () => {
        this.newNote.set('');
        this.loadNotes(book.id);
      },
    });
  }

  startEdit(note: Note): void {
    this.editingNote.set(note);
    this.editNoteContent.set(note.content);
  }

  saveEdit(): void {
    const note = this.editingNote();
    if (!note) return;

    this.notesService
      .update(note.id, {
        content: this.editNoteContent(),
      })
      .subscribe({
        next: () => {
          this.editingNote.set(null);
          this.loadNotes(note.bookId);
        },
      });
  }

  cancelEdit(): void {
    this.editingNote.set(null);
  }

  deleteNote(id: string): void {
    if (!confirm('Delete this note?')) return;

    this.notesService.delete(id).subscribe({
      next: () => {
        const book = this.book();
        if (book) this.loadNotes(book.id);
      },
    });
  }

  openFile() {
    const id = this.book()?.id;
    if (!id) return;

    window.open(`/api/books/${id}/file`, '_blank');
  }

  triggerCoverPicker() {
    const input = document.querySelector('input[type=file][accept="image/*"]') as HTMLInputElement;
    if (input) input.click();
  }

  onCoverSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.book()?.id) return;

    this.booksService.uploadCover(this.book()!.id, file).subscribe({
      next: (event) => {
        if (event.type === 4 /* HttpEventType.Response */) {
          // Refresh the book so the UI updates to the new cover
          this.loadBook(this.book()!.id);
        }
      },
      error: (err) => console.error('Cover upload error:', err),
    });
  }

  deleteCover() {
    const id = this.book()?.id;
    if (!id) return;

    if (!confirm('Remove cover image?')) return;

    this.booksService.deleteCover(id).subscribe({
      next: () => this.loadBook(id), // Refresh to clear UI
      error: (err) => console.error('Delete cover error:', err),
    });
  }

  triggerFilePicker() {
    const input = document.querySelector(
      'input[type=file][accept=".epub,.pdf,.txt"]'
    ) as HTMLInputElement;
    if (input) input.click();
  }

  onFileUploadSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file || !this.book()?.id) return;

    this.booksService.uploadFile(this.book()!.id, file).subscribe({
      next: () => {
        // Refresh the book to display updated "hasFile"
        this.loadBook(this.book()!.id);
      },
      error: (err) => console.error('File upload error:', err),
    });
  }

  formatNote(content: string): string {
    // Regex captures the text inside [[...]] as group $1
    // We replace the whole thing with just that text wrapped in a span
    return content.replace(/\[\[(.*?)\]\]/g, '<span class="concept-tag">$1</span>');
  }
}
