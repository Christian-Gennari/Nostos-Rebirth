import { TestBed } from '@angular/core/testing';

import {
  LIBRARY_FILTER_STORAGE_KEY,
  LibraryFilterService,
} from './library-filter.service';

describe('LibraryFilterService', () => {
  let service: LibraryFilterService;

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({}).compileComponents();
  });

  function createService(): LibraryFilterService {
    return TestBed.inject(LibraryFilterService);
  }

  it('starts unfiltered', () => {
    service = createService();

    expect(service.status()).toBe('all');
    expect(service.format()).toBe('all');
    expect(service.collectionId()).toBeNull();
  });

  it('toggles a status off when it is already active', () => {
    service = createService();

    service.toggleStatus('reading');
    expect(service.status()).toBe('reading');

    service.toggleStatus('reading');
    expect(service.status()).toBe('all');
  });

  it('switching status keeps format and collection (order-independent)', () => {
    service = createService();

    service.toggleCollection('c1');
    service.toggleFormat('audiobook');
    service.toggleStatus('finished');

    expect(service.collectionId()).toBe('c1');
    expect(service.format()).toBe('audiobook');
    expect(service.status()).toBe('finished');
  });

  it('clearAll resets every dimension', () => {
    service = createService();
    service.toggleCollection('c1');
    service.toggleFormat('audiobook');
    service.toggleStatus('finished');

    service.clearAll();

    expect(service.status()).toBe('all');
    expect(service.format()).toBe('all');
    expect(service.collectionId()).toBeNull();
  });

  it('persists changes to localStorage', () => {
    service = createService();
    service.toggleStatus('reading');
    TestBed.flushEffects();

    expect(JSON.parse(localStorage.getItem(LIBRARY_FILTER_STORAGE_KEY)!)).toEqual({
      status: 'reading',
      format: 'all',
      collectionId: null,
    });
  });

  it('hydrates persisted filters on creation', () => {
    localStorage.setItem(
      LIBRARY_FILTER_STORAGE_KEY,
      JSON.stringify({ status: 'finished', format: 'ebook', collectionId: 'c9' }),
    );

    service = createService();

    expect(service.status()).toBe('finished');
    expect(service.format()).toBe('ebook');
    expect(service.collectionId()).toBe('c9');
  });

  it('ignores malformed or invalid persisted filters', () => {
    localStorage.setItem(
      LIBRARY_FILTER_STORAGE_KEY,
      JSON.stringify({ status: 'bogus', format: 42, collectionId: 7 }),
    );

    service = createService();

    expect(service.status()).toBe('all');
    expect(service.format()).toBe('all');
    expect(service.collectionId()).toBeNull();
  });

  it('ignores non-JSON persisted filters', () => {
    localStorage.setItem(LIBRARY_FILTER_STORAGE_KEY, 'not-json{');

    service = createService();

    expect(service.status()).toBe('all');
    expect(service.format()).toBe('all');
    expect(service.collectionId()).toBeNull();
  });
});
