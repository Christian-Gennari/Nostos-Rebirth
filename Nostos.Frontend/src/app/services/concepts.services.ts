import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ConceptDto {
  id: string;
  name: string;
  usageCount: number;
}

export interface NoteContextDto {
  noteId: string;
  content: string;
  selectedText?: string; // <--- NEW
  cfiRange?: string; // <--- NEW
  bookId: string;
  bookTitle: string;
}

export interface ConceptDetailDto {
  id: string;
  name: string;
  notes: NoteContextDto[];
}

@Injectable({ providedIn: 'root' })
export class ConceptsService {
  private http = inject(HttpClient);

  list(): Observable<ConceptDto[]> {
    return this.http.get<ConceptDto[]>('/api/concepts');
  }

  get(id: string): Observable<ConceptDetailDto> {
    return this.http.get<ConceptDetailDto>(`/api/concepts/${id}`);
  }
}
