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
 * A note found by searching note text, or listed because it belongs to no concept
 * (issue #158). `snippet` is the fragment around the match, so a row can show why
 * it matched without the whole note body travelling to the index.
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
