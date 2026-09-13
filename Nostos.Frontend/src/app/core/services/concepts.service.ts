import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ConceptDto {
  id: string;
  name: string;
  usageCount: number;
}

export interface ConceptStatsDto {
  totalConcepts: number;
  totalReferences: number;
  singleNoteConcepts: number;
  mostUsedName: string | null;
  mostUsedCount: number;
}

export interface RelatedConceptDto {
  id: string;
  name: string;
  sharedNotes: number;
}

export interface NoteContextDto {
  noteId: string;
  content: string;
  selectedText?: string;
  cfiRange?: string;
  bookId: string;
  bookTitle: string;
  // API responses include this; optional keeps existing local fixtures
  // compatible until the detail-surface tests add their timestamp data.
  createdAt?: string;
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

  getStats(): Observable<ConceptStatsDto> {
    return this.http.get<ConceptStatsDto>('/api/concepts/stats');
  }

  get(id: string): Observable<ConceptDetailDto> {
    return this.http.get<ConceptDetailDto>(`/api/concepts/${id}`);
  }

  getRelated(id: string): Observable<RelatedConceptDto[]> {
    return this.http.get<RelatedConceptDto[]>(`/api/concepts/${id}/related`);
  }

  rename(id: string, concept: string): Observable<ConceptDto> {
    return this.http.put<ConceptDto>(`/api/concepts/${id}`, { concept });
  }

  merge(sourceId: string, targetId: string): Observable<ConceptDto> {
    return this.http.post<ConceptDto>(`/api/concepts/${sourceId}/merge`, { targetId });
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/api/concepts/${id}`);
  }
}
