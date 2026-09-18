import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BookChapter } from '../../core/dtos/book.dtos';
import {
  ChaptersEditor,
  formatTimestamp,
  parseChapterLines,
  parseTimestamp,
} from './chapters-editor.component';

describe('chapter timestamp helpers', () => {
  it('parses the three shapes the player can store', () => {
    expect(parseTimestamp('00:05:30')).toBe(330);
    expect(parseTimestamp('5:30')).toBe(330);
    expect(parseTimestamp('330')).toBe(330);
    expect(parseTimestamp('01:00:00')).toBe(3600);
    expect(parseTimestamp(' 12:00 ')).toBe(720);
  });

  it('refuses text that is not a time rather than guessing zero', () => {
    // Silently reading this as 0:00:00 is what makes a bad paste look like it worked.
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp('intro')).toBeNull();
    expect(parseTimestamp('1:2:3:4')).toBeNull();
    expect(parseTimestamp('aa:bb')).toBeNull();
    expect(parseTimestamp('00:75:00')).toBeNull();
    expect(parseTimestamp('-30')).toBeNull();
  });

  it('formats back into the edited shape and round-trips', () => {
    expect(formatTimestamp(0)).toBe('00:00:00');
    expect(formatTimestamp(330)).toBe('00:05:30');
    expect(formatTimestamp(4711)).toBe('01:18:31');
    expect(parseTimestamp(formatTimestamp(4711))).toBe(4711);
  });

  it('parses a pasted list, keeping invalid lines so they can be fixed', () => {
    const lines = parseChapterLines('00:00:00 Introduction\n\n00:05:30 Chapter One\nnot a time\n');

    expect(lines.length).toBe(3);
    expect(lines[0]).toEqual({ raw: '00:00:00 Introduction', title: 'Introduction', startTime: 0 });
    expect(lines[1]).toEqual({
      raw: '00:05:30 Chapter One',
      title: 'Chapter One',
      startTime: 330,
    });
    expect(lines[2].startTime).toBeNull();
    expect(lines[2].title).toBe('not a time');
  });

  it('keeps spaces inside a name and tolerates a bare timestamp line', () => {
    const lines = parseChapterLines('01:00:00 The Long  Chapter  Name');

    expect(lines[0].title).toBe('The Long  Chapter  Name');
    expect(lines[0].startTime).toBe(3600);
  });
});

describe('ChaptersEditor', () => {
  let fixture: ComponentFixture<ChaptersEditor>;
  let editor: ChaptersEditor;

  const chapters = (list: BookChapter[]) => {
    fixture.componentRef.setInput('chapters', list);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChaptersEditor],
    }).compileComponents();

    fixture = TestBed.createComponent(ChaptersEditor);
    editor = fixture.componentInstance;
    chapters([
      { title: 'Intro', startTime: 0 },
      { title: 'Chapter 1', startTime: 330 },
    ]);
  });

  it('loads the book’s chapters as editable rows', () => {
    expect(editor.rows()).toEqual([
      { title: 'Intro', timeText: '00:00:00' },
      { title: 'Chapter 1', timeText: '00:05:30' },
    ]);
    expect(editor.canSave()).toBe(true);
  });

  it('lets a row be added, removed and reordered', () => {
    editor.addRow();
    expect(editor.rows().length).toBe(3);
    // Added after the last chapter rather than at zero, which would be invalid.
    expect(editor.rows()[2].timeText).toBe('00:06:30');

    editor.move(2, -1);
    expect(editor.rows()[1].timeText).toBe('00:06:30');

    editor.removeRow(1);
    expect(editor.rows().map((row) => row.title)).toEqual(['Intro', 'Chapter 1']);
  });

  it('emits the replacement list in seconds on save', () => {
    const emitted: BookChapter[][] = [];
    editor.save.subscribe((value) => emitted.push(value));

    editor.setTitle(1, '  Chapter One  ');
    editor.setTime(1, '00:10:00');
    editor.submit();

    expect(emitted).toEqual([
      [
        { title: 'Intro', startTime: 0 },
        { title: 'Chapter One', startTime: 600 },
      ],
    ]);
  });

  it('blocks a save while a row is invalid, and says which row', () => {
    editor.setTime(1, 'later');

    expect(editor.canSave()).toBe(false);
    expect(editor.errors()[1]).toBe('Invalid timestamp');

    // A chapter that does not advance past the previous one is invalid too — the
    // player walks the list in order to find the current chapter.
    editor.setTime(1, '00:00:00');
    expect(editor.errors()[1]).toBe('Must start after the previous chapter');

    editor.setTitle(0, '');
    expect(editor.errors()[0]).toBe('Needs a name');
  });

  it('replaces the rows from a pasted list and marks the lines it could not read', () => {
    editor.bulkText.set('00:00:00 Intro\n00:07:00 Part Two\nnonsense line');
    editor.applyBulkPaste();

    expect(editor.rows()[0]).toEqual({ title: 'Intro', timeText: '00:00:00' });
    expect(editor.rows()[1]).toEqual({ title: 'Part Two', timeText: '00:07:00' });
    expect(editor.errors()[2]).toBe('Invalid timestamp');
    expect(editor.canSave()).toBe(false);
  });

  it('clears the list by emitting an empty replacement', () => {
    const emitted: BookChapter[][] = [];
    editor.save.subscribe((value) => emitted.push(value));

    editor.clear();

    expect(emitted).toEqual([[]]);
  });

  it('does not clobber an edit when the parent re-renders with the same list', () => {
    const same = [
      { title: 'Intro', startTime: 0 },
      { title: 'Chapter 1', startTime: 330 },
    ];
    fixture.componentRef.setInput('chapters', same);
    fixture.detectChanges();
    editor.setTitle(0, 'Renamed by hand');

    chapters(same);

    expect(editor.rows()[0].title).toBe('Renamed by hand');
  });
});
