# Nostos Rebirth

**Nostos Rebirth** is a modern, self-hosted Personal Knowledge Management (PKM) system and digital library. It seamlessly bridges the gap between consumption and creation by integrating a multi-format media library (E-books, Audiobooks, PDFs) with a "Second Brain" for concept mapping and a dedicated Writing Studio.

It is designed for users who want to own their data, linking the books they read directly to the thoughts and concepts they develop.

<div align="center">
<img src="[https://github.com/user-attachments/assets/c267e5c2-b913-4280-9468-2caef8f23540](https://github.com/user-attachments/assets/c267e5c2-b913-4280-9468-2caef8f23540)" alt="main-library-view" width="100%">
<em>The Main Library Dashboard</em>
</div>

---

## 🚀 Key Features

### 📚 Universal Library

Manage your entire collection in one place. Nostos supports distinct metadata and handling for:

* **Physical Books:** Track your shelf, ISBN lookup, and reading status.
* **E-Books (EPUB):** Built-in streaming reader with range request support for large files.
* **PDFs:** Integrated viewer with virtualization.
* **Audiobooks:** Web-based audio player with chapter support and metadata extraction.

<details>
<summary>📸 <strong>View Library & Management Screenshots</strong></summary>





<table>
<tr>
<td width="50%">
<strong>Book Details</strong>




<img src="[https://github.com/user-attachments/assets/b079cc61-dc4b-4557-9548-7798d241cd6e](https://github.com/user-attachments/assets/b079cc61-dc4b-4557-9548-7798d241cd6e)" alt="book-details">
</td>
<td width="50%">
<strong>Add Book Modal</strong>




<img src="[https://github.com/user-attachments/assets/720d543d-9ba9-403c-998c-248f4be814a5](https://github.com/user-attachments/assets/720d543d-9ba9-403c-998c-248f4be814a5)" alt="add-book-modal">
</td>
</tr>
</table>
</details>

### 🧠 Second Brain & Note Taking

Move beyond simple bookmarks.

* **Contextual Notes:** Highlight text in EPUBs or PDFs and attach notes directly to that specific location (using CFI ranges).
* **Concept Mapping:** Create and link abstract "Concepts" to build a knowledge graph.
* **Deep Search:** Database-backed indexed search using `EF.Functions.Like` for performance.

<img src="[https://github.com/user-attachments/assets/b38814ac-78ff-4ac9-bd0e-dd804dee433a](https://github.com/user-attachments/assets/b38814ac-78ff-4ac9-bd0e-dd804dee433a)" alt="second-brain" width="100%">

### ✍️ Writing Studio

A distraction-free environment to synthesize your reading into new content.

* **Integrated Editor:** Write using a rich text/markdown editor.
* **Reference System:** (Planned) Pull in citations and links from your library automatically.

<img src="[https://github.com/user-attachments/assets/401e0738-78d7-43c0-ab50-916f2421d60f](https://github.com/user-attachments/assets/401e0738-78d7-43c0-ab50-916f2421d60f)" alt="writing-studio" width="100%">

### ⚡ High-Performance Architecture

* **Streaming Content:** optimized for large media files; no memory crashes on large EPUBs.
* **Background Processing:** Dedicated workers for cleanup and heavy lifting (e.g., `ConceptCleanupWorker`).
* **Responsive UI:** Mobile-ready design with specialized touch handling.

---

## 🛠️ Tech Stack

### Backend

* **Framework:** .NET 10 (Preview) / ASP.NET Core
* **Database:** SQLite (via Entity Framework Core 10)
* **API:** Minimal APIs with OpenAPI/Swagger integration
* **Audio Processing:** `z440.atl.core` for metadata extraction
* **Architecture:**
* Repository Pattern (`IBookRepository`)
* Vertical Slice Architecture (Features organized by domain: Books, Notes, Concepts)
* Background Hosted Services



### Frontend

* **Framework:** Angular 21
* **Build Tool:** Angular CLI
* **Core Libraries:**
* `epubjs`: E-book rendering
* `ngx-extended-pdf-viewer`: PDF rendering
* `howler`: Audio playback
* `lucide-angular`: Iconography
* `tinymce` / `marked`: Content editing


* **State & Performance:**
* Signal-based reactivity
* `OnPush` change detection
* Virtual scrolling / Infinite scroll



---

## 📂 Project Structure

```text
Nostos-Rebirth/
├── Nostos.Backend/             # ASP.NET Core Web API
│   ├── Data/                 # EF Core DbContext and Models
│   ├── Features/             # Vertical slices (Endpoints + Logic)
│   ├── Services/             # Core business logic (FileStorage, Metadata)
│   └── Workers/              # Background tasks
├── Nostos.Frontend/          # Angular SPA
│   ├── src/app/
│   │   ├── library/          # Book grid and management
│   │   ├── reader/           # EPUB, PDF, and Audio players
│   │   ├── second-brain/     # Concept graph and notes
│   │   └── writing-studio/   # Content creation
├── Nostos.Shared/            # Shared DTOs and Enums (C#)
└── _brand-assets/            # Logos and design resources

```

## 🚀 Getting Started

### Prerequisites

* [.NET 10 SDK](https://dotnet.microsoft.com/download) (or latest supported preview)
* [Node.js](https://nodejs.org/) (LTS recommended)
* [Angular CLI](https://angular.io/cli)

### Backend Setup

1. Navigate to the backend directory:
```bash
cd Nostos.Backend

```


2. Apply database migrations (SQLite database will be created as `nostos.db`):
```bash
dotnet ef database update

```


3. Run the API:
```bash
dotnet run

```


*The API will typically launch on `https://localhost:7xxx` (check console output).*

### Frontend Setup

1. Navigate to the frontend directory:
```bash
cd Nostos.Frontend

```


2. Install dependencies:
```bash
npm install

```


3. Start the development server:
```bash
ng serve

```


4. Open your browser to `http://localhost:4200`.

## 🗺️ Roadmap

The project is currently in active development.

**Recently Completed:**

* ✅ **Performance:** Implemented pagination, EPUB streaming, and batched DB operations.
* ✅ **Code Hygiene:** Migration to C# Records and strict typing; Frontend memory leak fixes (`takeUntilDestroyed`).
* ✅ **Search:** Optimized SQL indexing.

**Upcoming Priorities:**

* 🚧 **Mobile Experience:** Fix PDF note highlighting and interaction on touch devices.
* 🚧 **Bookmarks:** Add robust bookmarking for all media types.
* 🚧 **Metadata:** Implement ASIN fetching for Audiobooks.
* 🚧 **Collection Picker:** Recursive tree view for better folder management.

## 📄 License

[MIT License](https://www.google.com/search?q=LICENSE)
