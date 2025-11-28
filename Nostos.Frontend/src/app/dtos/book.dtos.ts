// src/app/dtos/book.dtos.ts (or wherever these DTOs live)

/**
 * The full Book object returned from the API.
 * This should remain mostly unchanged, as it defines the complete shape of a Book.
 */
export interface Book {
  id: string;
  title: string;
  author: string | null;
  isbn: string | null;
  publisher: string | null;
  publicationDate: string | null;
  pageCount: number | null;
  description: string | null;
  createdAt: string;
  hasFile: boolean;
  fileName: string | null;
  coverUrl: string | null;
  collectionId: string | null;
}

// -------------------------------------------------------------

/**
 * Used for creating a new Book.
 * Must now include all non-file/non-generated fields.
 */
export interface CreateBookDto {
  title: string;
  author: string | null;
  collectionId: string | null;
  isbn: string | null;
  publisher: string | null;
  publicationDate: string | null;
  pageCount: number | null;
  description: string | null;
}

// -------------------------------------------------------------

/**
 * Used for updating an existing Book.
 * Must include all updatable metadata fields.
 */
export interface UpdateBookDto {
  title: string;
  author: string | null;
  collectionId: string | null;
  isbn: string | null;
  publisher: string | null;
  publicationDate: string | null;
  pageCount: number | null;
  description: string | null;
}
