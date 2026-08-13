import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  Collection,
  CollectionCountDto,
  CreateCollectionDto,
  UpdateCollectionDto,
} from '../dtos/collection.dtos';

@Injectable({ providedIn: 'root' })
export class CollectionsService {
  constructor(private http: HttpClient) {}

  // UI navigation state is owned by the router (URL), not this HTTP service.

  sidebarExpanded = signal(true);

  list(): Observable<Collection[]> {
    return this.http.get<Collection[]>('/api/collections');
  }

  /** Descendant-inclusive book counts per collection (REST-only, see CollectionCountDto). */
  getCounts(): Observable<CollectionCountDto[]> {
    return this.http.get<CollectionCountDto[]>('/api/collections/counts');
  }

  create(dto: CreateCollectionDto): Observable<Collection> {
    return this.http.post<Collection>('/api/collections', dto);
  }

  update(id: string, dto: UpdateCollectionDto): Observable<Collection> {
    return this.http.put<Collection>(`/api/collections/${id}`, dto);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/api/collections/${id}`);
  }
}
