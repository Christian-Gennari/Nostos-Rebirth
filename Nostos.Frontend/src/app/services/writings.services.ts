import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  WritingDto,
  WritingContentDto,
  CreateWritingDto,
  UpdateWritingDto,
  MoveWritingDto,
} from '../dtos/writing.dtos';

@Injectable({
  providedIn: 'root',
})
export class WritingsService {
  private http = inject(HttpClient);
  private baseUrl = '/api/writings';

  // GET: Fetch the entire file tree
  list(): Observable<WritingDto[]> {
    return this.http.get<WritingDto[]>(this.baseUrl);
  }

  // GET: Fetch a single document content
  get(id: string): Observable<WritingContentDto> {
    return this.http.get<WritingContentDto>(`${this.baseUrl}/${id}`);
  }

  // POST: Create a Folder or Document
  create(dto: CreateWritingDto): Observable<WritingDto> {
    return this.http.post<WritingDto>(this.baseUrl, dto);
  }

  // PUT: Update Name or Content (Auto-save)
  update(id: string, dto: UpdateWritingDto): Observable<WritingContentDto> {
    return this.http.put<WritingContentDto>(`${this.baseUrl}/${id}`, dto);
  }

  // PUT: Move Item (Drag & Drop)
  move(id: string, newParentId: string | null): Observable<WritingDto> {
    const dto: MoveWritingDto = { newParentId };
    return this.http.put<WritingDto>(`${this.baseUrl}/${id}/move`, dto);
  }

  // DELETE: Remove item and its children
  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }
}
