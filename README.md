# **🚀 Nostos GitHub Milestone Plan**

## **✅ Completed Milestones**

### **Milestone 1 — Backend File Upload System (Core Infrastructure)**
*Completed. The backend now supports file storage, cover management, and database associations.*
- [x] **Create storage folder structure** (`/Storage/books/{bookId}/`)
- [x] **Add file upload endpoint** (EPUB, PDF, TXT)
- [x] **Add file download endpoint** (Streams file to frontend)
- [x] **Add manual cover upload endpoint** (PNG/JPG support)
- [x] **Add file metadata to Book DTO** (`HasFile`, `CoverUrl`)

### **Milestone 2 — Frontend File Upload UI**
*Completed. Users can upload books and covers via the "Add Book" drawer.*
- [x] **Add “Upload Book File” field to Add Drawer**
- [x] **Integrate file upload in BooksService**
- [x] **Show upload progress** (Percentage indicator implemented)
- [x] **Display cover in Library Grid**
- [x] **Display “Uploaded” status in List View** (Format badges added)

### **Milestone 5 — Concepts System (The Second Brain)**
*Completed. The system now automatically extracts `[[WikiLinks]]` from notes and generates a graph of ideas.*
- [x] **Link concepts to notes** (Many-to-Many DB relation)
- [x] **Concepts extraction logic** (Regex parsing for `[[Concept]]` on note save)
- [x] **Second Brain Dashboard** (Searchable index of all concepts)
- [x] **Backlink view** (Viewing a concept shows all related notes and source books)

---

## **🚧 Current & Next Milestones**

### **Milestone 6 — Collections (Organization)**
*Status: Mostly Complete. Core CRUD and filtering are done.*
- [x] **Manage Collections** (Create, Rename, Delete in Sidebar)
- [x] **Assign books to collections** (Via Add/Edit Modal)
- [x] **Filter library by collection** (Clicking sidebar items filters the grid)
- [ ] **Drag-and-drop book → collection** (Pending)
- [ ] **Nested collections** (Optional/Future)

### **Milestone 3 — Basic Reader Engine**
*Status: In Progress. The Reader shell and PDF support are implemented. Backend support for progress tracking is ready.*
- [x] **Create Reader Route/Module** (`/read/:id`)
- [x] **Integrate PDF rendering** (via `ng2-pdfjs-viewer`)
- [ ] **Integrate EPUB rendering** (Placeholder component created)
- [ ] **Add text-mode reader** (For .txt files)
- [ ] **Reading progress tracking** (Backend columns `LastLocation` & `ProgressPercent` added; Frontend integration pending)

### **Milestone 4 — Notes Enhancements (Reader Integration)**
*Status: In Progress. Basic sidebar is present.*
- [x] **Show notes sidebar inside reader** (Implemented basic scratchpad using LocalStorage)
- [ ] **Inline highlights in EPUB/PDF**
- [ ] **Create note from selected text**
- [ ] **Jump-to-note-location feature**

---

## **🔮 Future Milestones**

### **Milestone 7 — User Preferences + Settings UI**
*Personalization features for reading comfort.*
- [ ] **Backend user preferences** (Theme, Font Size, Reader Mode)
- [ ] **Frontend settings panel**
- [ ] **Persist preferences in backend**

### **Milestone 8 — General Polish (v2 Final)**
*Ongoing. Recently added comprehensive metadata support and auto-fetching.*
- [x] **Unified typography via Inter + Lora**
- [x] **Loading skeletons**
- [x] **Expanded Book Metadata** (Added support for Series, Volume, Language, Publisher, ISBN, etc.)
- [x] **Automatic Metadata Fetching** (Implemented `BookLookupService` combining OpenLibrary & Google Books APIs)
- [ ] **Mobile layout pass** (Grid is responsive, but sidebar needs mobile menu)
- [ ] **404 and error screens**
- [ ] **Keyboard shortcuts**
- [ ] **Final accessibility pass**

### **Milestone 9 — Optional Future (Post-v2)**
- [ ] **OPDS Feed Export**
- [ ] **Reading statistics**
- [ ] **Cloud sync / Dockerization**
- [ ] **Full-text search across books**
