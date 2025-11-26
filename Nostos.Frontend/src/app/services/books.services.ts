import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Book, CreateBookDto, UpdateBookDto } from '../dtos/book.dtos';

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
}
export type { Book };
