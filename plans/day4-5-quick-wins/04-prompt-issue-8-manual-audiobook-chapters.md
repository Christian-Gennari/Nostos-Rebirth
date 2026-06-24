# Planning prompt — Issue #8: Manual audiobook chapters

## Issue

GH issue #8: audiobook chapters are auto-parsed from the file metadata. When parsing produces nothing usable (rare format, missing metadata), the user has no way to add chapters themselves. Need a "Add chapter" / "Edit chapters" UI that lets the user create, rename, and delete chapters for an audiobook.

## Repository

Christian-Gennari/Nostos-Rebirth (Angular 20 + .NET 10 backend). Working dir: `/home/dev/coding/projects/nostos-rebirth` on `main`.

## Goal of this planning step

Produce a concrete implementation plan that:

- Specifies the editor UI (inline in the TOC? modal? dedicated page?).
- Specifies the data model impact: edit-in-place of `ChaptersJson` in `FileInfoDetails`, or a new column.
- Specifies backend endpoint(s) and request/response shape.
- Specifies validation rules (no two chapters at the same timestamp, ordered by startTime, no chapter past duration, etc.).
- Identifies files to change.
- Estimates effort and risks.

## Constraints

- Prefer reusing `ChaptersJson` storage over adding a new column; justify the choice.
- Editor must be keyboard-friendly.
- Atomicity: a single PUT replaces the full chapter list; no PATCH-per-chapter.
- Reuse the existing chapter DTO (`BookChapterDto`).
- Empty chapter list must be valid (clear all chapters).
- Deleting the last chapter must not break playback.

## Required plan sections

1. **UX spec** — entry point, editor layout, save/cancel, validation messages.
2. **Data model decision** — keep `ChaptersJson` vs. add new table; recommend one with reason.
3. **Endpoint design** — `PUT /api/books/{id}/chapters` (recommended) request/response, status codes, error model.
4. **Validation rules** — bullet list with rationale.
5. **Component structure** — new component selector, file paths, inputs/outputs.
6. **State plumbing** — how the editor is opened, where the saved list propagates.
7. **Files to create / modify** — bullet list with one-line reason per file.
8. **A11y** — focus trap in modal, ARIA roles.
9. **Test plan** — backend endpoint tests (happy + each validation rule), manual UX checklist.
10. **Risks + edge cases** — concurrent edit by another tab, very long chapter list, undo (decide yes/no).
11. **Effort estimate** — hours and confidence.
12. **PR strategy** — branch name, commit breakdown.

## Output format

Markdown, under ~500 lines, bullet-heavy. Save the plan to `plans/day4-5-quick-wins/issue-8-manual-audiobook-chapters.md`.
