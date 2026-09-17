import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  ProviderAcquisition,
  ProviderAcquireRequest,
  ProviderItem,
  ProviderSearchResult,
  ProviderSummary,
} from '../dtos/provider.dtos';

/**
 * The import surface for external content sources.
 *
 * Imports are jobs rather than plain requests: a whole audiobook takes far
 * longer than any sensible HTTP call, so starting one returns immediately and
 * the caller polls. Nothing here is part of the library contract — it is the
 * "add from a source" surface only.
 */
@Injectable({ providedIn: 'root' })
export class ProvidersService {
  constructor(private http: HttpClient) {}

  /** The registered sources and what each of them can do. */
  list(): Observable<ProviderSummary[]> {
    return this.http.get<ProviderSummary[]>('/api/providers');
  }

  search(
    providerId: string,
    query: string,
    limit = 20,
    offset = 0,
  ): Observable<ProviderSearchResult> {
    const params = new HttpParams()
      .set('query', query)
      .set('limit', limit)
      .set('offset', offset);

    return this.http.get<ProviderSearchResult>(
      `/api/providers/${encodeURIComponent(providerId)}/search`,
      { params },
    );
  }

  /**
   * The full item. This is where its downloadable assets live: a search result
   * deliberately carries none, so nothing can be imported until this is fetched.
   */
  item(providerId: string, externalId: string): Observable<ProviderItem> {
    return this.http.get<ProviderItem>(
      `/api/providers/${encodeURIComponent(providerId)}/items/${encodeURIComponent(externalId)}`,
    );
  }

  /** Queue an import. Returns as soon as the job is accepted, not when it is done. */
  acquire(providerId: string, body: ProviderAcquireRequest): Observable<ProviderAcquisition> {
    return this.http.post<ProviderAcquisition>(
      `/api/providers/${encodeURIComponent(providerId)}/acquire`,
      body,
    );
  }

  job(jobId: string): Observable<ProviderAcquisition> {
    return this.http.get<ProviderAcquisition>(
      `/api/providers/acquisitions/${encodeURIComponent(jobId)}`,
    );
  }

  cancel(jobId: string): Observable<void> {
    return this.http.delete<void>(`/api/providers/acquisitions/${encodeURIComponent(jobId)}`);
  }
}
