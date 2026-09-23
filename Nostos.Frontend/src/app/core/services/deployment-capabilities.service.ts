import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, shareReplay } from 'rxjs';

import { DeploymentCapabilities } from '../dtos/deployment-capabilities.dtos';

/**
 * Runtime deployment contract reported by the Nostos server.
 *
 * The Angular bundle is identical for SelfHosted and Cloud. Consumers use
 * these server-authoritative product capabilities instead of build flags,
 * hostname checks, or assumptions about infrastructure vendors.
 */
@Injectable({ providedIn: 'root' })
export class DeploymentCapabilitiesService {
  private readonly http = inject(HttpClient);
  private capabilities$?: Observable<DeploymentCapabilities>;

  get(refresh = false): Observable<DeploymentCapabilities> {
    if (refresh || !this.capabilities$) {
      this.capabilities$ = this.http
        .get<DeploymentCapabilities>('/api/runtime/capabilities')
        .pipe(shareReplay({ bufferSize: 1, refCount: false }));
    }

    return this.capabilities$;
  }
}
