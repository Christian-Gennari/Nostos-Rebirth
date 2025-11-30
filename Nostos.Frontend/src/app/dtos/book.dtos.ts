export interface Book {
  id: string;
  title: string;
  subtitle: string | null; // <--- NEW
  author: string | null;
  description: string | null;
  isbn: string | null;
  publisher: string | null;
  publishedDate: string | null; // API sends DateTime string
  pageCount: number | null;
  language: string | null; // <--- NEW
  categories: string | null; // <--- NEW
  series: string | null; // <--- NEW
  volumeNumber: string | null; // <--- NEW
  createdAt: string;
  hasFile: boolean;
  fileName: string | null;
  coverUrl: string | null;
  collectionId: string | null;
}

export interface CreateBookDto {
  title: string;
  subtitle: string | null;
  author: string | null;
  description: string | null;
  isbn: string | null;
  publisher: string | null;
  publishedDate: string | null; // Note: Changed to match backend DTO name
  pageCount: number | null;
  language: string | null;
  categories: string | null;
  series: string | null;
  volumeNumber: string | null;
  collectionId: string | null;
}

export interface UpdateBookDto {
  title: string;
  subtitle: string | null;
  author: string | null;
  description: string | null;
  isbn: string | null;
  publisher: string | null;
  publishedDate: string | null;
  pageCount: number | null;
  language: string | null;
  categories: string | null;
  series: string | null;
  volumeNumber: string | null;
  collectionId: string | null;
}
