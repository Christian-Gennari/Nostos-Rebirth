# Nostos — Architecture Overview

## System Overview

Nostos is a self-hosted personal library and knowledge management platform. It combines an **ebook/audiobook reader**, a **note-taking system with wiki-style concept linking**, a **writing studio**, and a **collection management system** — all in a single deployable application.

```
┌─────────────────────────────────────┐
│         Angular 21 Frontend         │
│  (SPA served from wwwroot/)         │
├─────────────────────────────────────┤
│         ASP.NET Core 10 API         │
│  (Minimal API endpoints)            │
├─────────────────────────────────────┤
│         SQLite Database             │
│  (nostos.db via EF Core)            │
├─────────────────────────────────────┤
│         Local File Storage          │
│  (Storage/books/{guid}/)            │
└─────────────────────────────────────┘
```

## Project Structure

```
Nostos.sln
├── Nostos.Backend/          # ASP.NET Core 10 Web API
│   ├── Data/                # EF Core DbContext, Models, Repositories
│   ├── Endpoints/           # Minimal API endpoint groups
│   ├── Services/            # Business logic services
│   ├── Mapping/             # DTO ↔ Model mapping extensions
│   ├── Workers/             # Background services
│   ├── Migrations/          # EF Core migrations
│   ├── Storage/books/       # File storage root (book files, covers)
│   └── wwwroot/             # Built Angular app (production)
│
├── Nostos.Frontend/         # Angular 21 SPA
│   └── src/app/
│       ├── core/            # Services, DTOs, directives, strategies
│       ├── ui/              # Shared/reusable UI components
│       ├── layout/          # Shell layout (dock, workspace wrapper)
│       ├── library/         # Library view + sidebar collections
│       ├── book-detail/     # Book detail page + store
│       ├── reader/          # Multi-format reader (epub, pdf, audio)
│       ├── second-brain/    # Concept explorer
│       ├── writing-studio/  # Markdown writing environment
│       ├── add-book-modal/  # Book create/edit modal
│       └── home/            # Landing page
│
└── Nostos.Shared/           # Shared DTOs & Enums (.NET class library)
    ├── Dtos/                # Record types shared between backend layers
    └── Enums/               # BookFilter, BookSort enums
```

## Technology Stack

| Layer | Technology | Version |
|---|---|---|
| **Frontend Framework** | Angular | 21 |
| **UI Icons** | Lucide Angular | 0.555+ |
| **Epub Reader** | epub.js | 0.3.93 |
| **PDF Reader** | ngx-extended-pdf-viewer | 25.6+ |
| **Audio Player** | Howler.js | 2.2.4 |
| **Text Editor** | TinyMCE | 8.2+ |
| **Markdown** | marked + Turndown | 17.0 / 7.2 |
| **Drag & Drop** | @angular/cdk | 21+ |
| **Backend Framework** | ASP.NET Core | 10.0 |
| **ORM** | Entity Framework Core | 10.0 |
| **Database** | SQLite | — |
| **Audio Metadata** | ATL.NET (z440.atl.core) | 7.9 |
| **Target Runtime** | .NET 10 | — |

## Key Architectural Decisions

### 1. Single-Binary Deployment
The Angular frontend is built and copied into the backend's `wwwroot/` directory at release time. The ASP.NET Core app serves both the API (`/api/*`, `/opds/*`) and the SPA (via `UseStaticFiles` + `MapFallbackToFile`).

### 2. Standalone Components (Angular)
The entire frontend uses Angular's standalone component model — no `NgModule` declarations anywhere. Components declare their own imports.

### 3. Signal-Based State Management
Angular Signals are used throughout instead of external state libraries (NgRx, Akita, etc.). Services expose reactive `signal()` properties and components use `computed()` for derived state.

### 4. Custom Route Reuse Strategy
A custom `RouteReuseStrategy` (see `AppRouteReuseStrategy`) preserves component state for routes tagged with `data: { shouldReuse: true }`. This avoids re-fetching data and losing scroll/filter state when navigating between Library, Second Brain, and Studio.

### 5. Repository Pattern (Backend)
All database access goes through interface-based repositories (`IBookRepository`, etc.), registered as scoped services. This separates data access from endpoint logic.

### 6. Minimal API Endpoints
The backend uses ASP.NET Core Minimal API pattern with extension method groups (`MapBooksEndpoints()`, etc.) rather than controllers.

### 7. File-Per-Book Storage
Book files and covers are stored in `Storage/books/{bookId}/` directories on-disk, not in the database. The database stores only metadata and file name references.

### 8. Wiki-Link Concept System
Notes use `[[Concept Name]]` syntax. The `NoteProcessorService` parses these on save, auto-creates concepts if new, and maintains a many-to-many `NoteConcepts` join table. A background worker (`ConceptCleanupWorker`) periodically removes orphaned concepts.

## Data Flow

```
User Action → Angular Component
  → Service (HttpClient)
    → /api/* endpoint
      → Repository (EF Core)
        → SQLite DB
      ← Model
    ← DTO
  ← Signal Update
← Reactive UI Update
```

## Communication

- **Frontend ↔ Backend:** REST over HTTP (JSON)
- **Dev Proxy:** Angular dev server proxies `/api` and `/opds` to `http://localhost:5214`
- **Production:** Backend serves frontend directly from `wwwroot/`
