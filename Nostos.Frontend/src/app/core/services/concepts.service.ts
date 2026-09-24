import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ConceptDto {
  id: string;
  name: string;
  usageCount: number;
  // Appended for the index search (issue #158). The plain list has no note text,
  // so a term that only appears inside a note can only be matched on the server;
  // these carry what matched, and are absent on the unfiltered list.
  noteMatchCount?: number;
  noteMatchSnippet?: string | null;
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
  /** Exact notes that make the structural co-occurrence inspectable. */
  sharedNoteIds?: string[];
}

export interface ConceptGraphNodeDto {
  id: string;
  name: string;
  usageCount: number;
}

export interface ConceptGraphEdgeDto {
  sourceId: string;
  targetId: string;
  sharedNotes: number;
}

export interface ConceptGraphDto {
  nodes: ConceptGraphNodeDto[];
  edges: ConceptGraphEdgeDto[];
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

  /**
   * Note-text search for the index (issue #158). `GET /api/concepts` carries no
   * note text at all, so the term is matched server-side against note content,
   * quote text and book title — the same three fields the note-level search inside
   * a concept already matches.
   */
  searchNotes(term: string): Observable<ConceptDto[]> {
    return this.http.get<ConceptDto[]>('/api/concepts', { params: { search: term } });
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

  getGraph(): Observable<ConceptGraphDto> {
    return this.http.get<ConceptGraphDto>('/api/concepts/graph');
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
