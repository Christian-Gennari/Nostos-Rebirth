# Plan: Reset progress (audiobook + book) - Issue #9

## 1. UX spec
- **Entry point:** "Reset Progress" button in the `book-detail.component.html` under the `user-metadata-row` (next to the "Mark as Read"/favorite buttons). We will use a standard icon button with the `RotateCcwIcon` to match existing UI language.
- **Confirm dialog copy:** "Are you sure you want to reset your reading progress? This will clear your current location, percentage, and finished date. Notes and highlights will not be affected."
- **Success state:** Progress percent drops to 0%, the "Mark as Read" icon becomes unchecked, and a toast notification ("Progress reset") appears.

## 2. Fields affected
| Field Name | Before | After | Reason |
| :--- | :--- | :--- | :--- |
| `LastLocation` | e.g. "epubcfi(...)" | `null` | Zeroes out the saved position so the reader starts from the beginning. |
| `ProgressPercent` | e.g. `45` | `0` | Visually resets progress bar/values. |
| `FinishedAt` | e.g. `2024-05-01T...` | `null` | Crucial for "accidentally marked as read" use-cases to clear the read state. |
| `LastReadAt` | e.g. `2024-05-10T...` | `null` | Removes the book from "Continue Reading" / "Recently Read" lists until the user actively starts again. |

*Note: `LocationsJson` (Epub.js cache) is preserved as it is structural to the book file, not tied to user progress. Ratings, favorites, and notes are completely untouched.*

## 3. Endpoint design
We will create a new dedicated endpoint to keep the reset operation atomic and distinct from a standard progress update.
- **Route:** `POST /api/books/{id}/progress/reset`
- **Request body:** None
- **Response:**
  - `200 OK` with `{ reset: true }`
  - `404 Not Found` if the book ID does not exist
- **Behavior:** Fetches the book, explicitly sets the 4 fields above to null/0, calls `repo.UpdateAsync(book)`, and returns.

## 4. Component structure
- **Component:** `BookDetailComponent` owns the trigger UI.
- **Store:** `BookDetailStore` will expose a new `resetProgress()` action.
  - Optimistic update: Sets `progressPercent` to 0, `lastLocation` to `null`, `finishedAt` to `null`, and `lastReadAt` to `null` in the local signal state.
  - API call: Calls the `resetProgress` method on `BooksService`.
  - Revert: On error, reloads the book state from the server and shows a toast error.
- **Service:** `BooksService` will have a new `resetProgress(id: string): Observable<any>` method hitting the new endpoint.

## 5. Files to create / modify
- `Nostos.Backend/Endpoints/BooksEndpoints.cs`
  - Add `group.MapPost("/{id}/progress/reset", ...)` endpoint.
- `Nostos.Frontend/src/app/core/services/books.service.ts`
  - Add `resetProgress(id: string)` method.
- `Nostos.Frontend/src/app/book-detail/book-detail.store.ts`
  - Add `resetProgress()` action handling the optimistic UI update, API call, and error reverting.
- `Nostos.Frontend/src/app/book-detail/book-detail.component.ts`
  - Add `RotateCcwIcon` to lucide imports and expose it to the template.
  - Add `resetProgress()` wrapper that calls `store.resetProgress()`.
- `Nostos.Frontend/src/app/book-detail/book-detail.component.html`
  - Add the reset progress button in the `user-metadata-row` next to the `CheckCircleIcon` (finish toggle).

## 6. Confirmation + safety
- **Confirm Dialog:** Yes. Using the standard native `window.confirm()` pattern already established in the app (`if (!confirm('...')) return;`).
- **Focus:** No special focus management required for native `window.confirm()`.
- **Undo?** No. Building an undo stack for a simple DB update is overkill. The explicit, descriptive confirm dialog provides sufficient safety.

## 7. i18n / copy
- **Confirm Prompt:** `"Are you sure you want to reset your reading progress? This will clear your current location and finished date. Notes will not be affected."`
- **Button tooltip/title:** `"Reset Progress"`
- **Success Toast:** `"Progress reset"`
- **Error Toast:** `"Failed to reset progress"`

## 8. Test plan
- **Backend Test:** Verify `POST /api/books/{id}/progress/reset` clears the 4 specified fields and returns a `200 OK`. Verify it returns `404` for invalid IDs.
- **Manual Checklist:**
  1. Open a book with > 0% progress and a saved location.
  2. Click "Reset Progress", click "Cancel" -> Verify nothing happens.
  3. Click "Reset Progress", click "OK" -> Verify progress goes to 0% immediately (optimistic UI).
  4. Refresh the page -> Verify progress remains 0% (backend persisted).
  5. Open the reader -> Verify the book starts at the beginning (CFI/Page 1).
  6. Check a book that was "Finished". Reset progress -> Verify "Finished" state is removed.

## 9. Risks + edge cases
- **Race with concurrent progress update:** If the user has the reader open in another tab and it pings a progress update right after the reset, the progress might get partially restored. *Mitigation:* Acceptable edge case; users rarely reset progress while actively reading in another tab.
- **Double-click:** Native `window.confirm` blocks the main thread, naturally preventing double-click race conditions on the trigger button.
- **Network failure mid-reset:** Handled by the store. The optimistic UI update will be reverted by calling `loadBook(id, { background: true })` again, and a toast error will be displayed.

## 10. Effort estimate
- **Time:** 1-2 hours.
- **Confidence:** High. The backend update is trivial and the frontend architecture (Signals Store) makes optimistic updates straightforward.

## 11. PR strategy
- **Branch name:** `feature/issue-9-reset-progress`
- **Commit breakdown:**
  1. `feat(backend): add reset progress endpoint`
  2. `feat(frontend): add reset progress to books service and store`
  3. `feat(frontend): add reset progress button to book detail view`
