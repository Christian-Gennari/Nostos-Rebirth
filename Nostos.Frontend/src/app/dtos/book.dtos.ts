export interface Book {
  id: string;
  title: string;
  author: string | null;
  createdAt: string;
  hasFile: boolean;
  fileName: string | null;
  coverUrl: string | null;
}

export interface CreateBookDto {
  title: string;
  author: string | null;
}

export interface UpdateBookDto {
  title: string;
  author: string | null;
}
