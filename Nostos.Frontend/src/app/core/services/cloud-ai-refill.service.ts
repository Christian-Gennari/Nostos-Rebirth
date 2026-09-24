import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import {
  CloudAiRefillCheckout,
  CloudAiRefillPacksResponse,
  CloudManagedAiUsage,
} from '../dtos/cloud-ai-refill.dtos';

@Injectable({ providedIn: 'root' })
export class CloudAiRefillService {
  constructor(private readonly http: HttpClient) {}

  getUsage(): Observable<CloudManagedAiUsage> {
    return this.http.get<CloudManagedAiUsage>('/api/cloud/ai/usage');
  }

  getPacks(): Observable<CloudAiRefillPacksResponse> {
    return this.http.get<CloudAiRefillPacksResponse>('/api/cloud/billing/refills');
  }

  createCheckout(packId: string): Observable<CloudAiRefillCheckout> {
    return this.http.post<CloudAiRefillCheckout>('/api/cloud/billing/refills/checkout', { packId });
  }
}
