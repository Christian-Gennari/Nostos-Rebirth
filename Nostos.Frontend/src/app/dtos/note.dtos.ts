// Nostos.Frontend/src/app/dtos/note.dtos.ts
export interface Note {
  id: string;
  bookId: string;
  content: string;
  cfiRange?: string; // <--- NEW
  selectedText?: string; // <--- NEW
}

export interface CreateNoteDto {
  content: string;
  cfiRange?: string; // <--- NEW
  selectedText?: string; // <--- NEW
}

export interface UpdateNoteDto {
  content: string;
}
