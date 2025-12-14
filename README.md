## 🗺️ Roadmap & Status Update

### ✅ Performance & Infrastructure (Completed)

- **Backend Optimization:**
  - [x] **Pagination:** Implemented `page`/`pageSize` on `GET /api/books`.
  - [x] **Streaming:** EPUBs now stream via Range Requests (no more RAM crashes).
  - [x] **Database:** Switched to `EF.Functions.Like()` for fast, indexed search.
  - [x] **Batching:** `ProcessConcepts` now batches DB operations in a single transaction.
  - [x] **Background Workers:** Moved orphaned concept cleanup to `ConceptCleanupWorker`.
- **Code Hygiene:**
  - [x] **Strict Typing:** Refactored `BookLookupService` to use C# Records (no more `JsonNode`).
  - [x] **Frontend Memory:** Applied `takeUntilDestroyed` and `OnPush` strategy.
  - [x] **No Magic Strings:** Introduced `BookFilter` and `BookSort` enums.

---

### 📱 Mobile & Responsive UI

- [x] **Restyle app-dock on mobile:** Removed gradient effect and tuned transparency.
- [ ] **Fix "stuck hover" buttons:** Global buttons in `styles.css` need `@media (hover: hover)` wrappers to prevent double-tap issues on iOS/Android.
- [ ] **Fix PDF note highlighting:** Mobile text selection events need handling in `pdf-reader.ts`.
- [ ] **Fix PDF pagination reset:** Prevent position reset to top-left on orientation change/resize.
- [ ] **Refactor CSS:** Break down the monolithic `styles.css` into modular partials or component-specific styles.

### ✍️ Writing Studio

- [ ] **Reference Generation:** Implement logic in `writing-studio.ts` to suggest links/citations.
- [ ] **Fix Shadow Growth:** Ensure the container shadow scales with the editor content in `writing-studio.css`.

### 📖 Reader Improvements

- [ ] **Add Bookmarks:** Add data model and UI for bookmarks in `pdf-reader.ts`, `epub-reader.ts`, and `audio-reader.ts`.
- [x] **Fix PDF Sidebar:** Sidebar customization sections added to `pdf-reader.css`.
- [ ] **Audio Reader ToC:** Populate the `chapters` signal in `audio-reader.ts` using the file metadata.

### 📚 Book Management & Components

- [ ] **Dropdown Styling:** Create a custom dropdown component for `add-book-modal`.
- [ ] **Collection Picker:** Implement a nested folder selector (Recursive Tree View).
- [ ] **Improve Metadata Fetch:**
  - [x] **ISBN Fetch:** Significantly improved robustness and merging logic in `BookLookupService.cs` (Strict Types + Regex).
  - [ ] **ASIN Fetch:** Logic is currently set to `null`; needs a provider (e.g., OpenLibrary or a scraping fallback).
- [ ] **Upload Feedback:**
  - [x] **Add Modal:** Implemented in `AddBookModal`.
  - [ ] **Book Details:** `BookDetail` currently only handles `HttpEventType.Response`. Need to handle `HttpEventType.UploadProgress` for the progress bar.
