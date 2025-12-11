## 🗺️ Roadmap & In-Progress

### 📱 Mobile & Responsive UI
- [x] **Restyle app-dock on mobile:** Removed gradient effect and tuned transparency (verified in `app-dock.ts` media queries).
- [ ] Fix all "stuck hover" buttons on mobile (Partially addressed in Dock, but global buttons in `styles.css` still need `@media (hover: hover)` wrappers).
- [ ] Fix highlighting note on PDF for mobile
- [ ] Fix PDF pagination position reset (center or preserve state instead of top-left)
- [ ] Refactor CSS into modular partials (Global `styles.css` is still monolithic).

### ✍️ Writing Studio
- [ ] Start implementing reference generation (No reference logic found in `writing-studio.ts`).
- [ ] Fix shadow not following editor growth in writing studio

### 📖 Reader Improvements
- [ ] Add bookmark feature to readers (Not present in `pdf-reader.ts` or `audio-reader.ts`).
- [x] **Fix PDF sidebar animation/styling:** Added "Sidebar Customization" sections in `pdf-reader.css` to match TOC styling.
- [ ] Implement ToC in Audio Reader (Signal exists but is not populated from metadata in `audio-reader.ts`).

### 📚 Book Management & Components
- [ ] Update dropdown in book modal (create custom component for styling)
- [ ] Create custom collections picker (allow nested folder selection)
- [ ] Improve ISBN fetch and add ASIN fetch
    - *Status:* ISBN fetch is improved (merges OpenLibrary & Google Books in `BookLookupService.cs`), but ASIN fetch is still set to `null`.
- [ ] Add upload feedback in book details
    - *Status:* Implemented in `AddBookModal` (via `uploadProgress` signal), but **missing** in `BookDetail` (which only handles `Response` events).
