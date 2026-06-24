# Planning prompt — Issue #18: Current chapter indicator in audiobook TOC

## Issue

GH issue #18: the audiobook TOC shows the chapter list, but the user has no visual indication of which chapter is currently playing. Need a "current chapter" highlight that follows playback.

## Repository

Christian-Gennari/Nostos-Rebirth (Angular 20). Working dir: `/home/dev/coding/projects/nostos-rebirth` on `main`.

## Goal of this planning step

Produce a concrete implementation plan that:

- Defines the visual treatment of the current chapter (background, left bar, bold text, icon, etc.).
- Defines the rule for "current chapter" — strictly the chapter containing `currentTime`, or a one-chapter look-ahead tolerance?
- Defines auto-scroll behavior: should the TOC scroll the current chapter into view on play / on chapter change / on manual open?
- Identifies files to change.
- Estimates effort and risks.

## Constraints

- No backend changes.
- Reuse the existing chapter list component; do not fork a parallel one.
- Keep accessibility: visible focus, ARIA `aria-current="true"`.
- Performance: do not re-evaluate the current chapter on every animation frame; use signals/effects with a sensible update cadence (e.g. per `timeupdate` event, not per frame).
- Must work on mobile bottom-sheet style TOC as well as desktop sidebar TOC.

## Required plan sections

1. **Visual spec** — describe the current-chapter style concretely; include CSS variable names if a new one is added.
2. **Rule for "current"** — exact algorithm.
3. **Auto-scroll behavior** — when to scroll, what easing, how to keep the user's manual scroll position.
4. **Component structure** — modify in place or extract a helper.
5. **State plumbing** — signal that exposes `currentChapterId`, where it is set, where consumed.
6. **Files to create / modify** — bullet list.
7. **A11y** — `aria-current`, focus, screen reader.
8. **Performance** — update cadence, no change-detection thrash.
9. **Test plan** — manual checklist with sample audiobook; one unit test for the algorithm.
10. **Risks + edge cases** — chapters.json missing, malformed startTime, no chapters, seek before first chapter start, after last chapter.
11. **Effort estimate** — hours and confidence.
12. **PR strategy** — branch name, commit breakdown.

## Output format

Markdown, under ~400 lines, bullet-heavy. Save the plan to `plans/day4-5-quick-wins/issue-18-current-chapter-toc.md`.
