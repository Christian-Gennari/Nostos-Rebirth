// Define the valid types to match your backend Discriminator
export type BookType = 'physical' | 'ebook' | 'audiobook';

export interface Book {
  id: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  description: string | null;

  // NEW: Polymorphic Fields
  type: BookType;
  edition: string | null;
  asin: string | null;
  duration: string | null;

  isbn: string | null;
  publisher: string | null;
  publishedDate: string | null;
  pageCount: number | null;
  language: string | null;
  categories: string | null;
  series: string | null;
  volumeNumber: string | null;
  createdAt: string;
  hasFile: boolean;
  fileName: string | null;
  coverUrl: string | null;
  collectionId: string | null;

  lastLocation: string | null;
  progressPercent: number;

  // --- NEW METADATA FIELDS ---
  rating: number;
  isFavorite: boolean;
  finishedAt: string | null;
}

export interface CreateBookDto {
  type: BookType;
  title: string;
  subtitle: string | null;
  author: string | null;
  description: string | null;

  edition: string | null;
  asin: string | null;
  duration: string | null;

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

export interface UpdateBookDto {
  title?: string;
  subtitle?: string | null;
  author?: string | null;
  description?: string | null;

  edition?: string | null;
  asin?: string | null;
  duration?: string | null;

  isbn?: string | null;
  publisher?: string | null;
  publishedDate?: string | null;
  pageCount?: number | null;
  language?: string | null;
  categories?: string | null;
  series?: string | null;
  volumeNumber?: string | null;
  collectionId?: string | null;

  // --- NEW FIELDS FOR UPDATES ---
  rating?: number;
  isFavorite?: boolean;
  finishedAt?: string | null;
}

export interface UpdateProgressDto {
  location: string;
  percentage: number;
}
