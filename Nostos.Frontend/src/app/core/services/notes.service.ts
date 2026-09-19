import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Note, CreateNoteDto, NoteSearchHit, NoteSearchPage, UpdateNoteDto } from '../dtos/note.dtos';

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
   * Notes linked to no concept — an exception queue, not a second content type.
   *
   * Since issue #256 this is paged rather than a single capped list. The page
   * carries the total, because review mode traverses the whole set and must never
   * present the first 50 rows as "the unlinked notes". The caller passes the
   * offset of the first row it does not already hold, so a queue that shrinks as
   * the user resolves notes still asks for the right next row.
   */
  unlinkedPage(limit = 25, offset = 0): Observable<NoteSearchPage> {
    return this.http.get<NoteSearchPage>('/api/notes/unlinked', { params: { limit, offset } });
  }
}
