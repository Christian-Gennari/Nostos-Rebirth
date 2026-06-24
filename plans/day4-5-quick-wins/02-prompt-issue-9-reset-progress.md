# Planning prompt — Issue #9: Reset progress (audiobook + book)

## Issue

GH issue #9: there is no way to reset reading/progress state on a book or audiobook. Users who accidentally marked a book as read, or who want to re-read, have to manually edit fields. Need a "Reset progress" action that zeroes progress fields for the current book.

## Repository

Christian-Gennari/Nostos-Rebirth (Angular 20 + .NET 10 backend). Working dir: `/home/dev/coding/projects/nostos-rebirth` on `main`.

## Goal of this planning step

Produce a concrete implementation plan that:

- Specifies the exact set of fields that "reset" zeroes and preserves.
- Specifies the user entry point (settings page, book detail menu, library row action).
- Specifies the backend endpoint/contract if any is needed (likely reuse the existing progress endpoint or add a single dedicated endpoint).
- Identifies all files to change.
- Addresses safety: confirm dialog, opt-out for finished state, audit/log of the reset.
- Estimates effort and risks.

## Constraints

- Do not delete notes, highlights, or bookmarks — only progress fields.
- Reuse the existing progress endpoint where reasonable; add a new endpoint only if it materially improves clarity or atomicity.
- Confirm dialog must be mandatory; bulk reset is out of scope for this plan.
- Preserve `LastReadAt` and `FinishedAt` history? — make an explicit decision in the plan and justify it.
- Mobile-friendly confirm dialog.

## Required plan sections

1. **UX spec** — entry point, confirm dialog copy, success state.
2. **Fields affected** — table of field names, before/after.
3. **Endpoint design** — request/response, status codes, errors.
4. **Component structure** — which component owns the action; signals/services.
5. **Files to create / modify** — bullet list with one-line reason per file.
6. **Confirmation + safety** — text, focus, undo? (decide yes/no with reason).
7. **i18n / copy** — exact strings.
8. **Test plan** — backend test (if new endpoint) + manual checklist.
9. **Risks + edge cases** — race with concurrent progress update, double-click, network failure mid-reset.
10. **Effort estimate** — hours and confidence.
11. **PR strategy** — branch name, commit breakdown.

## Output format

Markdown, under ~400 lines, bullet-heavy. Save the plan to `plans/day4-5-quick-wins/issue-9-reset-progress.md`.
