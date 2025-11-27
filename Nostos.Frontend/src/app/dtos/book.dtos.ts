export interface Book {
  id: string;
  title: string;
  author: string | null;
  createdAt: string;
  hasFile: boolean;
  fileName: string | null;
  coverUrl: string | null;
  collectionId: string | null; // <--- NEW
}

export interface CreateBookDto {
  title: string;
  author: string | null;
  collectionId: string | null; // <--- NEW
}

export interface UpdateBookDto {
  title: string;
  author: string | null;
  collectionId: string | null; // <--- NEW
}
