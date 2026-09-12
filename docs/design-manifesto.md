# Nostos Design Manifesto & Brand Philosophy

> "Literary publication on the surface, silent digital study in behavior."  
> The emotional goal is **homecoming**.

Nostos is a private home for reading, thinking, and writing. It is not a social app, productivity dashboard, academic reference manager, or generic knowledge-management tool.

When the user opens Nostos, the interface should feel immediately calming, familiar, quiet, and cognitively light. The user should never feel that they need to manage a complicated system before they can begin.

---

## Core Visual & Emotional Principles

### Combine
- **Typographic refinement and editorial structure** of a literary journal or high-end book publication.
- **Calm, low-chrome feeling** of a quiet digital study.
- **Modern usability and clarity**.
- **Strong focus on books as physical-looking visual objects**.
- **Generous whitespace**.
- **Restrained, timeless styling**.

### Avoid
- Generic SaaS dashboards
- Glassmorphism & heavy frosted blur gimmicks
- Neon gradients & colorful AI aesthetics
- Oversized rounded cards everywhere
- Gamification & social feeds
- Productivity metrics & excessive dashboards
- Dark-academia clichés, fake wood shelves, & parchment gimmicks
- Ornate classical decoration

The UI should feel contemporary and premium, but deeply connected to books and reading.

---

## Visual Language

### Palette
Use a warm neutral palette:
- **Warm off-white / paper background** (`#FDF8F6`)
- **Stone and soft grey** secondary surfaces
- **Dark charcoal text** (`#1C1B1A`)
- **Muted sage or deep forest green** as the primary accent (Pine `#293E32`)
- **Very restrained burgundy, clay (`#A07859`), or slate** as secondary accents

### Typography
- **Serif (*Newsreader*):** Elegant literary serif for page titles, book titles, quotations, and important headings.
- **Sans-serif (*Hanken Grotesk*):** Clean modern sans-serif for navigation, controls, metadata, and utility text.
- Strong editorial hierarchy.
- Small uppercase labels and thin rules can be used sparingly.
- Avoid oversized marketing-style typography inside the application.

### Surfaces & Geometry
- Subtle, hairline borders (`1px solid var(--border-color)`).
- Quiet, soft ambient shadows.
- Relatively small, crisp border radii (avoid bubbly pills or oversized card radii).
- The application should feel almost physical without pretending to be physical.

---

## App Structure: A House with Rooms

Think of Nostos as a house with different rooms:
- **Reading Room**
- **Library**
- **Notes / Archive**
- **Writing Studio**
- *(Later)* **Atlas** for the user's broader intellectual life

These rooms should feel clearly distinct but visually related. Navigation should be quiet and secondary to the current task—never the most visually prominent object.

---

## Screen Definitions

### Screen 1 — Reading Room / Home (Primary Screen)
The Reading Room is the default place the user enters.

**Core idea:** *Enter → resume where you left off.*

The interface focuses primarily on the books the user is currently reading:
- Understated Nostos branding.
- Calm side navigation.
- Current book as the visual centre (cover, title, author, reading progress, chapter/location).
- Primary button: *Continue Reading*.
- Secondary option: *View Thoughts*.
- Optionally one subtle recent thought related to the book.
- Optionally one very quiet line of editorial copy or quotation.
- Example active book: *The Devils* by Fyodor Dostoevsky.
- **Do not turn the page into a dashboard.** Do not fill empty space just because space is available. The screen should feel like returning to a private room where the book has been waiting for you.

### Screen 2 — Library
The Library is allowed to be more structured because this is where the user deliberately goes to browse and organize.

- Title: *Library*.
- Book search.
- Restrained filters (*All Books*, *Reading*, *To Read*, *Finished*, *Favorites*).
- Sort control.
- *Add Book* action.
- Elegant book grid (cover, title, author, subtle reading state).
- The Library should feel like an intentional private collection, not database software.
- Tasteful placeholder covers; no copyrighted commercial cover designs.

### Screen 3 — Writing Studio
The Writing Studio is a deeper workspace that feels calm and serious rather than like a conventional office productivity app.

Three-part layout:
- **Left:** Writing projects and files.
- **Centre:** Writing surface (slightly paper-like but still modern). Example essay: *On Solitude and Society*.
- **Right:** Contextual material (relevant notes, quotations, related books, related ideas). Example related books: *The Devils*, *The Soul of Man under Socialism*.
- Context should feel quietly available rather than aggressively surfaced. The user is not manually managing references; reading and notes are organically connected to the writing environment.

---

## Interaction Philosophy: Hide Sophistication

> **"Nostos should hide sophistication. Complexity appears only when the user deliberately asks for it."**

- **Reading Room:** Extremely simple.
- **Library:** Exposes organization when needed.
- **Studio:** Exposes deeper intellectual tools.
- **Modals & Dialogs:**
  - Simple by default; advanced/bibliographic depth revealed cleanly on demand.
  - Quiet, dignified confirmation dialogs rather than alarming SaaS danger alerts.
- **AI Philosophy:**
  - AI should not dominate the interface.
  - No permanent chatbot or large AI button in every view.
  - The product must work completely without AI.
  - AI assistance should feel optional, quiet, and invited.

---

## Product Continuity & Evolution

This is an evolution of an existing app, not a completely new brand. Preserve the underlying product structure and recognizable concepts:
- Library & book grid
- Book detail pages
- EPUB / PDF / audiobook reading
- Notes & Writing Studio
- Restrained book-focused UI

The goal is to make the existing product feel more coherent, literary, peaceful, and emotionally aligned with the idea of Nostos as a home.
