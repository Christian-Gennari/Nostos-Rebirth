import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Book {
  id: string;
  title: string;
  author: string | null;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class BooksService {
  constructor(private http: HttpClient) {}

  list(): Observable<Book[]> {
    return this.http.get<Book[]>('/api/books');
  }

  get(id: string): Observable<Book> {
    return this.http.get<Book>(`/api/books/${id}`);
  }

  create(book: Partial<Book>): Observable<Book> {
    return this.http.post<Book>('/api/books', book);
  }
}
