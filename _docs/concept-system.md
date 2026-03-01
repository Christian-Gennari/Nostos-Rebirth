# Nostos — Concept System

## Overview

Nostos implements a **Zettelkasten-inspired concept linking system** that connects notes across books using wiki-style `[[double bracket]]` syntax. This creates an emergent knowledge graph from your reading.

## How It Works

### 1. Writing Notes with Concepts

When creating or editing a note (either from the reader or the Second Brain), wrap any concept name in double brackets:

```
This passage explores [[Stoicism]] and its relationship to [[Virtue Ethics]].
The author draws on [[Marcus Aurelius]] throughout.
```

### 2. Automatic Processing

When a note is saved, the `NoteProcessorService` on the backend:

1. **Parses** the content using regex `\[\[(.*?)\]\]` to extract concept names
2. **Clears** existing concept links for that note (for re-processing on edit)
3. **Matches** found names against existing concepts (case-insensitive)
4. **Creates** new `ConceptModel` entries for any concepts that don't exist yet
5. **Links** the note to all matched/created concepts via the `NoteConcepts` join table

### 3. Exploring Concepts

The **Second Brain** page (`/second-brain`) provides a master-detail view:

- **Left pane:** All concepts sorted by usage count (most-referenced first)
- **Right pane:** All notes containing the selected concept, with book context

Concept names in notes are rendered as clickable tags (via `NoteFormatPipe`) that navigate to that concept's detail view.

### 4. Writing Studio Integration

The Writing Studio's right sidebar provides access to both:
- **Concepts tab:** Browse concepts and their linked notes
- **Books tab:** Browse books and their notes

Clicking a note in either tab inserts its highlighted text as a blockquote into the editor, enabling research-driven writing.

## Data Model

```
ConceptModel (1) ←→ (M) NoteConceptModel (M) ←→ (1) NoteModel
                                                        │
                                                        ↓
                                                    BookModel
```

| Table | Fields |
|---|---|
| `Concepts` | `Id`, `Concept` (unique, indexed) |
| `NoteConcepts` | `NoteId`, `ConceptId` (composite PK) |
| `Notes` | `Id`, `BookId`, `Content`, `CfiRange`, `SelectedText`, `CreatedAt` |

## Autocomplete

Both the Note Card inline editor and the Concept Input component support autocomplete:

1. User types `[[`
2. `ConceptAutocompleteService` activates and filters existing concepts
3. A suggestion panel appears below the cursor position
4. Arrow keys navigate, Enter selects
5. Selected concept name is inserted as `[[ConceptName]] `

## Orphan Cleanup

The `ConceptCleanupWorker` (background service) runs every **1 hour** and deletes concepts that have zero linked notes. This prevents accumulation of unused concepts from edited/deleted notes.

## Frontend Rendering

The `NoteFormatPipe` transforms note content for display:

```
Input:  "This relates to [[Stoicism]] and [[Ethics]]"
Output: "This relates to <span class="concept-tag" data-concept-id="...">Stoicism</span> 
         and <span class="concept-tag" data-concept-id="...">Ethics</span>"
```

These tags are styled as clickable chips and emit navigation events when clicked.
