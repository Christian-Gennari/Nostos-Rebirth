# Plan: Issue #6 - Jump to Timestamp

## 1. UX Spec
- **Location:** The current time label (e.g., `1:23`) on the left side of the progress bar will become an interactive element.
- **Behavior:** 
  - Clicking the current time label hides it and shows a text input field in its place, pre-filled with the current time format.
  - The input field automatically gains focus.
  - The user types a new time (e.g., `4:30` or `1:05:20`).
  - Pressing `Enter` or blurring the input validates the input and seeks the player.
  - Pressing `Escape` cancels the edit and reverts to the normal label.
- **Validation Rules:**
  - Accepts formats: `MM:SS`, `H:MM:SS`, `HH:MM:SS`.
  - Malformed input (e.g., letters, missing colons) or empty input aborts the jump and reverts to the normal label.
  - If the parsed time is `> duration`, the player jumps to `duration` (the end).
  - If the parsed time is `< 0`, it jumps to `0`.

## 2. Component Structure
- **In-place implementation:** Stay inside the `AudioReader` component (`audio-reader.component.ts`) to avoid unnecessary complexity, as the feature is small.
- **New State Variables (Signals):**
  - `isEditingTime = signal(false)`
  - `timeInputValue = signal('')`
- **New Methods:**
  - `startEditingTime()`: Sets `isEditingTime(true)`, populates `timeInputValue` with formatted `currentTime()`.
  - `commitTimeEdit(value: string)`: Parses the time, seeks if valid, and sets `isEditingTime(false)`.
  - `cancelTimeEdit()`: Reverts without seeking and sets `isEditingTime(false)`.
  - `parseTimeString(timeStr: string): number | null`: Pure function/method to convert `MM:SS` or `HH:MM:SS` to total seconds.

## 3. State + Service Integration
- The jump action will write to existing player state by calling the existing `goToTime(seconds)` method.
- `goToTime` already handles setting `currentTime`, calling `player.seek()`, updating the progress tracking, and syncing the `MediaSessionAPI`.
- No new services or stores needed.

## 4. Backend Changes
- **No backend changes are required.** The progress sync mechanism uses the `LastLocation` (seconds) which works automatically once the frontend `currentTime` is updated.

## 5. Files to Create / Modify
- `Nostos.Frontend/src/app/reader/audio-reader/audio-reader.component.ts`
  - Add parsing logic, state signals, and event handlers for the edit input.
- `Nostos.Frontend/src/app/reader/audio-reader/audio-reader.component.html`
  - Swap the static `<span>{{ formatTime(currentTime()) }}</span>` with a conditionally rendered button / text input toggle.
- `Nostos.Frontend/src/app/reader/audio-reader/audio-reader.component.css`
  - Add styling for the time input and the button (ensuring `min-height: 44px` and `min-width: 44px` touch targets for mobile).
- `Nostos.Frontend/src/app/reader/audio-reader/audio-reader.component.spec.ts` (if exists, or a new utils test file)
  - Add tests for time string parsing logic.

## 6. A11y Plan
- **Keyboard:** The time label will be wrapped in a `<button>` to be keyboard focusable (`tabindex="0"`).
- **ARIA:**
  - The button will have `aria-label="Current time, click to edit"`.
  - The text input will have `aria-label="Enter time to jump to, format minutes:seconds"`.
- **Focus Management:** Upon `Escape` or submitting the time, focus is programmatically returned to the time `<button>` or the progress bar so the user doesn't lose their place.

## 7. Test Plan
- **Unit Tests:** Add unit tests for the time parser utility:
  - `"1:30"` -> `90`
  - `"01:05:00"` -> `3900`
  - `"12:34"` -> `754`
  - `"invalid"` -> `null`
  - `"99:99"` -> `6039` (graceful handling of large minutes/seconds)
- **Manual Test Checklist:**
  - Click time label -> it becomes an input.
  - Type `1:00`, press Enter -> player seeks to 1:00.
  - Blur the input -> player seeks.
  - Type `invalid`, press Enter -> reverts to current time without seeking.
  - Type a time greater than the total duration -> seeks to the very end.
  - Verify touch target size on mobile viewport is at least 44x44px.
  - Screen reader reads the aria-labels correctly.

## 8. Risks + Edge Cases
- **User input `99:99:99`:** Safely parse and cap at `this.duration()`.
- **Seek during buffering:** `Howler.js` and the existing `goToTime` method already handle seeks before data is fully loaded, but we should ensure the input is only interactable if `duration() > 0`.
- **Play state interruption:** Ensure that opening the input doesn't unnecessarily pause the audio. We will let audio continue playing while typing.
- **Input collision:** If the audio is playing, `currentTime` updates every second. We must ensure the input field doesn't overwrite user typing with the ticking current time. Using a separate `timeInputValue` signal solves this.

## 9. Effort Estimate
- **Estimate:** 2-3 hours.
- **Confidence:** High. The audio player state is already robust (`goToTime` exists), so this is purely a UI and string-parsing task.

## 10. PR Strategy
- **Branch:** `feature/issue-6-jump-timestamp`
- **Commits:**
  - `feat(audio): add time parsing utility with unit tests`
  - `feat(audio): implement timestamp jump UI and state in audio-reader`
  - `style(audio): improve touch targets and a11y for timestamp input`
- **PR Description:** Include a short GIF/screenshot demonstrating clicking the time, typing a new time, and jumping. Note the mobile-first CSS adjustments and a11y considerations.
