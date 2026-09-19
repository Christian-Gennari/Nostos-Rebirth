import {
  DEFAULT_HIGHLIGHT_COLOUR,
  HIGHLIGHT_COLOURS,
  asHighlightColour,
  highlightColourKey,
  highlightFillRef,
  highlightFillVar,
  readHighlightColour,
  resolveHighlightFill,
  writeHighlightColour,
} from './highlight-colours';

/**
 * The reader's highlighter pens (issue #208). These tests pin the three things a
 * future refactor could quietly break: a colour is named rather than hardcoded as
 * a hex, the choice is remembered per book, and an unknown stored value degrades
 * to the default instead of producing an invisible highlight.
 */
describe('highlight colours', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('offers four named pens, with amber as the default', () => {
    expect(HIGHLIGHT_COLOURS.map((option) => option.id)).toEqual(['amber', 'sage', 'blue', 'rose']);
    expect(HIGHLIGHT_COLOURS.every((option) => !!option.label)).toBe(true);
    expect(DEFAULT_HIGHLIGHT_COLOUR).toBe('amber');
  });

  it('derives token names from the colour, so no hex lives in code', () => {
    expect(highlightFillVar('sage')).toBe('--highlight-sage');
    expect(highlightFillRef('sage')).toBe('var(--highlight-sage)');
  });

  it('falls back to the default for anything that is not a known pen', () => {
    // localStorage can hold a value from an older build or another tab.
    expect(asHighlightColour('chartreuse')).toBe(DEFAULT_HIGHLIGHT_COLOUR);
    expect(asHighlightColour(null)).toBe(DEFAULT_HIGHLIGHT_COLOUR);
    expect(asHighlightColour('rose')).toBe('rose');
  });

  it('remembers the pen per book, not globally', () => {
    writeHighlightColour('book-a', 'blue');
    writeHighlightColour('book-b', 'rose');

    expect(readHighlightColour('book-a')).toBe('blue');
    expect(readHighlightColour('book-b')).toBe('rose');
    // A book never given a pen starts on the default.
    expect(readHighlightColour('book-c')).toBe(DEFAULT_HIGHLIGHT_COLOUR);
    expect(highlightColourKey('book-a')).toBe('nostos.highlight.book-a');
  });

  it('resolves the fill from the stylesheet, which is where the value lives', () => {
    const root = document.documentElement;
    root.style.setProperty('--highlight-sage', '#b7e4cf');
    try {
      expect(resolveHighlightFill('sage', '#fallback')).toBe('#b7e4cf');
      // An unset pen falls back rather than handing a raw `var()` to a canvas.
      expect(resolveHighlightFill('rose', '#fallback')).toBe('#fallback');
      expect(resolveHighlightFill('rose', '#fallback', null)).toBe('#fallback');
    } finally {
      root.style.removeProperty('--highlight-sage');
    }
  });
});
