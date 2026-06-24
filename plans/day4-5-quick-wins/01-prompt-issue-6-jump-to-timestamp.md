# Planning prompt — Issue #6: Jump to timestamp (audiobook)

## Issue

GH issue #6: in the audiobook player, the user can scrub the progress bar, but cannot jump directly to a specific chapter timestamp by typing or clicking a time. Need a way to enter or pick a precise time and seek the player to it.

## Repository

Christian-Gennari/Nostos-Rebirth (Angular 20 + .NET 10 backend, Nostos.Frontend, Nostos.Backend). Working dir: `/home/dev/coding/projects/nostos-rebirth` on `main`.

## Goal of this planning step

Produce a concrete implementation plan that:

- Defines UX for jumping to a timestamp (where the input lives, how it is triggered, validation).
- Lists all frontend and backend files to change.
- Identifies any required backend changes (DTOs, endpoints).
- Estimates effort and risks.
- Suggests a clean PR strategy (one branch, one PR, small commits).
- Stays consistent with the existing `audio-reader.component.{ts,html,css}` style.

## Constraints

- Do not change the data model (no new columns) — timestamp input derives from chapter list or current `LastLocation`.
- Reuse existing `LastLocation` semantics if possible; otherwise document the storage choice.
- Do not introduce a heavy new dependency (no date-fns if avoidable, no moment.js).
- Stay inside the existing audio-reader component, or extract a small sub-component if it clearly improves readability.
- Provide a11y (keyboard reachable, focus visible, screen reader announces the time).
- Mobile first — touch target ≥44px.

## Required plan sections

1. **UX spec** — where the jump control lives (next to the progress bar? long-press on chapter list? dedicated "Go to time…" menu?), behavior, validation rules (negative, > duration, malformed input).
2. **Component structure** — new component or in-place; if new, give proposed selector, file paths, and inputs/outputs.
3. **State + service integration** — which signals/services own playback time today, and how the jump will read/write them.
4. **Backend changes** — only if needed; otherwise explicitly say "no backend changes".
5. **Files to create / modify** — bullet list with one-line reason per file.
6. **A11y plan** — keyboard, ARIA, focus management.
7. **Test plan** — unit tests for the input parser, manual test checklist for UX.
8. **Risks + edge cases** — e.g. user input "99:99:99", seek during buffering, off-by-one when chapter list is empty.
9. **Effort estimate** — rough hours for implement + test, with confidence (low/med/high).
10. **PR strategy** — branch name, commit breakdown, screenshot/gif suggestion.

## Output format

Write the plan in Markdown. Keep it under ~500 lines. Use headings and bullets, not prose paragraphs. Do not write code; describe the changes precisely enough that another agent can implement them from the plan. Save the plan to `plans/day4-5-quick-wins/issue-6-jump-to-timestamp.md`.
