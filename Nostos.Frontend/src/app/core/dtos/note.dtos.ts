// Nostos.Frontend/src/app/dtos/note.dtos.ts
export interface Note {
  id: string;
  bookId: string;
  content: string;
  cfiRange?: string;
  selectedText?: string;
  createdAt: string;
  bookTitle?: string;
  // The capture provenance the server already returns (issue #260 §2, §4) but
  // this interface omitted. Every field is optional so a note serialised before
  // the feature — or a route that does not carry provenance — still type-checks.
  rawContent?: string | null;
  processingMode?: string;
  captureSource?: string;
  sourceAnchorKind?: string;
  sourceAnchorValue?: string | null;
  anchorVerified?: boolean;
}

/**
 * What a refine does to a note's stored text (issue #262 §7). The values are the
 * backend's exact wire strings; `verbatim` is a storage operation and calls no
 * model, the other two rewrite the preserved original.
 */
export type NoteProcessingMode = 'verbatim' | 'light_polish' | 'clarify';

/**
 * The raw transcript of one note and the mode its current text reflects
 * (mirrors the backend `NoteRawTranscriptDto`).
 */
export interface NoteRawTranscript {
  id: string;
  rawContent: string | null;
  content: string;
  processingMode: string;
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
