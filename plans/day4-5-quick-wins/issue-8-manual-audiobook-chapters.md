# Planning prompt — Issue #8: Manual audiobook chapters

## 1. UX spec
- **Entry point**: An "Edit Chapters" button (pencil icon) in the `toc-panel` header, visible only when `fileType() === 'audio'`.
- **Editor layout**: Clicking "Edit Chapters" replaces the normal TOC list with an inline editor. The panel header changes to "Edit Chapters". 
- **Content**: A list of existing chapters. Each row contains:
  - Text input for the `Title`.
  - Time input for the `StartTime` (rendered in `HH:MM:SS` or `MM:SS`).
  - A "Delete" (trash icon) button.
- **Adding chapters**: A "+ Add Chapter" button at the bottom of the list. It adds a new row initialized to the current playback time (or 0:00).
- **Save/Cancel**: A footer in the panel with "Cancel" and "Save Changes" buttons.
- **Validation messages**: Inline red text below any row with invalid data (e.g., negative time, duplicate time).

## 2. Data model decision
**Keep `ChaptersJson` in `FileInfoDetails`.**
- **Reasoning**: The application currently follows an aggregate root pattern where a `BookModel` is loaded entirely, including all metadata and file info. Chapters are inherently linked to the specific audio file. Breaking them out into a new `BookChapter` table would require unnecessary joins and complicate the EF Core queries. `ChaptersJson` provides the exact flexibility we need, and replacing the whole list is perfectly fine for a simple entity like chapters.

## 3. Endpoint design
- **Route**: `PUT /api/books/{id}/chapters`
- **Request Body**: `IEnumerable<BookChapterDto>` (array of `{ title, startTime }`).
- **Response**:
  - `200 OK`: Returns the updated list of chapters `IEnumerable<BookChapterDto>`.
  - `400 Bad Request`: If validation fails (see rules below). Includes standard `ProblemDetails` with specific errors.
  - `404 Not Found`: If the book ID does not exist.

## 4. Validation rules
- **Validations applied before saving**:
  1. `StartTime >= 0`: Chapters cannot start before the audio begins.
  2. `StartTime <= Duration` (if duration is known/parseable): Chapters cannot start after the audio ends.
  3. **No duplicate StartTimes**: Each chapter must have a unique timestamp to prevent playback UI confusion.
  4. **Strictly increasing order**: The backend will enforce or auto-sort the list so chapters are always stored in ascending order by `StartTime`.
  5. **Empty list is allowed**: Passing an empty array clears all chapters (effectively removing the TOC).

## 5. Component structure
Create a new dedicated component to keep `ReaderShell` clean.
- **Component**: `<app-audio-chapter-editor>`
- **Path**: `Nostos.Frontend/src/app/reader/audio-chapter-editor/`
- **Inputs**: 
  - `[chapters]="book().chapters"` (initial list of chapters)
  - `[currentAudioTime]="activeReader()?.currentTime()"` (useful for "add chapter at current time")
- **Outputs**: 
  - `(save)="handleSaveChapters($event)"`
  - `(cancel)="handleCancelChapters()"`

## 6. State plumbing
- Add an `isEditingChapters` signal to `ReaderShell`.
- When true, `reader-shell.component.html` shows `<app-audio-chapter-editor>` inside the `toc-panel` instead of the standard `tocTemplate`.
- On `(save)`, `ReaderShell` calls `this.booksService.updateChapters(id, newChapters).subscribe()`.
- Upon success, update the local `book` signal with the new chapters and set `isEditingChapters` to false. The `toc` computed signal will automatically react and rebuild the TOC list for the audio reader.

## 7. Files to create / modify
- `Nostos.Backend/Endpoints/BookEndpoints.cs`: Map the new `PUT /{id}/chapters` endpoint.
- `Nostos.Backend/Services/BooksService.cs`: Add `UpdateChaptersAsync(Guid id, IEnumerable<BookChapterDto> chapters)` to validate, serialize, and save.
- `Nostos.Frontend/src/app/core/services/books.service.ts`: Add `updateChapters(id: string, chapters: BookChapterDto[])` method.
- `Nostos.Frontend/src/app/reader/reader-shell.component.ts`: Add state `isEditingChapters` and save/cancel handlers.
- `Nostos.Frontend/src/app/reader/reader-shell.component.html`: Add Edit button and conditional template for the editor.
- `Nostos.Frontend/src/app/reader/audio-chapter-editor/audio-chapter-editor.component.ts` (NEW): Logic for managing the local form array of chapters.
- `Nostos.Frontend/src/app/reader/audio-chapter-editor/audio-chapter-editor.component.html` (NEW): Editor layout with inputs and actions.
- `Nostos.Frontend/src/app/reader/audio-chapter-editor/audio-chapter-editor.component.css` (NEW): Styling for the chapter list.

## 8. A11y
- Focus management: When entering edit mode, focus the first chapter's title input.
- Form inputs: Provide `aria-label` for "Chapter Title" and "Start Time" inputs since there won't be explicit `<label>` tags for each row to save vertical space.
- Action buttons: Add `aria-label="Delete chapter"` for icon-only buttons.
- The time input should allow easy keyboard navigation (tabbing between fields).

## 9. Test plan
- **Backend Tests**: Verify `UpdateChaptersAsync` updates the JSON string correctly, sorts chapters, rejects negative times, and handles empty arrays.
- **Frontend UX Checklist**:
  1. Click "Edit Chapters" -> UI switches cleanly.
  2. Modify a title, add a new chapter, click Save -> TOC updates immediately without page reload.
  3. Enter invalid text in the time input -> validation error blocks save.
  4. Delete the last remaining chapter -> saves successfully, TOC shows empty state.
  5. Playback logic correctly handles the newly saved chapters (audio timeline markers).

## 10. Risks + edge cases
- **Deleting the last chapter**: Perfectly safe. The player will just render a continuous timeline instead of segmented chapters.
- **Very long chapter lists**: The `toc-list` container currently scrolls (`overflow-y: auto`). We must ensure the editor container behaves the same.
- **Concurrent edit by another tab**: Unlikely in a personal app context. Last write wins. No special locking mechanism needed.
- **Undo**: Not implemented. Users can simply hit "Cancel" to revert their unsaved changes.

## 11. Effort estimate
- **Time**: ~3 to 4 hours.
- **Confidence**: High. The backend requires simple JSON manipulation, and the frontend relies on straightforward array/form state management.

## 12. PR strategy
- **Branch**: `feature/issue-8-audiobook-chapters`
- **Commits**:
  1. `feat(backend): add PUT endpoint for updating audiobook chapters`
  2. `feat(frontend): create audio chapter editor component`
  3. `feat(frontend): integrate chapter editor into reader shell`
