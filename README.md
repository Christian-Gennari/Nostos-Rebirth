
# **🚀 Nostos GitHub Milestone Plan**

## **Milestone 1 — Backend File Upload System (Core Infrastructure)**

*The next immediate step. Enables book content, reader engines, and covers.*

### Issues

1. **Create storage folder structure**

   * `/Storage/books/{bookId}/`
   * Ensure the folder is created automatically on upload.

2. **Add file upload endpoint**

   * `POST /api/books/{id}/file`
   * Accept `multipart/form-data`
   * Restrict MIME types (epub, pdf, txt)
   * Return stored file info.

3. **Add file download endpoint**

   * `GET /api/books/{id}/file`
   * Stream file to frontend.
   * Include correct MIME type.

4. **Optional: Extract cover image**

   * For EPUB: first image in `OEBPS`
   * For PDF: render first page into PNG
   * Save as `/Storage/books/{id}/cover.png`

5. **Add file metadata to Book DTO**

   * `HasFile: bool`
   * `CoverUrl: string?`



## **Milestone 2 — Frontend File Upload UI**

*Connects Angular library to backend’s upload pipeline.*

### Issues

1. **Add “Upload Book File” field to Add Drawer**

   * Accepts EPUB, PDF, or TXT.
   * Attach file to book creation.

2. **Integrate file upload in BooksService**

   * `uploadFile(bookId, file)`

3. **Show upload progress**

   * Use `HttpRequest` + `reportProgress`.

4. **Display cover in Library Grid**

   * If no cover: elegant placeholder.

5. **Display “Uploaded” status in List View**

   * Badge: EPUB / PDF.



## **Milestone 3 — Basic Reader Engine**

*You can’t read books yet. This milestone introduces the actual reading experience.*

### Issues

1. **Create Reader Module**

   * `/reader/:id`
   * Loads file via BooksService.

2. **Add EPUB Reader**

   * Integrate epub.js
   * Paging or scrolling mode
   * Basic navigation (prev/next)

3. **Add PDF Reader**

   * Integrate pdf.js
   * Continuous scrolling display

4. **Add text-mode reader**

   * For .txt books.

5. **Add reading progress tracking**

   * Save progress percentage per book.



## **Milestone 4 — Notes Enhancements (Reader Integration)**

*Notes become useful inside the reading experience.*

### Issues

1. **Inline highlights in EPUB/PDF**
2. **Create note on selected text**
3. **Notes positioned to specific location**
4. **Jump-to-note-location feature**
5. **Show notes sidebar inside reader**



## **Milestone 5 — Concepts System**

*Concepts become a knowledge layer across notes and books.*

### Issues

1. **Link concepts to notes**

   * Extend backend and DTOs.

2. **Concepts panel**

   * Global list of concepts.

3. **Backlink view**

   * Concept → all notes referencing it.

4. **Concept extraction (optional future)**

   * Basic keyword extraction from notes.



## **Milestone 6 — Collections 2.0**

*Turn collections into a functional navigation system.*

### Issues

1. **Assign books to collections**

   * Add column to DB
   * Add endpoint
   * Show assigned collection in UI

2. **Filter library by collection**

   * Clicking on a collection filters the list.

3. **Drag-and-drop book → collection**

   * Smooth UX.

4. **Nested collections (optional)**



## **Milestone 7 — User Preferences + Settings UI**

*Personalization features for reading comfort.*

### Issues

1. **Backend user preferences**

   * Theme
   * Font size
   * Line height
   * Reader mode (scroll/paginated)

2. **Frontend settings panel**

3. **Persist preferences in backend**

4. **Apply preferences inside readers**



## **Milestone 8 — General Polish (v2 Final)**

*Final UX refinement guided by your Style Guide.*

### Issues

1. **Smooth transitions + hover states**
2. **Unified typography via Inter + Lora**
3. **Sidebar improvements**
4. **Metadata sidebar on reader**
5. **Mobile layout pass**
6. **404 and error screens**
7. **Loading skeletons**
8. **Keyboard shortcuts**
9. **App-level animations**
10. **Final accessibility pass**



## **Milestone 9 — Optional Future (Post-v2)**

*These are long-term features; not necessary for v2 completion.*

### Issues

1. **OPDS Feed Export**
2. **Reading statistics**
3. **Cloud sync**
4. **TTS via ElevenLabs**
5. **Full-text search across books**
6. **Browser extension**
7.
