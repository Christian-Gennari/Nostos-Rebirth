import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Note, CreateNoteDto, NoteSearchHit, UpdateNoteDto } from '../dtos/note.dtos';

@Injectable({ providedIn: 'root' })
export class NotesService {
  constructor(private http: HttpClient) {}

  list(bookId: string): Observable<Note[]> {
    return this.http.get<Note[]>(`/api/books/${bookId}/notes`);
  }

  create(bookId: string, dto: CreateNoteDto): Observable<Note> {
    return this.http.post<Note>(`/api/books/${bookId}/notes`, dto);
  }

  update(id: string, dto: UpdateNoteDto): Observable<Note> {
    return this.http.put<Note>(`/api/notes/${id}`, dto);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/api/notes/${id}`);
  }

  /**
   * Notes whose text, quoted passage or book title match (issue #158). This is what
   * makes a word living only inside a note reachable at all.
   */
  search(query: string, limit = 50): Observable<NoteSearchHit[]> {
    return this.http.get<NoteSearchHit[]>('/api/notes/search', {
      params: { query, limit },
    });
  }

  /**
   * Notes linked to no concept. They can never appear as a concept row, which is
   * why the index needs a section of its own for them.
   */
  unlinked(limit = 50): Observable<NoteSearchHit[]> {
    return this.http.get<NoteSearchHit[]>('/api/notes/unlinked', { params: { limit } });
  }
}
