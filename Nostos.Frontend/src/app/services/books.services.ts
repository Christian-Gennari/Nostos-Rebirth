import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Book, CreateBookDto, UpdateBookDto, UpdateProgressDto } from '../dtos/book.dtos';

@Injectable({ providedIn: 'root' })
export class BooksService {
  constructor(private http: HttpClient) {}

  // UPDATED: Now accepts filter, sort, and search parameters
  list(filter?: string, sort?: string, search?: string): Observable<Book[]> {
    let params = new HttpParams();

    if (filter) {
      params = params.set('filter', filter);
    }
    if (sort) {
      params = params.set('sort', sort);
    }
    // NEW: Add search query to params
    if (search) {
      params = params.set('search', search);
    }

    return this.http.get<Book[]>('/api/books', { params });
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
