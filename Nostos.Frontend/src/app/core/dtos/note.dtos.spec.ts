import { Note, noteNavigationTarget } from './note.dtos';

const note = (overrides: Partial<Note> = {}): Note => ({
  id: 'note-1',
  bookId: 'book-1',
  content: '',
  createdAt: '2026-09-21T10:00:00Z',
  ...overrides,
});

describe('noteNavigationTarget (issue #324)', () => {
  it('keeps the established cfiRange navigation contract first', () => {
    expect(
      noteNavigationTarget(
        note({
          cfiRange: '{"pageNumber":12,"yPercent":0,"rects":[]}',
          sourceAnchorKind: 'pdf_page',
          sourceAnchorValue: '37',
          anchorVerified: true,
        }),
      ),
    ).toBe('{"pageNumber":12,"yPercent":0,"rects":[]}');
  });

  it('falls back to a verified EPUB assistant anchor', () => {
    const cfi = 'epubcfi(/6/4[chapter]!/4/2/2)';
    expect(
      noteNavigationTarget(
        note({
          sourceAnchorKind: 'epub_cfi',
          sourceAnchorValue: cfi,
          anchorVerified: true,
        }),
      ),
    ).toBe(cfi);
  });

  it('converts a verified PDF assistant anchor to a numeric page', () => {
    expect(
      noteNavigationTarget(
        note({
          sourceAnchorKind: 'pdf_page',
          sourceAnchorValue: '37',
          anchorVerified: true,
        }),
      ),
    ).toBe(37);
  });

  it('refuses unverified or invalid typed locations', () => {
    expect(
      noteNavigationTarget(
        note({
          sourceAnchorKind: 'pdf_page',
          sourceAnchorValue: '37',
          anchorVerified: false,
        }),
      ),
    ).toBeNull();

    expect(
      noteNavigationTarget(
        note({
          sourceAnchorKind: 'pdf_page',
          sourceAnchorValue: '37.5',
          anchorVerified: true,
        }),
      ),
    ).toBeNull();

    expect(
      noteNavigationTarget(
        note({
          sourceAnchorKind: 'pdf_page',
          sourceAnchorValue: '-1',
          anchorVerified: true,
        }),
      ),
    ).toBeNull();
  });
});
