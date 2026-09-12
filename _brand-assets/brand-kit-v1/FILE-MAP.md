# Nostos Brand Kit v1 — vendored source

Vendored masters plus a record of which kit file each repo asset came from.
This is the anti-drift record: if an asset is ever questioned, compare it here.

## Kit

- Name: **Nostos Brand Kit v1.0** (`Nostos_Brand_Kit_v1`)
- Canonical mark: `source/01_Primary_Mark/nostos-mark-primary.svg`
- Colours: Forest `#293E32` · Paper `#FDF8F6` · Ink `#1C1B1A` · Clay `#A07859` · Muted `#8A8680` · Border `#E4E1DB`
- The kit's own palette matches the app tokens byte-for-byte, so the swap needed **no colour work**.
- Geometry is locked: canvas 1024, tile corner radius 205, outer arch x 282–740 / springline 509 / bottom 764, doorway x 358–578 (intentionally offset −43px, −4.199%). **Never recentre the doorway.**

## The mark is a TILE, not a bare arch

Kit v1 is a solid rounded-square **tile with the arch knocked out of it** — not
the bare arch silhouette used previously. Two consequences:

1. The `--brand-shape` / `--brand-doorway` token pair swapped meaning:
   `--brand-shape` is now the **tile** fill, `--brand-doorway` the **arch** fill.
   - Light = kit `mark-primary` (forest tile / paper arch).
   - Dark = kit `mark-reversed` (paper tile / forest arch), because a forest tile
     on the dark rail measures 1.6:1 and dissolves.
2. Clay `#A07859` is **no longer part of the mark** (the kit reserves it as a
   supporting accent only). It remains a UI token (`--color-accent`).

## ⚠️ Known defect in the kit: five PNG exports lost the knockout

Do **not** source rasters from `02_Color_Variants/*.png`. Verified by rendering
each SVG in Chromium and comparing against the kit's own PNG at matching points:

| Variant | SVG | PNG export |
| --- | --- | --- |
| `mark-primary` | ok | ok |
| `mark-reversed` | ok | ok |
| `nostos-app-icon` | ok | ok |
| `mark-forest-knockout` | ok | **blank solid tile** |
| `mark-monochrome-light` | ok | **blank solid tile** |
| `mark-monochrome-dark` | ok | **blank solid tile** |

Confirmed at 256/512/1024. **The SVGs are the good master** — all rasters in this
repo were generated from the SVG geometry.

## Mapping: repo asset ← kit source

| Repo path | Derived from | How |
| --- | --- | --- |
| `public/favicon-light.svg` | `01_Primary_Mark/nostos-mark-primary.svg` | forest tile + paper arch, transparent |
| `public/favicon-dark.svg` | `02_Color_Variants/nostos-mark-reversed.svg` | paper tile + forest arch, transparent |
| `public/favicon.ico` | `03_Favicon/favicon.ico` | kit file verbatim (16/32/48 frames, paper-plated, arch verified present) |
| `public/apple-touch-icon.png` | primary geometry | **full-bleed** forest canvas + arch (iOS masks it) |
| `public/pwa-192.png` | `01_Primary_Mark/nostos-mark-primary.svg` | literal kit rendering, transparent |
| `public/pwa-512.png` | `01_Primary_Mark/nostos-mark-primary.svg` | literal kit rendering, transparent |
| `public/maskable-512.png` | primary geometry | **full-bleed** forest canvas + arch |
| `public/nostos-symbol-fullcolor-128.png` | `01_Primary_Mark/nostos-mark-primary.svg` | transparent |
| `public/nostos-symbol-fullcolor-512.png` | `01_Primary_Mark/nostos-mark-primary.svg` | transparent |
| sidebar mark (`sidebar-collections.component.html`) | `01_Primary_Mark/nostos-mark-primary.svg` | inline SVG, token-driven |
| sidebar + hero lockup | `05_Lockups/nostos-horizontal-editable.svg` | inline SVG, kit's own metrics |

### maskable-512 is NOT the kit app icon

The kit's `nostos-app-icon` puts the tile at 100% of canvas; its farthest point
from centre is 0.624 of the side, but the maskable safe radius is 0.400 — the
corners would be cropped by the platform mask. `maskable-512.png` is therefore
built as **full-bleed Forest + the arch at native scale** (arch farthest point
0.333 of the side, comfortably inside the safe circle).

### The wordmark is live `<text>`, not outlines

The kit's lockups set `nostos` in Hanken Grotesk 500 (`font-size 255`,
`letter-spacing -8`, baseline `y=345`) as a live `<text>` element. The app loads
Hanken Grotesk app-wide (`styles.css` `@import`), so the lockups here use live
text at the kit's exact metrics — no font embedding needed. If a lockup ever
needs to leave the app, outline it to paths first.

## Full kit folder map (source/)

- `01_Primary_Mark/` — the canonical mark SVG
- `02_Color_Variants/` — colour-only variants, identical geometry (SVGs only; see defect above)
- `03_Favicon/` — the correct, plated `.ico`
- `04_App_Icon/` — app icon SVG
- `05_Lockups/` — horizontal + stacked lockups
- `06_Guidelines/` — usage rules, locked geometry, tokens

Redundant PNG size ramps, PDFs and the superseded `Nostos_Brand_Kit_Final` tree
are deliberately **not** vendored.
