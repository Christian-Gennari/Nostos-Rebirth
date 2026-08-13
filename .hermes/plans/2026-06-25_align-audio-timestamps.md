# Audio Reader Timestamp Alignment Fix

> **Goal:** Make the current-time timestamp (left) match the total-time timestamp (right) in visual alignment — both should size to content naturally instead of the left side being a fixed-width centered box.

**Architecture:** Pure CSS change to the shared `.time-label-btn, .time-edit-input` rule in the audio reader component. Remove the fixed width and center alignment; let the left timestamp behave like the right-side `<span>` — natural content width, left-aligned text.

**Tech Stack:** Angular 20 component CSS

**Files to change:**
- `Nostos.Frontend/src/app/reader/audio-reader/audio-reader.component.css`

---

## Task 1: Align current-time timestamp with total-time timestamp

**Objective:** Make the left timestamp (button/input) size to content and left-align, matching the right-side span.

**Files:**
- Modify: `Nostos.Frontend/src/app/reader/audio-reader/audio-reader.component.css` — the `.time-label-btn, .time-edit-input` rule

**Step 1: Remove fixed width and center alignment**

In the shared rule `.time-label-btn, .time-edit-input` (line 136-147), change:

```css
.time-label-btn,
.time-edit-input {
  width: 96px;           /* REMOVE */
  min-height: 44px;
  font: inherit;
  font-variant-numeric: tabular-nums;
  padding: 0.5rem 0.25rem;
  text-align: center;    /* CHANGE to left */
  box-sizing: border-box;
  border: none;
  border-bottom: 1px solid transparent;
}
```

To:

```css
.time-label-btn,
.time-edit-input {
  min-height: 44px;
  font: inherit;
  font-variant-numeric: tabular-nums;
  padding: 0.5rem 0.25rem;
  text-align: left;
  box-sizing: border-box;
  border: none;
  border-bottom: 1px solid transparent;
}
```

**Step 2: Verify build**

```bash
cd /home/dev/coding/projects/nostos-rebirth/Nostos.Frontend && npx ng build --configuration development
```

Expected: clean build, no errors.

**Step 3: Run existing tests**

```bash
cd /home/dev/coding/projects/nostos-rebirth/Nostos.Frontend && npx ng test --watch=false
```

Expected: same pass/fail counts as before (this is a visual-only CSS change, no behavior change).

---

## Verification

The visual result after the change:

- Both timestamps now size to their content width
- Both have `font-variant-numeric: tabular-nums` for stable digit widths
- The `justify-content: space-between` on `.time-labels` still pushes them to opposite ends
- The left timestamp's text left-aligns within its natural bounding box (same as the right span's default)
- The `min-height: 44px` and padding preserve the clickable touch target for the button
