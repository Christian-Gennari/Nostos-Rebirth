import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { ManagedOpdsAccess, OpdsInfo } from '../dtos/opds.dtos';

@Injectable({ providedIn: 'root' })
export class OpdsService {
  constructor(private http: HttpClient) {}

  /** E-reader access state, including the catalog address to connect with. */
  getInfo(): Observable<OpdsInfo> {
    return this.http.get<OpdsInfo>('/api/opds/info');
  }

  /** Hosted credential state; normal browser auth remains authoritative. */
  getManagedAccess(): Observable<ManagedOpdsAccess> {
    return this.http.get<ManagedOpdsAccess>('/api/cloud/opds/');
  }

  /** Enables hosted e-reader access and returns the generated password once. */
  enableManagedAccess(): Observable<ManagedOpdsAccess> {
    return this.http.post<ManagedOpdsAccess>('/api/cloud/opds/', {});
  }

  /** Replaces the hosted reader password; the old password stops working immediately. */
  rotateManagedPassword(): Observable<ManagedOpdsAccess> {
    return this.http.post<ManagedOpdsAccess>('/api/cloud/opds/rotate', {});
  }

  /** Revokes the hosted reader credential and disconnects configured readers. */
  revokeManagedAccess(): Observable<ManagedOpdsAccess> {
    return this.http.delete<ManagedOpdsAccess>('/api/cloud/opds/');
  }
}
