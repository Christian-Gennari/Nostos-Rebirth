import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { AddBookModal } from './add-book-modal.component';
import { ProvidersService } from '../core/services/providers.service';
import { ProviderItem, ProviderSummary } from '../core/dtos/provider.dtos';

/**
 * The comparison data a listener actually needs (issue #168).
 *
 * Two recordings of the same work differ by reader, running time and how many
 * parts they were split into — that is what decides between them, so it has to
 * be on the row. Equally important is the converse: an ebook has none of those
 * fields, and a Gutenberg row must not sprout empty labels because an audiobook
 * provider exists.
 */
const librivox: ProviderSummary = {
  id: 'librivox',
  displayName: 'LibriVox',
  capabilities: ['search', 'itemretrieval', 'audiobookacquisition', 'requiresassembly'],
  rightsNotice: 'LibriVox recordings are in the public domain.',
};

const recording: ProviderItem = {
  providerId: 'librivox',
  externalId: '2469',
  title: '1601: Conversation, as it was by the Social Fireside',
  subtitle: null,
  author: 'Mark Twain',
  description: null,
  language: 'English',
  publisher: null,
  publishedDate: '1880',
  categories: 'Dramatic Readings, Humorous Fiction',
  narrator: 'Denny Sayers (d. 2015) and 8 others',
  duration: '0:19:38',
  pageCount: null,
  assets: [
    {
      id: 'm4b',
      kind: 'audiobook',
      label: 'M4B audiobook (single file)',
      sourceFormat: 'librivox-mp3-sections',
      sizeBytes: null,
      isPreferred: true,
    },
  ],
  coverUrl: null,
  sourceUrl: 'https://librivox.org/1601-by-mark-twain/',
  rightsStatement: 'LibriVox recordings are in the public domain.',
  partCount: 2,
};

const ebook: ProviderItem = {
  providerId: 'gutenberg',
  externalId: '1952',
  title: 'The Yellow Wallpaper',
  subtitle: null,
  author: 'Charlotte Perkins Gilman',
  description: null,
  language: 'English',
  publisher: null,
  publishedDate: null,
  categories: 'Married women -- Fiction',
  narrator: null,
  duration: null,
  pageCount: null,
  assets: [
    {
      id: 'epub3-images',
      kind: 'ebook',
      label: 'EPUB3',
      sourceFormat: 'epub3-images',
      sizeBytes: 228882,
      isPreferred: true,
    },
  ],
  coverUrl: null,
  sourceUrl: 'https://www.gutenberg.org/ebooks/1952',
  rightsStatement: 'Public domain in the USA.',
  partCount: null,
};

describe('AddBookModal — audiobook source results', () => {
  let fixture: ComponentFixture<AddBookModal>;
  let component: AddBookModal;
  let providers: ProvidersService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AddBookModal],
      providers: [provideRouter([])],
    }).compileComponents();

    providers = TestBed.inject(ProvidersService);
    vi.spyOn(providers, 'list').mockReturnValue(of([librivox]));

    fixture = TestBed.createComponent(AddBookModal);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('collections', []);
    await fixture.whenStable();
  });

  async function render(items: ProviderItem[]): Promise<void> {
    vi.spyOn(providers, 'search').mockReturnValue(of({ items, hasMore: false, notice: null }));
    component.openSourceTab();
    await fixture.whenStable();
    component.sourceQuery.set('anything');
    component.searchSource();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('shows the reader, running time and section count on a recording', async () => {
    await render([recording]);

    const row = fixture.nativeElement.querySelector('.source-result');
    expect(row.textContent).toContain('Narrated by Denny Sayers (d. 2015) and 8 others');
    expect(row.textContent).toContain('0:19:38');
    expect(row.textContent).toContain('2 sections');
  });

  it('summarises a recording as one asset with no invented size', async () => {
    await render([recording]);
    component.selectSourceItem(recording);
    fixture.detectChanges();

    // A single asset is stated plainly rather than offered as a radio choice
    // between one option.
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Format: M4B audiobook (single file)');
    expect(fixture.nativeElement.querySelectorAll('input[name="sourceAsset"]').length).toBe(0);
  });

  it('does not sprout audiobook fields on an ebook result', async () => {
    await render([ebook]);

    const row = fixture.nativeElement.querySelector('.source-result');
    expect(row.textContent).not.toContain('Narrated by');
    expect(row.textContent).not.toContain('sections');
    // The ebook metadata it does have is untouched.
    expect(row.textContent).toContain('English');
    expect(row.textContent).toContain('The Yellow Wallpaper');
  });
});
