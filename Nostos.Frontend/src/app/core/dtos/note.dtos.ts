// Nostos.Frontend/src/app/dtos/note.dtos.ts
export interface Note {
  id: string;
  bookId: string;
  content: string;
  cfiRange?: string;
  selectedText?: string;
  createdAt: string;
  bookTitle?: string;
}

export interface CreateNoteDto {
  content: string;
  cfiRange?: string;
  selectedText?: string;
}

export interface UpdateNoteDto {
  content: string;
  selectedText?: string; // <--- ADDED
}

/**
 * A note found by searching note text, or listed in the unlinked-note review
 * queue (issues #158, #256). `snippet` is the fragment around the match, so a row
 * can show why it matched without the whole note body travelling to the index.
 */
export interface NoteSearchHit {
  id: string;
  bookId: string;
  bookTitle: string | null;
  content: string;
  selectedText: string | null;
  snippet: string | null;
  conceptNames: string[];
  createdAt: string;
}

/**
 * One bounded page of the unlinked-note review queue (issue #256).
 *
 * `totalCount` is the point of the envelope: review mode walks the whole set, and
 * a bare page of 50 would otherwise read as "the unlinked notes".
 */
export interface NoteSearchPage {
  items: NoteSearchHit[];
  totalCount: number;
  offset: number;
  limit: number;
}
