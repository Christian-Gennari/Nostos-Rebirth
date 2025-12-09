// Define the valid types to match your backend Discriminator
export type BookType = 'physical' | 'ebook' | 'audiobook';

export interface Book {
  id: string;
  title: string;
  subtitle: string | null;

  // Authorship
  author: string | null;
  editor: string | null; // <--- NEW: Harvard "Edited by"
  translator: string | null;
  narrator: string | null;

  description: string | null;

  // Polymorphic Fields
  type: BookType;
  edition: string | null;
  asin: string | null;
  duration: string | null;

  isbn: string | null;
  publisher: string | null;
  placeOfPublication: string | null; // <--- NEW: Harvard "Place: Publisher"
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

  // Metadata Fields
  rating: number;
  isFavorite: boolean;
  personalReview: string | null; // <--- NEW: Your review
  finishedAt: string | null;
}

export interface CreateBookDto {
  type: BookType;
  title: string;
  subtitle: string | null;

  author: string | null;
  editor: string | null; // <--- NEW
  translator: string | null;
  narrator: string | null; // <--- ADDED (Was missing in DTO)

  description: string | null;

  edition: string | null;
  asin: string | null;
  duration: string | null;

  isbn: string | null;
  publisher: string | null;
  placeOfPublication: string | null; // <--- NEW
  publishedDate: string | null;
  pageCount: number | null;
  language: string | null;
  categories: string | null;
  series: string | null;
  volumeNumber: string | null;
  collectionId: string | null;

  // Initial Metadata
  rating?: number;
  isFavorite?: boolean;
  personalReview?: string | null; // <--- NEW
  finishedAt?: string | null;
}

export interface UpdateBookDto {
  title?: string;
  subtitle?: string | null;

  author?: string | null;
  editor?: string | null; // <--- NEW
  translator?: string | null;
  narrator?: string | null; // <--- ADDED

  description?: string | null;

  edition?: string | null;
  asin?: string | null;
  duration?: string | null;

  isbn?: string | null;
  publisher?: string | null;
  placeOfPublication?: string | null; // <--- NEW
  publishedDate?: string | null;
  pageCount?: number | null;
  language?: string | null;
  categories?: string | null;
  series?: string | null;
  volumeNumber?: string | null;
  collectionId?: string | null;

  // Update Fields
  rating?: number;
  isFavorite?: boolean;
  personalReview?: string | null; // <--- NEW
  finishedAt?: string | null;
  isFinished?: boolean;
}

export interface UpdateProgressDto {
  location: string;
  percentage: number;
}
