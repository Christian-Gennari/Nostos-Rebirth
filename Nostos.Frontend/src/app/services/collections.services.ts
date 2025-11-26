import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Collection, CreateCollectionDto, UpdateCollectionDto } from '../dtos/collection.dtos';

@Injectable({ providedIn: 'root' })
export class CollectionsService {
  constructor(private http: HttpClient) {}

  list(): Observable<Collection[]> {
    return this.http.get<Collection[]>('/api/collections');
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
