# Frontend — UI Components Library

Reusable components and utilities shared across pages.

---

## FlatTreeComponent

**Selector:** `app-flat-tree`  
**Files:** `src/app/ui/flat-tree/`

A generic hierarchical tree rendered as a flat list with indent levels. Used by the library sidebar (collections) and writing studio (file tree).

### Inputs

| Input       | Type                  | Description                                                          |
| ----------- | --------------------- | -------------------------------------------------------------------- |
| `items`     | `any[]` (required)    | Flat array with `id`, `name`, `parentId` fields                      |
| `activeId`  | `string \| undefined` | Currently selected node ID                                           |
| `typeField` | `string`              | Property name to distinguish folder vs. document (default: `'type'`) |
| `editingId` | `string \| undefined` | Node currently being renamed (shows inline input)                    |

### Outputs

| Output                | Type                              | Description                      |
| --------------------- | --------------------------------- | -------------------------------- |
| `nodeSelected`        | `EventEmitter<TreeNode>`          | Node clicked                     |
| `nodeMoved`           | `EventEmitter<TreeNodeMoveEvent>` | Drag-dropped onto new parent     |
| `nodeRenamed`         | `EventEmitter<{id, name}>`        | Inline rename triggered          |
| `nodeDeleted`         | `EventEmitter<string>`            | Delete requested                 |
| `nodeRenameSaved`     | `EventEmitter<{id, name}>`        | Rename confirmed (Enter)         |
| `nodeRenameCancelled` | `EventEmitter<void>`              | Rename cancelled (Escape / blur) |

### Helper: `buildFlatTree()`

**File:** `src/app/ui/flat-tree/flat-tree.helper.ts`

Converts a flat `parentId`-based array into an ordered `FlatTreeNode[]`:

1. Groups items by `parentId` (normalizes `undefined` → `null`)
2. Sorts: folders first, then alphabetical by `name`
3. Recursively walks the tree, only emitting children of expanded folders
4. Sets `expandable = true` only for folders that actually have children
5. Returns flat array with `level` (indent depth) for CSS indentation

### Drag & Drop

Uses `@angular/cdk` `DragDropModule`. Drop targets:

- **Folder node:** Reparents the dragged item under that folder
- **Root area:** Moves item to root (`newParentId = null`)

Drag is disabled during inline rename (`editingId` matches node).

---

## NoteCardComponent

**Selector:** `app-note-card`  
**File:** `src/app/ui/note-card.component/`

Displays a single note with rich formatting. Supports inline editing, concept tags, and various display configurations.

### Inputs

| Input            | Type                      | Default | Description                      |
| ---------------- | ------------------------- | ------- | -------------------------------- |
| `note`           | `Note` (required)         | —       | Note data                        |
| `conceptMap`     | `Map<string, ConceptDto>` | `null`  | For rendering `[[Concept]]` tags |
| `showNavigation` | `boolean`                 | `true`  | Show "Go to book" link           |
| `showActions`    | `boolean`                 | `true`  | Show edit/delete buttons         |
| `showSource`     | `boolean`                 | `false` | Show book title source label     |
| `showDate`       | `boolean`                 | `true`  | Show creation date               |

### Outputs

| Output         | Payload                          | Description                   |
| -------------- | -------------------------------- | ----------------------------- |
| `update`       | `{ id, content, selectedText? }` | Note edited and saved         |
| `delete`       | `string` (note ID)               | Delete requested              |
| `conceptClick` | `ConceptDto`                     | `[[Concept]]` tag clicked     |
| `quoteClick`   | `Note`                           | "Insert quote" button clicked |
| `cardClick`    | `Note`                           | Card body clicked             |

### Features

- **Inline editing:** `startEdit()` → textarea → `saveEdit()` (Enter) / `cancelEdit()` (Escape)
- **Collapsible:** Notes > 250 chars show "Show more" / "Show less" toggle
- **Concept tags:** Content rendered via `NoteFormatPipe` — `[[Concept]]` becomes clickable colored spans
- **Selected text:** Displayed as a quote block above note content

---

## StarRatingComponent

**Selector:** `app-star-rating`  
**File:** `src/app/ui/star-rating/`

Click-to-rate stars (0–5). Clicking the same star resets to 0.

| Input      | Type      | Description             |
| ---------- | --------- | ----------------------- |
| `rating`   | `number`  | Current rating value    |
| `readonly` | `boolean` | Disable interaction     |
| `size`     | `string`  | CSS size for star icons |

| Output         | Payload  |
| -------------- | -------- |
| `ratingChange` | `number` |

---

## ConceptInputComponent

**Selector:** `app-concept-input`  
**File:** `src/app/ui/concept-input.component/`

Textarea with wiki-link autocomplete. Implements `ControlValueAccessor` for form integration.

- Provides its own `ConceptAutocompleteService` at the component level
- Typing `[[` triggers the autocomplete panel
- Selecting a concept replaces `[[partial` with `[[Concept Name]] `
- Arrow keys navigate suggestions; Enter selects; Escape dismisses

---

## ConceptAutocompletePanel

**Selector:** `concept-autocomplete-panel`  
**File:** `src/app/ui/concept-autocomplete-panel/`

Dropdown overlay rendered by `ConceptInputComponent` and `NoteCardComponent`. Reads `suggestions()` and `activeIndex()` from `ConceptAutocompleteService`.

---

## MarkdownEditorComponent

**Selector:** `app-markdown-editor`  
**File:** `src/app/ui/markdown-editor/`

WYSIWYG editor wrapping TinyMCE with markdown round-trip.

| Input            | Type                  | Description              |
| ---------------- | --------------------- | ------------------------ |
| `initialContent` | `InputSignal<string>` | Markdown content to load |

| Output          | Payload             |
| --------------- | ------------------- |
| `contentChange` | `string` (markdown) |

### Implementation

- Content is converted from markdown to HTML (`marked.parse()`) on load
- On every keystroke, HTML is converted back to markdown (`TurndownService`) and emitted
- Typography: Lora (serif) for body, Inter (sans-serif) for headings

---

## ToastContainerComponent

**Selector:** `app-toast-container`  
**File:** `src/app/ui/toast-container/`

Fixed top-right notification area. Renders `ToastService.toasts()` with slide-in animation.

Color-coded left borders:

- Green → success
- Red → error
- Purple → info

---

## Directives

### InfiniteScrollDirective

**Selector:** `[appInfiniteScroll]`  
**File:** `src/app/core/directives/infinite-scroll.directive.ts`

Attaches an `IntersectionObserver` to the host element (100px rootMargin). Emits `(scrolly)` when the element enters the viewport.

```html
<div appInfiniteScroll (scrolly)="loadMore()"></div>
```

### ConceptAutocompleteDirective

**Selector:** `[noteAutocomplete]`  
**File:** `src/app/core/directives/concept-autocomplete.directive.ts`

Applied to a `<textarea>`. Listens for `input` events and pipes text + cursor position into `ConceptAutocompleteService.update()`. Handles keyboard navigation (arrows, Enter) and emits `(insertConcept)`.

---

## Pipes

### NoteFormatPipe

**Name:** `noteFormat`  
**File:** `src/app/ui/pipes/note-format.pipe.ts`

Transforms note content by replacing `[[Concept Name]]` patterns with clickable HTML spans:

```html
{{ note.content | noteFormat: conceptMap }}
```

Lookup is case-insensitive. Unresolved concepts render as plain `[[text]]`.
