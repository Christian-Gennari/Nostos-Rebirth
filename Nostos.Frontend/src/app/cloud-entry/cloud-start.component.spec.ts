import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';

import { CloudStartComponent } from './cloud-start.component';

describe('CloudStartComponent', () => {
  it('replaces the acquisition route with the normal Library route once product access is ready', () => {
    const navigateByUrl = vi.fn().mockResolvedValue(true);

    TestBed.configureTestingModule({
      imports: [CloudStartComponent],
      providers: [{ provide: Router, useValue: { navigateByUrl } }],
    });

    const fixture = TestBed.createComponent(CloudStartComponent);
    fixture.detectChanges();

    expect(navigateByUrl).toHaveBeenCalledWith('/library', { replaceUrl: true });
  });
});
