import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Book, CreateBookDto, UpdateBookDto, UpdateProgressDto } from '../dtos/book.dtos';

@Injectable({ providedIn: 'root' })
export class BooksService {
  constructor(private http: HttpClient) {}

  list(): Observable<Book[]> {
    return this.http.get<Book[]>('/api/books');
  }

  get(id: string): Observable<Book> {
    return this.http.get<Book>(`/api/books/${id}`);
  }

  create(dto: CreateBookDto): Observable<Book> {
    return this.http.post<Book>('/api/books', dto);
  }

  update(id: string, dto: UpdateBookDto): Observable<Book> {
    return this.http.put<Book>(`/api/books/${id}`, dto);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/api/books/${id}`);
  }

  // --- NEW METHOD ---
  updateProgress(id: string, location: string, percentage: number): Observable<any> {
    const dto: UpdateProgressDto = { location, percentage };
    return this.http.put(`/api/books/${id}/progress`, dto);
  }

  uploadFile(bookId: string, file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http.post(`/api/books/${bookId}/file`, formData, {
      reportProgress: true,
      observe: 'events',
    });
  }

  uploadCover(bookId: string, file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http.post(`/api/books/${bookId}/cover`, formData, {
      reportProgress: true,
      observe: 'events',
    });
  }

  deleteCover(bookId: string): Observable<void> {
    return this.http.delete<void>(`/api/books/${bookId}/cover`);
  }

  lookup(isbn: string): Observable<CreateBookDto> {
    return this.http.get<CreateBookDto>(`/api/books/lookup/${isbn}`);
  }
}
export type { Book };
