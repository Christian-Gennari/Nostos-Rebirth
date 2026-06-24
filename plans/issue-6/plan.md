# Refined Plan: Issue #6 — Jump to Timestamp

## 1. Verdict on the Draft

### What was correct

- **`goToTime(seconds: number)` exists and works exactly as described.** Signature is `goToTime(seconds: number): void` at [audio-reader.component.ts:L179-186](file:///home/dev/coding/projects/nostos-rebirth/Nostos.Frontend/src/app/reader/audio-reader/audio-reader.component.ts#L179-L186). It calls `player.seek(seconds)`, updates `currentTime`, calls `updateProgressState()`, and syncs the Media Session position. The draft correctly identified that no new service/store work is needed.
- **`formatTime()` exists** at [L259-266](file:///home/dev/coding/projects/nostos-rebirth/Nostos.Frontend/src/app/reader/audio-reader/audio-reader.component.ts#L259-L266) and produces `M:SS` or `H:MM:SS`, exactly the format the draft assumed.
- **`FormsModule` is already imported** (L3, L15), so `ngModel` / template-driven bindings are available without new imports.
- **No backend changes needed.** Progress sync uses `LastLocation` (seconds as string), and `goToTime` triggers `updateProgressState()` which feeds the `progressSubject` sampled-time pipeline. Correct.
- **The plan to keep this in-component** is sound — it's a small, self-contained UI addition.

### What was wrong or hand-waved

| Claim in draft | Reality |
|---|---|
| "Swap the static `<span>{{ formatTime(currentTime()) }}</span>`" — implies a single span for current time | **Partially correct.** The actual markup at [HTML:L29-32](file:///home/dev/coding/projects/nostos-rebirth/Nostos.Frontend/src/app/reader/audio-reader/audio-reader.component.html#L29-L32) is a `.time-labels` div containing **two** `<span>` elements (current time left, duration right) inside a `.scrubber` flex column. The left span is **not** individually classed/id'd — it's the first bare `<span>` child. The edit-in-place swap needs to replace the left span specifically, not the whole `.time-labels` row. |
| Draft says "Wrap in a `<button>`" for a11y with `tabindex="0"` | A `<button>` doesn't need `tabindex="0"` (buttons are natively focusable). The draft contradicts itself. We should use a `<button>` **without** redundant tabindex. |
| "Input will have `aria-label`" | Correct intent, but the draft didn't address the **existing `@HostListener('document:keydown.escape')`** at [L230-235](file:///home/dev/coding/projects/nostos-rebirth/Nostos.Frontend/src/app/reader/audio-reader/audio-reader.component.ts#L230-L235) which closes the rate dropdown. If the user presses Escape while editing the time, **both** the time-edit cancel and the dropdown-close handler will fire. This must be guarded. |
| Draft doesn't mention `goTo(target)` (IReader interface) | The component already has [`goTo(target: string \| number)`](file:///home/dev/coding/projects/nostos-rebirth/Nostos.Frontend/src/app/reader/audio-reader/audio-reader.component.ts#L103-L106) which delegates to `goToTime`. This is the entry point the reader-shell uses via `handleTocClick`. A "go to time" from the TOC panel already works for chapter timestamps — no new TOC integration is needed for this feature. |
| Draft mentions `spec.ts` "if exists" | **No spec files exist** anywhere under `src/app/reader/`. We'll create a new one. |
| Draft says "The progress bar" for time label location | The time labels are **below** the range slider, not on it. This is important for the CSS approach — the editable area is in a flex row with `justify-content: space-between`. |
| Draft doesn't mention `currentTime` ticking while editing | Mentioned in risks but the solution ("separate signal") needs more detail: the `startProgressTracking()` timer at [L237-243](file:///home/dev/coding/projects/nostos-rebirth/Nostos.Frontend/src/app/reader/audio-reader/audio-reader.component.ts#L237-L243) updates `currentTime` every 1s. The template must use `timeInputValue` (not `currentTime`) for the input's model binding. |
| Effort estimate "2-3 hours" | Reasonable, possibly slightly generous given no tests exist yet (test infrastructure setup may add 30min). Revised to **2-4 hours**. |

---

## 2. Refined UX Spec

### Interaction flow

1. **Default state:** Left time label shows `formatTime(currentTime())` as a visually clickable `<button>` (subtle underline-on-hover / cursor-pointer hint). Right duration label stays static.
2. **Click / Enter / Space on the time button:** The button is replaced in-place by a text `<input>`, pre-filled with the current formatted time (e.g. `5:23`). The input auto-focuses and selects all text.
3. **Typing:** User types a new time. Audio continues playing; the input is insulated from the ticking `currentTime` signal.
4. **Commit (Enter or blur):**
   - Parse the value. If valid, call `goToTime(clampedSeconds)`.
   - Switch back to the button state.
5. **Cancel (Escape):**
   - Revert to button state without seeking.
   - Return focus to the time button.
6. **Invalid input on commit:** Treat the same as cancel — revert silently (no toast, no error state). The value was clearly user-typed so a silent revert is not confusing.

### Validation

| Input | Result |
|---|---|
| `1:30` | → 90s |
| `1:05:20` | → 3920s |
| `0:00` | → 0s |
| `72:00` (> duration) | → `duration()` (clamp) |
| `-1:00`, `abc`, empty | → cancel (null) |
| `99:99` | → 6039s, then clamp to `duration()` |

### Input format

Accept `[H:]MM:SS`. Colons required. Each segment can be 1-2 digits (hours also allows 1 digit). Reject anything that doesn't match `/^\d{1,2}(?::\d{1,2}){1,2}$/` after trimming.

### Mobile

- The button touch target must be ≥ 44×44 CSS px (add padding/min-height).
- The input will use `inputmode="text"` — there's no numeric keyboard that also includes `:`.

---

## 3. Refined Component Structure

All changes stay within `AudioReader` ([audio-reader.component.ts](file:///home/dev/coding/projects/nostos-rebirth/Nostos.Frontend/src/app/reader/audio-reader/audio-reader.component.ts), [.html](file:///home/dev/coding/projects/nostos-rebirth/Nostos.Frontend/src/app/reader/audio-reader/audio-reader.component.html), [.css](file:///home/dev/coding/projects/nostos-rebirth/Nostos.Frontend/src/app/reader/audio-reader/audio-reader.component.css)).

### New signals (TS)

```typescript
isEditingTime = signal(false);
timeInputValue = signal('');
```

### New methods (TS)

```typescript
startEditingTime(): void
// Sets isEditingTime(true), populates timeInputValue with formatTime(currentTime())

commitTimeEdit(value: string): void
// Calls parseTimeString, if valid clamps to [0, duration()] and calls goToTime, 
// then sets isEditingTime(false)

cancelTimeEdit(): void
// Sets isEditingTime(false), does not seek

parseTimeString(timeStr: string): number | null
// Pure function. Returns total seconds or null.
```

### Template changes (HTML L29-32)

Replace:
```html
<div class="time-labels">
  <span>{{ formatTime(currentTime()) }}</span>
  <span>{{ formatTime(duration()) }}</span>
</div>
```

With:
```html
<div class="time-labels">
  @if (isEditingTime()) {
    <input
      #timeInput
      class="time-edit-input"
      type="text"
      inputmode="text"
      [value]="timeInputValue()"
      (keydown.enter)="commitTimeEdit(timeInput.value)"
      (keydown.escape)="cancelTimeEdit(); $event.stopPropagation()"
      (blur)="commitTimeEdit(timeInput.value)"
      aria-label="Enter time to jump to, format minutes colon seconds"
    />
  } @else {
    <button
      class="time-label-btn"
      (click)="startEditingTime()"
      aria-label="Current playback time, click to jump to a specific time"
    >
      {{ formatTime(currentTime()) }}
    </button>
  }
  <span>{{ formatTime(duration()) }}</span>
</div>
```

> **Key detail:** `(keydown.escape)` on the input calls `$event.stopPropagation()` to prevent the existing `@HostListener('document:keydown.escape')` from also firing and toggling the rate dropdown.

### Auto-focus

Use a `ViewChild` setter to focus + select-all when the input appears:

```typescript
@ViewChild('timeInput') set timeInputRef(el: ElementRef<HTMLInputElement> | undefined) {
  if (el) {
    el.nativeElement.focus();
    el.nativeElement.select();
  }
}
```

Requires adding `ViewChild, ElementRef` to imports from `@angular/core`.

---

## 4. State + Service Integration

- **Read:** `currentTime()` and `duration()` (existing signals).
- **Write:** `goToTime(seconds)` (existing method, L179).
- **No new services, no new stores, no new observables.**
- The progress sync pipeline (`progressSubject → sampleTime(2000) → updateProgress`) is triggered automatically by `goToTime` → `updateProgressState()` → `progressSubject.next()`.

---

## 5. Backend Changes

**No.** The backend receives `LastLocation` (seconds as string) and `percent` via the existing `PATCH /api/books/{id}/progress` endpoint. No new API surface required.

---

## 6. Concrete File List

| File | Action | Lines of interest |
|---|---|---|
| [audio-reader.component.ts](file:///home/dev/coding/projects/nostos-rebirth/Nostos.Frontend/src/app/reader/audio-reader/audio-reader.component.ts) | Modify | L1 (add `ViewChild, ElementRef`), after L39 (new signals), after L106 (new methods), L230-235 (guard Escape handler to check `isEditingTime`) |
| [audio-reader.component.html](file:///home/dev/coding/projects/nostos-rebirth/Nostos.Frontend/src/app/reader/audio-reader/audio-reader.component.html) | Modify | L29-32 (replace left time span with conditional button/input) |
| [audio-reader.component.css](file:///home/dev/coding/projects/nostos-rebirth/Nostos.Frontend/src/app/reader/audio-reader/audio-reader.component.css) | Modify | After L128 (add `.time-label-btn` and `.time-edit-input` styles) |
| `audio-reader.component.spec.ts` | **Create** | New file for `parseTimeString` unit tests |

---

## 7. A11y Plan

| Element | Approach |
|---|---|
| Time label button | Native `<button>` (keyboard-focusable by default). `aria-label="Current playback time, click to jump to a specific time"` |
| Time edit input | `aria-label="Enter time to jump to, format minutes colon seconds"`. Auto-focused on show. |
| Escape key | Cancels editing, returns focus to the time button (via `ViewChild` on the button, or `afterNextRender`) |
| Enter key | Commits and returns focus to time button |
| Screen reader announcements | The `@if` conditional swap will cause the new element to be announced. No need for a live region — the focus management handles it. |
| Touch targets | `.time-label-btn` gets `min-height: 44px; min-width: 44px; padding` to meet WCAG 2.5.8 target size |

### Escape key conflict resolution

The existing `@HostListener('document:keydown.escape')` at L230 closes the rate dropdown. When editing time:
- The `(keydown.escape)` on the input's `(keydown.escape)` calls `$event.stopPropagation()`, preventing the document-level handler from firing.
- No change needed to the existing `@HostListener` — propagation stop is sufficient.

---

## 8. Test Plan

### Unit tests (new file: `audio-reader.component.spec.ts`)

Extract `parseTimeString` as a static or standalone function to make it trivially testable without component setup.

```
parseTimeString("1:30")       → 90
parseTimeString("0:00")       → 0
parseTimeString("1:05:20")    → 3920
parseTimeString("12:34")      → 754
parseTimeString("0:05")       → 5
parseTimeString("99:99")      → 6039
parseTimeString("")           → null
parseTimeString("abc")        → null
parseTimeString("1:2:3:4")    → null
parseTimeString("1:")         → null
parseTimeString(":30")        → null
parseTimeString("1:30:00:00") → null
parseTimeString("  1:30  ")   → 90  (trimmed)
parseTimeString("-1:00")      → null
```

### Integration / manual test checklist

| # | Scenario | Expected |
|---|---|---|
| 1 | Click current-time label | Becomes an input, pre-filled with current time, text selected |
| 2 | Type `1:00`, press Enter | Player seeks to 1:00, input reverts to label |
| 3 | Type `1:00`, click elsewhere (blur) | Player seeks to 1:00 |
| 4 | Type `abc`, press Enter | Reverts to label, no seek |
| 5 | Press Escape while editing | Reverts to label, no seek, focus returns to button |
| 6 | Type time > duration | Seeks to end (duration) |
| 7 | Type `0:00` | Seeks to beginning |
| 8 | Audio is playing during edit | Audio keeps playing, input text doesn't get overwritten by ticking time |
| 9 | Mobile viewport (< 768px) | Touch target ≥ 44×44px, tapping works |
| 10 | Keyboard-only: Tab to time label, Enter to edit, type, Enter to commit | Full keyboard flow works |
| 11 | Press Escape while editing, with rate dropdown open | Only editing cancels; dropdown stays open |
| 12 | Screen reader: navigate to time label | Reads "Current playback time, click to jump to a specific time" |
| 13 | TOC chapter click still works | `goTo` → `goToTime` path is unaffected |
| 14 | `duration() === 0` (player not loaded) | Time button should either be disabled or clicking does nothing |

---

## 9. Risks and Edge Cases

| Risk | Mitigation |
|---|---|
| **Ticking `currentTime` overwrites input** | Input is bound to `timeInputValue` signal, not `currentTime`. Template uses `@if (isEditingTime())` to show the input, so the `{{ formatTime(currentTime()) }}` binding is not even rendered during editing. |
| **Escape fires both time-cancel and dropdown-close** | `$event.stopPropagation()` on the input's `(keydown.escape)` prevents bubble to document handler. |
| **Blur fires after Enter** | `commitTimeEdit` should be idempotent: once `isEditingTime` is set to `false`, a subsequent blur-triggered call is a no-op because the input is already gone from the DOM (the `@if` conditional removes it). Verify this — Angular should destroy the element before the blur fires, but if not, guard with `if (!this.isEditingTime()) return;` at the top of `commitTimeEdit`. |
| **Seek before player is loaded** | `goToTime` already checks `if (this.player)`. Additionally, consider disabling the time button when `duration() === 0`. |
| **`parseFloat` precision** | `parseTimeString` returns integer seconds (via `Math.floor` or integer arithmetic). No floating-point edge cases. |
| **Very large time values (overflow)** | Clamped to `duration()` before calling `goToTime`. |
| **Double-click selecting text in the button** | `user-select: none` on `.time-label-btn` in CSS. |

---

## 10. Effort Estimate

| Task | Time |
|---|---|
| `parseTimeString` function + unit tests | 30 min |
| Component TS (signals, methods, ViewChild) | 30 min |
| Template (conditional button/input) | 20 min |
| CSS (button styling, input styling, touch targets) | 20 min |
| Escape key conflict resolution | 10 min |
| Manual QA (all 14 scenarios) | 30 min |
| **Total** | **~2.5 hours** |

Confidence: **High.** All infrastructure exists (`goToTime`, `formatTime`, `FormsModule`). This is purely UI + string parsing.

---

## 11. PR Strategy

### Branch

`feature/issue-6-jump-timestamp` (already created)

### Commit breakdown

1. **`feat(audio): add parseTimeString utility with unit tests`**
   - Add `parseTimeString` as a standalone exported function (or static method)
   - Create `audio-reader.component.spec.ts` with comprehensive parser tests
   
2. **`feat(audio): implement jump-to-timestamp inline editing UI`**
   - Add `isEditingTime`, `timeInputValue` signals
   - Add `startEditingTime`, `commitTimeEdit`, `cancelTimeEdit` methods
   - Update template with conditional button/input swap
   - Add `ViewChild` auto-focus logic
   - Guard existing Escape `@HostListener` to avoid conflict

3. **`style(audio): add styles and a11y for timestamp edit input`**
   - `.time-label-btn` styles (cursor, underline hint, touch target)
   - `.time-edit-input` styles (match existing font, size, tabular-nums)
   - ARIA labels on both elements

### PR description template

```
Closes #6

**What:** Clicking the current-time label below the audio scrubber opens an
inline text input where the user can type a timestamp (e.g. `4:30` or
`1:05:20`) and press Enter to jump there.

**How:** In-component implementation using Angular signals + conditional
rendering. Reuses the existing `goToTime()` method. New `parseTimeString`
utility with full unit test coverage.

**A11y:** Keyboard-navigable (Tab → Enter → type → Enter), ARIA-labeled,
44px+ touch targets, Escape to cancel with proper focus management.

**Screenshots/GIF:** [attach demo]
```
