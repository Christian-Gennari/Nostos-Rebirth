# Nostos

A self-hosted personal library and knowledge management system. Manage books, e-books, audiobooks, and PDFs in one place — then link what you read to the ideas you develop through contextual notes, concept mapping, and a built-in writing environment.

<div align="center">
  <img
    width="2559"
    height="1275"
    alt="main-library-view"
    src="https://github.com/user-attachments/assets/bcc8f37e-ba8a-4e34-942c-b78fbe52f12c"
  />
</div>

## Features

### Library

- **Physical books** — ISBN lookup, reading status, full metadata
- **E-books (EPUB)** — Streaming reader with range request support
- **PDFs** — Integrated viewer
- **Audiobooks** — Chapter-aware player with M4B/M4A/MP3 metadata extraction
- **Collections** — Nested folder hierarchy, drag-and-drop organisation
- **Search, sort & filter** — By title, rating, recency, reading status, or collection

<details>
  <summary><strong>Screenshots</strong></summary>

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

### Second Brain

- **Contextual notes** — Highlight text in EPUBs or PDFs and attach notes to the exact location
- **Wiki-link concepts** — Type `[[Concept]]` in any note to create or link a concept automatically
- **Concept explorer** — Browse all concepts sorted by usage; view every linked note in one place
- **Orphan cleanup** — Background worker removes concepts with zero references

<img
  width="2558"
  height="1274"
  alt="second-brain"
  src="https://github.com/user-attachments/assets/865116ef-cb82-480b-af1f-91763731cc39"
/>

### Writing Studio

- **Three-panel layout** — File tree, TinyMCE editor (markdown round-trip), and a context sidebar
- **Reference insertion** — Browse concepts or books in the sidebar, click a note to insert the quote
- **Auto-save** — 2-second debounced save on every keystroke

<img
  width="2553"
  height="1274"
  alt="writing-studio"
  src="https://github.com/user-attachments/assets/ed6659ba-80b8-4f78-a069-9b714b273066"
/>

## Tech Stack

| Layer          | Technology                                  |
| -------------- | ------------------------------------------- |
| Backend        | .NET 10 / ASP.NET Core Minimal APIs         |
| Database       | SQLite via Entity Framework Core 10         |
| Frontend       | Angular 21 (standalone components, Signals) |
| Readers        | epub.js, ngx-extended-pdf-viewer, Howler.js |
| Editor         | TinyMCE + marked + Turndown                 |
| Icons          | Lucide Angular                              |
| Audio metadata | z440.atl.core                               |

## Project Structure

```
Nostos-Rebirth/
├── Nostos.Backend/           # ASP.NET Core API
│   ├── Data/                 #   DbContext, models, repositories
│   ├── Endpoints/            #   Minimal API endpoint groups
│   ├── Services/             #   File storage, metadata, note processing
│   ├── Workers/              #   Background hosted services
│   └── Migrations/           #   EF Core migrations
├── Nostos.Frontend/          # Angular SPA
│   └── src/app/
│       ├── pages/            #   Library, BookDetail, SecondBrain, WritingStudio, Home
│       ├── reader/           #   EPUB, PDF, Audio readers + annotation managers
│       ├── core/             #   Services, directives, route strategy
│       ├── ui/               #   Shared components (FlatTree, NoteCard, StarRating, etc.)
│       └── layout/           #   WorkspaceLayout, AppDock
├── Nostos.Shared/            # Shared DTOs and enums (C#)
├── _docs/                    # Project documentation
└── _brand-assets/            # Logos and design resources
```

## Getting Started

### Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- [Node.js](https://nodejs.org/) (LTS)

### Development (two terminals)

```bash
# Terminal 1 — Backend (http://localhost:5214)
cd Nostos.Backend
dotnet run

# Terminal 2 — Frontend (http://localhost:4200)
cd Nostos.Frontend
npm install
npm start
```

The frontend proxies `/api` requests to the backend via `proxy.conf.json`.

### Production (single binary)

```bash
cd Nostos.Backend
dotnet run -c Release
```

This automatically runs `npm install` + `npm run build` for the frontend, copies the output to `wwwroot`, applies database migrations, and serves everything at **http://localhost:5214**.

### Configuration

| Setting      | Detail                                                       |
| ------------ | ------------------------------------------------------------ |
| Database     | SQLite (`nostos.db`), auto-migrated on startup               |
| File storage | `Storage/books/` (configurable via `FileStorageSettings`)    |
| CORS (dev)   | Handled by `proxy.conf.json` — no backend CORS config needed |

## Documentation

Detailed documentation is available in the `_docs/` directories:

| Directory                | Contents                                                                   |
| ------------------------ | -------------------------------------------------------------------------- |
| `_docs/`                 | Architecture, API reference, getting started, concept system               |
| `Nostos.Backend/_docs/`  | Data models, repositories, services, endpoints, database                   |
| `Nostos.Frontend/_docs/` | Components, services, routing, state management, reader system, UI library |

## Roadmap

- Mobile interaction improvements
- Cross-media bookmarking
- Audiobook metadata enrichment
- Recursive collection picker
- OPDS catalog support

## License

MIT
