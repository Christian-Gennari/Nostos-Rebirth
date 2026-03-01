# Frontend — Services

All HTTP services are `providedIn: 'root'` singletons using Angular `HttpClient`. The API base URL is `/api`.

---

## BooksService

**File:** `src/app/core/services/books.service.ts`

| Method | Signature | Return | Purpose |
|---|---|---|---|
| `list` | `(options: BookListOptions)` | `Observable<PaginatedResponse<Book>>` | Paginated book list with filter / sort / search / collection params |
| `get` | `(id: string)` | `Observable<Book>` | Single book by ID |
| `create` | `(dto: CreateBookDto)` | `Observable<Book>` | Create a new book |
| `update` | `(id: string, dto: UpdateBookDto)` | `Observable<Book>` | Update metadata |
| `delete` | `(id: string)` | `Observable<void>` | Delete a book |
| `updateProgress` | `(id: string, location: string, percentage: number)` | `Observable<any>` | Save reading location + percentage |
| `getLocations` | `(id: string)` | `Observable<BookLocationsDto>` | Get cached epub locations JSON |
| `saveLocations` | `(id: string, locations: string)` | `Observable<void>` | Persist epub locations for instant progress |
| `uploadFile` | `(bookId: string, file: File)` | `Observable<HttpEvent>` | Upload file (FormData, `reportProgress: true`) |
| `uploadCover` | `(bookId: string, file: File)` | `Observable<HttpEvent>` | Upload cover image |
| `deleteCover` | `(bookId: string)` | `Observable<void>` | Remove cover |
| `lookup` | `(isbn: string)` | `Observable<CreateBookDto>` | ISBN metadata lookup |

**Helper type:** `BookListOptions = { filter?, sort?, search?, page?, pageSize? }`

---

## CollectionsService

**File:** `src/app/core/services/collections.service.ts`

| Method | Signature | Return | Purpose |
|---|---|---|---|
| `list` | `()` | `Observable<Collection[]>` | All collections |
| `create` | `(dto: CreateCollectionDto)` | `Observable<Collection>` | Create collection |
| `update` | `(id: string, dto: UpdateCollectionDto)` | `Observable<Collection>` | Update collection |
| `delete` | `(id: string)` | `Observable<void>` | Delete; resets `activeCollectionId` if deleted |

**Signal state (global singletons):**
- `activeCollectionId = signal<string | null>(null)` — currently selected collection (`null` = "All Books")
- `sidebarExpanded = signal(true)` — sidebar toggle state

---

## NotesService

**File:** `src/app/core/services/notes.service.ts`

| Method | Signature | Return | Purpose |
|---|---|---|---|
| `list` | `(bookId: string)` | `Observable<Note[]>` | Notes for a book |
| `create` | `(bookId: string, dto: CreateNoteDto)` | `Observable<Note>` | Create note |
| `update` | `(id: string, dto: UpdateNoteDto)` | `Observable<Note>` | Update note |
| `delete` | `(id: string)` | `Observable<void>` | Delete note |

---

## ConceptsService

**File:** `src/app/core/services/concepts.service.ts`

| Method | Signature | Return | Purpose |
|---|---|---|---|
| `list` | `()` | `Observable<ConceptDto[]>` | All concepts with `usageCount` |
| `get` | `(id: string)` | `Observable<ConceptDetailDto>` | Concept detail with all associated notes |

**Inline DTOs:**
```ts
interface ConceptDto       { id: string; name: string; usageCount: number }
interface NoteContextDto   { noteId, content, selectedText?, cfiRange?, bookId, bookTitle }
interface ConceptDetailDto { id, name, notes: NoteContextDto[] }
```

---

## WritingsService

**File:** `src/app/core/services/writings.service.ts`

| Method | Signature | Return | Purpose |
|---|---|---|---|
| `list` | `()` | `Observable<WritingDto[]>` | Entire file tree |
| `get` | `(id: string)` | `Observable<WritingContentDto>` | Single document content |
| `create` | `(dto: CreateWritingDto)` | `Observable<WritingDto>` | Create folder or document |
| `update` | `(id: string, dto: UpdateWritingDto)` | `Observable<WritingContentDto>` | Update name / content |
| `move` | `(id: string, newParentId: string \| null)` | `Observable<WritingDto>` | Reparent (drag & drop) |
| `delete` | `(id: string)` | `Observable<void>` | Delete + children |

---

## ToastService

**File:** `src/app/core/services/toast.service.ts`

| Method | Signature | Purpose |
|---|---|---|
| `show` | `(message, type: ToastType = 'info', durationMs = 4000)` | Show auto-dismiss toast |
| `success` | `(message)` | Green toast |
| `error` | `(message)` | Red toast (5 s) |
| `info` | `(message)` | Purple toast |
| `dismiss` | `(id: number)` | Manual dismiss |

**Signal:** `toasts = signal<Toast[]>([])`  
**Types:** `ToastType = 'success' | 'error' | 'info'`

---

## NavigationHistoryService

**File:** `src/app/core/services/navigation-history.service.ts`

| Method | Signature | Purpose |
|---|---|---|
| `getLastUrl` | `(appPrefix: string)` → `string` | Returns last visited URL in a section |

Subscribes to `NavigationEnd` router events. Maintains a `Record<string, string>` mapping section prefixes (`/library`, `/second-brain`, `/studio`) to their last-visited URLs. Used by `AppDockComponent` to deep-link back into the last page within each section.

---

## ConceptAutocompleteService

**File:** `src/app/ui/concept-autocomplete-panel/concept-autocomplete.service.ts`

| Method | Signature | Purpose |
|---|---|---|
| `setConcepts` | `(list: ConceptDto[])` | Set master list |
| `update` | `(text, cursorPos)` | Parse `[[` prefix, filter suggestions |
| `moveUp` / `moveDown` | `()` | Keyboard navigation |
| `choose` | `()` → `ConceptDto \| null` | Return selected concept |
| `clear` | `()` | Reset |

**Signals:** `suggestions = signal<ConceptDto[]>([])`, `activeIndex = signal<number>(0)`

> **Note:** Declared `providedIn: 'root'` but `ConceptInputComponent` provides it at the component level, so each textarea gets independent autocomplete state.
