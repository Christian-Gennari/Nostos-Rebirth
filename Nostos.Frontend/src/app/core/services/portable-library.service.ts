import { HttpClient, HttpEvent, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PortableLibraryService {
  private readonly http = inject(HttpClient);

  exportArchive(): Observable<HttpEvent<Blob>> {
    return this.http.get('/api/portability/export', {
      observe: 'events',
      responseType: 'blob',
      reportProgress: true,
    });
  }

  importArchive(file: File): Observable<unknown> {
    return this.http.post('/api/portability/import', file, {
      headers: new HttpHeaders({
        'Content-Type': 'application/vnd.nostos.portable+zip',
      }),
    });
  }
}
