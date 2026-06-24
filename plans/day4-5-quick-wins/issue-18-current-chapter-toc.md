# Implementation Plan: Issue #18 (Current chapter indicator in audiobook TOC)

## 1. Visual Spec
We will style the currently playing chapter so it stands out distinctly from the rest of the list without being overwhelming.
- **CSS Class**: `.toc-item.current`
- **Background**: `var(--bg-hover)` to give it a subtle highlight.
- **Left Indicator**: `border-left: 3px solid var(--color-primary);` for a clear structural anchor.
- **Text Styling**: `font-weight: var(--fw-semibold);` and `color: var(--color-primary);`.
- **Reset**: Remove the default bottom border (`border-bottom-color: transparent;`) so the border-left stands out cleanly.
- (No additional icons needed, as the left border + primary color cleanly implies "active" state).

## 2. Rule for "Current" Chapter
- **Algorithm**: The "current chapter" is strictly the chapter containing `currentTime`.
- **No Look-ahead**: We will not use a look-ahead tolerance. A chapter becomes current the exact second the playback reaches its `startTime`.
- **Logic**: 
  - Iterate through the sorted chapter list backwards.
  - Return the first chapter where `chapter.target <= currentTime`.
  - If `currentTime` is less than the first chapter's `startTime`, no chapter is highlighted (or default to the first chapter, depending on UX preference; we'll default to the first chapter if within margin, otherwise null).

## 3. Auto-scroll Behavior
- **Trigger on Open**: When the TOC panel is toggled open, the list should immediately scroll the current chapter into view.
- **Trigger on Chapter Change**: If the TOC is already open and natural playback (or a manual seek) causes the current chapter to change, scroll the new chapter into view.
- **Easing**: Use `behavior: 'smooth'` and `block: 'nearest'` so that it doesn't jarringly jump or fight the user.
- **Preserving Manual Scroll**: If the user scrolls manually while the TOC is open, we do *not* snap back on every tick. The scrolling is only triggered when the `currentChapterTarget` value *changes*.

## 4. Component Structure
- **Modify in place**: We will reuse the existing `<ng-template #tocTemplate>` in `reader-shell.component.html` and modify it in place.
- **No parallel lists**: We keep the single `toc()` array and map over it, conditionally applying the `.current` class based on a new computed signal.

## 5. State Plumbing
- **Reader Interface (`IReader`)**: Add an optional `currentLocation?: Signal<number | string | null>` property.
- **AudioReader**: Implement `currentLocation = this.currentTime;`.
- **ReaderShell**:
  - Add a `computed` signal called `currentTocTarget` that depends on `activeReader()?.currentLocation?.()`.
  - Inside `currentTocTarget`, when `fileType() === 'audio'`, run the algorithm to find the current chapter target.
  - Add an `effect` (or equivalent `toObservable` subscription) that listens for changes to `currentTocTarget()`. When it changes, if `tocOpen()` is true, perform the DOM scroll.
  - In the template, apply `[class.current]="item.target === currentTocTarget()"`.

## 6. Files to Create / Modify
- `src/app/reader/reader.interface.ts`:
  - Add `currentLocation?: Signal<number | string | null>;` to `IReader`.
- `src/app/reader/audio-reader/audio-reader.component.ts`:
  - Add `currentLocation = this.currentTime;` to implement the interface.
- `src/app/reader/reader-shell.component.ts`:
  - Add `currentTocTarget` computed signal.
  - Add scrolling logic tied to chapter transitions.
- `src/app/reader/reader-shell.component.html`:
  - Add `[class.current]` and `[attr.aria-current]` bindings to `.toc-item`.
  - Add an `#tocItemRef` or `id` generation to easily find the element to scroll to.
- `src/app/reader/reader-shell.component.css`:
  - Add `.toc-item.current` styling.

## 7. Accessibility (A11y)
- Bind `[attr.aria-current]="item.target === currentTocTarget() ? 'true' : null"` on the TOC item.
- Ensure the `border-left` and background color meet contrast ratios.
- Focus state will naturally overlay the active styling (since we don't disable outline on focus).

## 8. Performance
- **Update Cadence**: `AudioReader` updates `currentTime` via a `setInterval` of 1000ms. This acts as a natural throttle.
- **Change Detection Thrash**: Since the signal updates at most once per second, the `computed` for `currentTocTarget` will evaluate once per second. The template binding will only update the DOM when `currentTocTarget` actually changes to a new chapter, meaning zero layout thrash.

## 9. Test Plan
- **Unit Test**: Add a test for the `currentTocTarget` algorithm (e.g., verifying it finds the correct chapter when timestamps are slightly offset, exactly matched, or before/after bounds).
- **Manual Verification**:
  1. Open an audiobook and start playback.
  2. Open the TOC and verify the playing chapter is highlighted.
  3. Seek forward into a new chapter; verify the highlight moves and the TOC scrolls smoothly.
  4. Manually scroll the TOC out of view and wait; ensure playback *within* a chapter doesn't forcefully steal scroll back.
  5. Close and reopen the TOC; verify it jumps to the currently playing chapter.

## 10. Risks & Edge Cases
- **Missing chapters**: The `computed` logic must safely handle `book.chapters === null` or empty arrays (return null).
- **Malformed `startTime`**: If `startTime` values are strings, ensure we `parseFloat` them before comparison.
- **Out-of-order chapters**: We should rely on the array order as the source of truth, or strictly sort by `startTime` before evaluating.
- **Seeking before the first chapter**: The algorithm should safely return `null` (or highlight the first chapter if we treat it as an implicit start).
- **Seeking after the last chapter**: It should correctly remain on the final chapter until the end of the file.

## 11. Effort Estimate
- **Effort**: 3-4 hours.
- **Confidence**: High. The data is already available; we just need to pipe the `currentTime` up through a signal and apply simple styling + scrolling logic.

## 12. PR Strategy
- **Branch**: `feature/issue-18-audiobook-toc-current`
- **Commits**:
  - `feat(reader): add currentLocation to IReader interface`
  - `feat(reader): expose currentLocation signal from AudioReader`
  - `feat(reader): compute current chapter target in ReaderShell`
  - `style(reader): apply current chapter highlight and a11y attributes to TOC`
  - `feat(reader): implement auto-scroll behavior for current chapter`
