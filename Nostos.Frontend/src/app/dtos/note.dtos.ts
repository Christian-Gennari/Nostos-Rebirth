export interface Note {
  id: string;
  bookId: string;
  content: string;
}

export interface CreateNoteDto {
  content: string;
}

export interface UpdateNoteDto {
  content: string;
}
