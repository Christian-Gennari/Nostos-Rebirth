# Brain cohesion evidence

Screenshots were captured in a real Chromium browser at `1440x900` and
`390x844`, for both the light and dark themes. The seeded fixture contains
three source books, 18 notes, and 17 linked concepts. The final empty-notes
captures use a real orphaned concept with zero notes; the empty-index captures
were taken before seeding.

The `before/` and `after/` sets each contain the ten requested states across
all four viewport / theme combinations (40 images per set).

| Area | Before evidence | After evidence | Result |
| --- | --- | --- | --- |
| Dark sort control | `before/index-list-desktop-dark.png` | `after/index-list-desktop-dark.png` | Replaced the browser-painted duplicated chevrons with one tokenized chevron and a consistent shell. |
| Cold detail switch | Source/spec regression | `after/selected-desktop-light.png` and the selected mobile variants | The previous pane remains visible; there is no detail wait field or loading surface. |
| Mobile selected detail | `before/selected-mobile-light.png` | `after/selected-mobile-light.png` | The mobile back header stays in view and the workspace starts at scroll position 0. |
| Map labels | `before/index-map-desktop-light.png` | `after/index-map-desktop-light.png` | Labels are clamped inside the stage and the default label density is bounded; interaction still reveals individual labels. |
| Detail track sizing | Populated selected states | `after/selected-desktop-*.png` | The detail track fills the available desktop workspace without a negative top offset. |
| Empty states | `before/empty-index-*.png`, `before/empty-notes-*.png` | `after/empty-index-*.png`, `after/empty-notes-*.png` | Fresh index and a real zero-note concept are both covered in all four combinations. |

The baseline empty states were captured from the pre-phase source archive in an
isolated fixture. No before image was synthesized or relabeled as a baseline.
