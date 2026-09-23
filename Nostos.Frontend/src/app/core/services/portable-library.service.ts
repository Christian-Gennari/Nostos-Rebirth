import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PortableLibraryService {
  private readonly http = inject(HttpClient);

  importArchive(file: File): Observable<unknown> {
    return this.http.post('/api/portability/import', file, {
      headers: new HttpHeaders({
        'Content-Type': 'application/vnd.nostos.portable+zip',
      }),
    });
  }
}
