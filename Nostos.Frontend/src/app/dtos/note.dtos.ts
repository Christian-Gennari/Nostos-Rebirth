export interface Note {
  id: string;
  bookId: string;
  content: string;
  cfiRange?: string;
  selectedText?: string;
  createdAt: string; // <--- ADD THIS (Dates come as ISO strings from JSON)
  bookTitle?: string; // 👈 Add this
}

export interface CreateNoteDto {
  content: string;
  cfiRange?: string;
  selectedText?: string;
}

export interface UpdateNoteDto {
  content: string;
}
