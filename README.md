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
*Status: Pending. Currently, books open in the browser's native viewer/download. The next major step is an integrated reading experience.*
- [ ] **Create Reader Route/Module** (`/read/:id`)
- [ ] **Integrate EPUB rendering** (epub.js)
- [ ] **Integrate PDF rendering** (pdf.js or browser native embed)
- [ ] **Add text-mode reader** (For .txt files)
- [ ] **Reading progress tracking** (Save last page/scroll position)

### **Milestone 4 — Notes Enhancements (Reader Integration)**
*Status: Pending Reader Engine.*
- [ ] **Inline highlights in EPUB/PDF**
- [ ] **Create note from selected text**
- [ ] **Jump-to-note-location feature**
- [ ] **Show notes sidebar inside reader**

---

## **🔮 Future Milestones**

### **Milestone 7 — User Preferences + Settings UI**
*Personalization features for reading comfort.*
- [ ] **Backend user preferences** (Theme, Font Size, Reader Mode)
- [ ] **Frontend settings panel**
- [ ] **Persist preferences in backend**

### **Milestone 8 — General Polish (v2 Final)**
*Ongoing. Much of this is being done iteratively (e.g., Skeletons and Fonts are already in).*
- [x] **Unified typography via Inter + Lora**
- [x] **Loading skeletons**
- [ ] **Mobile layout pass** (Grid is responsive, but sidebar needs mobile menu)
- [ ] **404 and error screens**
- [ ] **Keyboard shortcuts**
- [ ] **Final accessibility pass**

### **Milestone 9 — Optional Future (Post-v2)**
- [ ] **OPDS Feed Export**
- [ ] **Reading statistics**
- [ ] **Cloud sync / Dockerization**
- [ ] **Full-text search across books**
