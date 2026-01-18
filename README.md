# Nostos Rebirth

**Nostos Rebirth** is a modern, self-hosted Personal Knowledge Management system and digital library. It bridges consumption and creation by integrating a multi-format media library (e-books, audiobooks, PDFs) with a Second Brain for concept mapping and a dedicated Writing Studio.

It is designed for users who want full data ownership while linking what they read directly to the ideas they develop.

<div align="center">
  <img
    width="2559"
    height="1275"
    alt="main-library-view"
    src="https://github.com/user-attachments/assets/bcc8f37e-ba8a-4e34-942c-b78fbe52f12c"
  />
  <br />
  <em>The Main Library Dashboard</em>
</div>

## 🚀 Key Features

### 📚 Universal Library

Manage your entire collection in one place. Nostos supports distinct metadata and handling for:

- **Physical Books:** Track your shelf, ISBN lookup, and reading status
- **E-Books (EPUB):** Built-in streaming reader with range request support for large files
- **PDFs:** Integrated viewer with virtualization
- **Audiobooks:** Web-based audio player with chapter support and metadata extraction

<details>
  <summary>📸 <strong>View Library & Management Screenshots</strong></summary>

  <br />

  <table>
    <tr>
      <td width="50%">
        <strong>Book Details</strong><br /><br />
        <img
          width="2559"
          height="1275"
          alt="book-details"
          src="https://github.com/user-attachments/assets/ddf4735e-28fc-4153-acb8-d147a5320ef8"
        />
      </td>
      <td width="50%">
        <strong>Add Book Modal</strong><br /><br />
        <img
          width="2558"
          height="1276"
          alt="add-book-modal"
          src="https://github.com/user-attachments/assets/7ca02323-c040-47f1-b3b4-85536fffe0b5"
        />
      </td>
    </tr>
  </table>
</details>

### 🧠 Second Brain & Note Taking

Move beyond simple bookmarks.

- **Contextual Notes:** Highlight text in EPUBs or PDFs and attach notes directly to that location using CFI ranges
- **Concept Mapping:** Create and link abstract concepts to build a knowledge graph
- **Deep Search:** Database-backed indexed search using `EF.Functions.Like` for performance

<img
  width="2558"
  height="1274"
  alt="second-brain"
  src="https://github.com/user-attachments/assets/865116ef-cb82-480b-af1f-91763731cc39"
/>

### ✍️ Writing Studio

A distraction-free environment for synthesizing reading into new work.

- **Integrated Editor:** Rich text and Markdown editing
- **Reference System:** Planned support for automatic citations from the library

<img
  width="2553"
  height="1274"
  alt="writing-studio"
  src="https://github.com/user-attachments/assets/ed6659ba-80b8-4f78-a069-9b714b273066"
/>

### ⚡ High-Performance Architecture

- **Streaming Content:** Optimized for large media files
- **Background Processing:** Dedicated workers for cleanup and heavy lifting
- **Responsive UI:** Mobile-ready layout with specialized touch handling

## 🛠️ Tech Stack

### Backend

* **Framework:** .NET 10 / ASP.NET Core
* **Database:** SQLite (via Entity Framework Core 10)
* **API:** Minimal APIs with OpenAPI/Swagger integration
* **Audio Processing:** `z440.atl.core` for metadata extraction
* **Architecture:**
* Repository Pattern (`IBookRepository`)
* Vertical Slice Architecture (Features organized by domain: Books, Notes, Concepts)
* Background Hosted Services



### Frontend

- **Framework:** Angular 21
- **Build Tool:** Angular CLI
- **Core Libraries:**
  - `epubjs`
  - `ngx-extended-pdf-viewer`
  - `howler`
  - `lucide-angular`
  - `tinymce`, `marked`
- **State & Performance:**
  - Signal-based reactivity
  - `OnPush` change detection
  - Virtual and infinite scrolling

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
dotnet run
```

**Step 2: Start the Frontend**
Runs the Angular development server on port `4200`.

```bash
cd Nostos.Frontend
npm start
# OR
ng serve
```

**Access the App:**

* Go to **[http://localhost:4200](https://www.google.com/search?q=http://localhost:4200)**
* *Note: The frontend automatically proxies API requests to the backend.*

---

### 2. Production / Preview Mode (Unified)

Use this mode to test the final build or run the application as a single deployable unit. The backend will automatically install dependencies, build the Angular frontend, and serve the static files from `wwwroot`.

**Command:**

```bash
cd Nostos.Backend
dotnet run -c Release
```

**What happens:**

1. Backend triggers `npm install` and `npm run build` for the frontend.
2. Frontend build artifacts are copied to the backend's `wwwroot` folder.
3. Database migrations are automatically applied.
4. The application starts as a single unit.

**Access the App:**

* Go to **[http://localhost:5214](http://localhost:5214)**

### 🔧 Configuration Notes

* **Proxy:** In Development mode, `proxy.conf.json` handles CORS by forwarding requests from `localhost:4200/api` to `localhost:5214`.
* **Database:** The SQLite database (`nostos.db`) is automatically migrated on startup in both modes.

## 🗺️ Roadmap

**Recently Completed**

* ✅ Performance improvements for streaming and pagination
* ✅ Code hygiene and strict typing
* ✅ Optimized search indexing

**Upcoming Priorities**

* 🚧 Mobile interaction improvements
* 🚧 Cross-media bookmarking
* 🚧 Audiobook metadata enrichment
* 🚧 Recursive collection picker

---

## 📄 License

MIT License

