import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  Book,
  CreateBookDto,
  UpdateBookDto,
  UpdateProgressDto,
  PaginatedResponse,
} from '../dtos/book.dtos';
import { BookFilter, BookSort } from '../dtos/book.enums';

export interface BookListOptions {
  filter?: BookFilter | string;
  sort?: BookSort | string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface BookLocationsDto {
  locations: string;
}

@Injectable({ providedIn: 'root' })
export class BooksService {
  constructor(private http: HttpClient) {}

  list(options: BookListOptions = {}): Observable<PaginatedResponse<Book>> {
    let params = new HttpParams();

    if (options.filter) params = params.set('filter', options.filter);
    if (options.sort) params = params.set('sort', options.sort);
    if (options.search) params = params.set('search', options.search);

    params = params.set('page', options.page ?? 1);
    params = params.set('pageSize', options.pageSize ?? 20);

    return this.http.get<PaginatedResponse<Book>>('/api/books', { params });
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

  // --- Cached Locations Management (instant epub progress state calculation) ---
  getLocations(id: string): Observable<BookLocationsDto> {
    return this.http.get<BookLocationsDto>(`/api/books/${id}/locations`);
  }

  saveLocations(id: string, locations: string): Observable<void> {
    return this.http.post<void>(`/api/books/${id}/locations`, { locations });
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

// 👈 FIXED: Use 'export type' to satisfy isolatedModules
export type { Book };
