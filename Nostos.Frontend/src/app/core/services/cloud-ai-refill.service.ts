import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { CloudManagedAiUsage } from '../dtos/cloud-ai-refill.dtos';

@Injectable({ providedIn: 'root' })
export class CloudAiRefillService {
  constructor(private readonly http: HttpClient) {}

  getUsage(): Observable<CloudManagedAiUsage> {
    return this.http.get<CloudManagedAiUsage>('/api/cloud/ai/usage');
  }
}
