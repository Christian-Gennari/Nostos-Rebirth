# Frontend — Routing & Navigation

## Route Table

| Path             | Component              | Lazy | Notes                                         |
| ---------------- | ---------------------- | ---- | --------------------------------------------- |
| `""`             | `Home`                 | No   | Landing page                                  |
| `"read/:id"`     | `ReaderShell`          | Yes  | Full-screen reader (outside workspace layout) |
| `""` (parent)    | `WorkspaceLayout`      | No   | Shell with router-outlet + dock bar           |
| `"library"`      | `Library`              | Yes  | Book grid / list                              |
| `"second-brain"` | `SecondBrain`          | Yes  | Concept explorer                              |
| `"studio"`       | `WritingStudio`        | Yes  | Writing environment                           |
| `"library/:id"`  | `BookDetail`           | Yes  | Single book detail                            |
| `"**"`           | redirect → `"library"` | —    | Catch-all wildcard                            |

**File:** `src/app/app.routes.ts`

## Workspace Layout

`WorkspaceLayout` is a wrapper shell that provides:

- `<router-outlet>` for child page views
- `<app-app-dock>` fixed bottom navigation bar

All workspace routes (`library`, `second-brain`, `studio`, `library/:id`) render inside this shell. The reader route (`read/:id`) renders **outside** the workspace layout for a distraction-free experience.

## Scroll Position Restoration

The router is configured with `scrollPositionRestoration: 'enabled'` (via `withRouterConfig()` in `app.config.ts`). Angular automatically restores the scroll position when navigating back to a previously visited page.

## Navigation History (Deep-Link Memory)

`NavigationHistoryService` tracks the last visited URL within each section prefix (`/library`, `/second-brain`, `/studio`).

The `AppDockComponent` uses this to restore context:

- Click **Library** while on Studio → navigates to `/library/some-book-id` (last viewed book) instead of always `/library`.
- Click the **same** dock item while already in that section → resets to the section root.

## Lazy Loading

All leaf routes use `loadComponent: () => import(...)` for code-splitting. Each page lands in its own chunk.
