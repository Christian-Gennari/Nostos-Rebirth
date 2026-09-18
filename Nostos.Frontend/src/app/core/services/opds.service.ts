import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { OpdsInfo } from '../dtos/opds.dtos';

@Injectable({ providedIn: 'root' })
export class OpdsService {
  constructor(private http: HttpClient) {}

  /** E-reader access state, including the catalog address to connect with. */
  getInfo(): Observable<OpdsInfo> {
    return this.http.get<OpdsInfo>('/api/opds/info');
  }
}
