# Frontend — Routing & Navigation

## Route Table

| Path             | Component              | Lazy | Reused  | Notes                                         |
| ---------------- | ---------------------- | ---- | ------- | --------------------------------------------- |
| `""`             | `Home`                 | No   | No      | Landing page                                  |
| `"read/:id"`     | `ReaderShell`          | Yes  | No      | Full-screen reader (outside workspace layout) |
| `""` (parent)    | `WorkspaceLayout`      | No   | —       | Shell with router-outlet + dock bar           |
| `"library"`      | `Library`              | Yes  | **Yes** | Book grid / list                              |
| `"second-brain"` | `SecondBrain`          | Yes  | **Yes** | Concept explorer                              |
| `"studio"`       | `WritingStudio`        | Yes  | **Yes** | Writing environment                           |
| `"library/:id"`  | `BookDetail`           | Yes  | **Yes** | Single book detail                            |
| `"**"`           | redirect → `"library"` | —    | —       | Catch-all wildcard                            |

**File:** `src/app/app.routes.ts`

## Workspace Layout

`WorkspaceLayout` is a wrapper shell that provides:

- `<router-outlet>` for child page views
- `<app-app-dock>` fixed bottom navigation bar

All workspace routes (`library`, `second-brain`, `studio`, `library/:id`) render inside this shell. The reader route (`read/:id`) renders **outside** the workspace layout for a distraction-free experience.

## Custom Route Reuse Strategy

**File:** `src/app/core/strategies/app-route-reuse-strategy.ts`

Angular normally destroys components when navigating away. This app implements a custom `RouteReuseStrategy` so that workspace pages (Library, Brain, Studio, BookDetail) are **detached and stored in memory** instead of destroyed.

### How It Works

```
shouldDetach(route)  → true when route.data['shouldReuse'] === true
store(route, handle) → saves DetachedRouteHandle keyed by route path
shouldAttach(route)  → true if a stored handle exists for the path
retrieve(route)      → returns the stored handle (or null)
shouldReuseRoute()   → default Angular behavior
```

### Effect

- Navigating Library → Brain → Library **preserves** scroll position, loaded data, and component state.
- The DOM tree is detached/reattached rather than destroyed/recreated.
- Only routes marked with `data: { shouldReuse: true }` participate.

## Navigation History (Deep-Link Memory)

`NavigationHistoryService` tracks the last visited URL within each section prefix (`/library`, `/second-brain`, `/studio`).

The `AppDockComponent` uses this to restore context:

- Click **Library** while on Studio → navigates to `/library/some-book-id` (last viewed book) instead of always `/library`.
- Click the **same** dock item while already in that section → resets to the section root.

## Lazy Loading

All leaf routes use `loadComponent: () => import(...)` for code-splitting. Each page lands in its own chunk.
