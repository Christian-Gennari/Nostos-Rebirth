import { Injectable, signal } from '@angular/core'; // <--- Import signal
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs'; // <--- Import tap
import { Collection, CreateCollectionDto, UpdateCollectionDto } from '../dtos/collection.dtos';

@Injectable({ providedIn: 'root' })
export class CollectionsService {
  constructor(private http: HttpClient) {}

  // GLOBAL STATE
  // null = "All Books"
  activeCollectionId = signal<string | null>(null);
  sidebarExpanded = signal(true);

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
    return this.http.delete<void>(`/api/collections/${id}`).pipe(
      // If we delete the active collection, reset to "All Books"
      tap(() => {
        if (this.activeCollectionId() === id) {
          this.activeCollectionId.set(null);
        }
      })
    );
  }
}
