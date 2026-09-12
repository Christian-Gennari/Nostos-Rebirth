# Nostos Dark Mode — Design Plan & Recommendations

**Direction: "Nordic Nocturne"** — cool slate ground, spruce fill, pale-mint ink,
smoked-warm accent. Based on the user-supplied Stitch reference (`DESIGN.md` +
`code.html`), validated on the live library, with three adaptations documented in
§3.3.

> **For Hermes:** Planning + design document. §5 is verified against the running
> library. No source file has been modified. Three open questions in §7.

**Goal:** Define a dark mode for Nostos that is unmistakably the *same* product
as the light Nordic Editorial identity — a silent digital study at night, not a
warm lamplit nook and not a generic SaaS night theme — with a migration strategy
that cannot repeat the failures of the theme system deleted in August.

**Evidence base:** live library at `localhost:5214/library` (74 books, real cover
art) measured over CDP; `docs/design-manifesto.md`; the *removed* theme
implementation recovered from git (`fe64239` → `1ce311e` → `e2afacd`); the Stitch
`Nordic Nocturne` reference.

---

## 1. Why this is a second attempt — and what the first one got wrong

A theme system existed. It was built (`fe64239`, `04986a9`), patched twice
(`def41c9`, `355163a`), then **deliberately deleted** across `2d5d462`,
`517af22`, `1ce311e`, `e2afacd`. Today `docs/visual-verification.md` opens with:

> "The app ships exactly **one light rendering** — the theme system was removed."

The removal was honest about the symptom (`def41c9` was titled *"theme every
surface that stays light in dark mode"* — i.e. surfaces kept being missed), but
the root cause is recoverable from the deleted code, and it is **three design
faults, not an implementation failure**:

### Fault 1 — The dark palette predated the brand
The deleted `[data-theme='dark']` block used cold surfaces (`#0e1116`,
`#161a21`) and a **blue** accent (`#60a5fa`, Tailwind blue-400). The design
manifesto that now governs everything (`dcdf16b`) landed *after* that palette was
written. The failure was not coldness — it was that the palette was a generic
repo-era scheme with no relationship to the manifest's material logic. Any dark
mode must derive from the manifesto, not from that block.

### Fault 2 — "Invert everything" made the brand fill unusable
The deleted dark block inverted the primary accent:

```
--color-primary: #e6e8ec;   /* light! */
--color-primary-hover: #ffffff;
```

That works for *text* and breaks for *fills*: `#e6e8ec` is near-white, so every
`.btn-primary` became a near-white pill and "Add Book" stopped reading as the
brand. `def41c9` shows the repair effort — buttons repainted to "dark active pill
with light icon+label" — each one a case-by-case patch of a single broken token.

### Fault 3 — The blast radius was invisible until it was too late
The real killer. The codebase contains **25 hard token inversions** of the form
`color: var(--bg-surface)` — a *surface* token used as a *foreground*. On light,
`--bg-surface` is `#ffffff` on a dark pine pill: correct. On dark,
`--bg-surface` becomes a dark surface value and that same text turns near-black
**on the dark pill**. Reproduced on the live library:

```
nav-item.active   background -> rgb(53,80,63)     (dark green pill)
nav-item.active   color      -> rgb(30,27,24)     (near-black text)
```

That is **1.24:1**. Invisible. And it is not one bug — it is 25 sites across
readers, modals, the dock and the studio.

**Conclusion:** the previous attempt did not fail because dark mode is hard to
colour. It failed because *one token carried three jobs* (§2), so repainting it
for one job silently vandalised the other two.

---

## 2. The single most important finding: `--color-primary` carries three jobs

In the current light build, `--color-primary: #28372D` (pine) does simultaneously:

| Job | Example sites | Needs on dark |
| --- | --- | --- |
| **Foreground / ink** | `h1–h4`, `.brand`, `.meta-title`, `focus-visible` outlines, icons | **light** |
| **Surface / fill** | `.btn-primary`, `.nav-item.active::before`, `::selection` | **dark** |
| **Pass-through** | 25 × `color: var(--bg-surface)` reading it implicitly | *inverse of the surface* |

No single value satisfies all three on a dark ground. This is why every previous
fix produced a new regression, and why Task 1 **splits the token into two roles**.

### Independent confirmation
The Stitch reference splits primary **exactly the same way**, unprompted:

- `primary: #ACCDC4` — pale mint, **text and icons only**
- `primary-container: #2D4B44` — deep spruce, **fills only**

Measured: `#ACCDC4` as text on the ground = **10.39:1**; `#2D4B44` as text on the
ground = **1.86:1** (invisible). Two independent processes arriving at the same
split is the strongest available evidence it is the correct model. **Adopt it.**

---

## 3. Design direction — Nordic Nocturne

### 3.1 Why this direction, not warm

An earlier draft recommended a warm "lamplight" palette (derived from the paper
`#FDF8F6`). It was rejected in favour of Stitch's cool direction, and on
reflection the cool choice is better aligned with the manifesto, which explicitly
bans:

> "Dark-academia clichés, fake wood shelves, & parchment gimmicks"

A brown-tinted dark mode sits uncomfortably close to that line. Slate + spruce +
pale mint keeps the "silent digital study" register the manifesto asks for, and
preserves the spruce/paper *contrast* that is the brand's core idea rather than
flattening both into one warm family.

### 3.2 What Stitch gets right (adopt as-is)

- **Role split** — §2.
- **Tonal-stepping elevation instead of shadows.** Stitch's `DESIGN.md`: *"conventional
  light-cast drop shadows are omitted. Hierarchy is communicated through matte
  tonal shifts."* This is exactly right for Nostos and matches the manifesto's
  "quiet, soft ambient shadows" / "almost physical without pretending to be
  physical". Verified: `--bg-surface` 1.07, `--bg-surface-alt` 1.16, `--bg-hover`
  1.23 against the page — the ladder reads without a single shadow.
- **Hairline borders as the primary structural device** (1px `#262A34`).
  Verified separation **1.24** against the page — an exact match for the light
  build's 1.24. That parity is what stops dark mode reading as flat black.
- **The inverted porcelain CTA** (`#EDEEF2` bg / `#111318` text, 16.03:1). It
  makes the primary action unmistakable without a colour, and — because it does
  not use the accent — it frees spruce/mint to mean *state* rather than *action*.
  In the library, "Add Book" is the only inverted element on screen.
- **Spruce as a state signal, not decoration.** Stitch uses mint for active nav,
  progress bars, focus, sync and completion — one accent carrying "this is live"
  consistently.
- **Restrained radii** (4px base, 8px overlays) — already Nostos's scale.
- **Type roles** — Newsreader for literary content, Hanken Grotesk for
  operational UI. Identical to Nostos. No change.

### 3.2a Three rendering findings (found in review, with evidence)

These were apparent only once the palette was on the real library. Each was
reported from the live render and then traced to a precise cause. The counting
evidence comes from the reference's own `code.html`: across its dark screen,
porcelain `#EDEEF2` appears **70×** and mint `#ACCDC4` **15× — and mint is never
once used on a heading**.

**1. Headings must be porcelain, not mint.**
My first pass painted `h1–h4`, `.brand` and `.meta-title` with `--primary-ink`
(mint). The reference instead sets its `h1` to `text-[#edeef2]` — plain
porcelain — i.e. the title is *ink*, and mint is reserved as an accent. Mint on
every title also collides with mint elsewhere (the search focus ring), so
"the title is green" reads as a state rather than as typography.

| | value | contrast |
| --- | --- | --- |
| mint as title (my first pass) | `#ACCDC4` | 10.39 |
| **porcelain as title (correct)** | `#EDEEF2` | **15.32** |
| light build for reference | pine `#28372D` | 11.90 |

Fix: headings use `--color-text-main`. Note this **inverts** the light build's
logic, where headings *are* the accent (pine) — that is deliberate and matches
the reference, which also uses dark ink for light-mode titles and plain
porcelain for dark-mode titles.

**2. The active nav is a raised surface + mint indicator, not a filled pill.**
The reference's active nav item resolves to
`bg-[#1e242c] text-[#edeef2] border-l-2 border-[#accdc4]` — a slightly raised
tint, porcelain text, and a thin mint bar. Measured: raised tint 1.19 vs canvas,
porcelain text 13.48, mint bar 9.14. My pass had a solid spruce fill with light
text (7.61) wrapped around a **saturated mint icon**, which combined with mint
headings to make the whole surface read washed out. Fix: raised tint + porcelain
text + mint indicator (see §5).

**3. The floating dock loses its elevation, and carried two clashing accents.**

- *Elevation.* In light, the dock is `--bg-surface` (#FFFFFF) on a #FDF8F6 page
  — only **1.05** tonal separation — and it floats because a **soft shadow on a
  bright ground reads strongly**. In dark, the same recipe puts a dark surface
  on a dark page with a shadow whose colour is still `rgba(42,38,32,0.12)`,
  tuned for light. **A dark shadow on a dark ground is very nearly invisible**, so
  the dock loses the cue that told you it was floating. On dark the *surface*
  must carry the elevation instead: measured **1.55** separation (`#323A48` over
  `#15181F`), plus a real dark shadow with a faint mint rim.

  This is a general rule for the migration, not a dock-specific patch: **any
  surface that relied on a shadow to read as elevated needs to be re-stepped
  tonally on dark**, because the shadow channel stops working. Affected beyond
  the dock: `--shadow-glow` users (book-detail, second-brain), the cover hover
  lift, and any `.glass-panel` floating over the page.

- *Two accents.* The dock's active item was mint (`var(--color-primary)`) while
  its indicator pill was clay (`var(--color-accent)`) — two different accents in
  one 40px control, so neither read as *the* state colour. Fixed by making the
  indicator mint, matching the sidebar's state colour. **Rule: within a single
  control, state is expressed by exactly one accent.**

**One more consequence, decided here rather than deferred:** the mint fill on
`.btn-primary` had the same washed-out problem, because mint is a *light* colour
being asked to be a *surface* — the reverse of the original bug. §5.1 adopts the
reference's inverted porcelain pill, which resolves it: the CTA becomes the
single brightest element on screen, and spruce/mint go back to meaning *state*.

### 3.3 Three adaptations required (Stitch does not fit Nostos as-is)

**1. Lift the ground one step: `#111318` → `#15181F`.**
Your library is full of cream, ivory and yellow cover art. Glare is a function of
the artwork's own luminance against the page:

| ground | separation vs near-white art |
| --- | --- |
| Stitch raw `#111318` | 16.12 |
| **lifted `#15181F` (recommended)** | **15.27** |
| warm alternative `#1C1916` | 15.05 |

One step buys a real reduction and **preserves every structural ratio**
(border still exactly 1.24). Do **not** go further — this is the last step before
the palette stops reading as dark.

Note the honest finding: **going cool does not solve glare either** (16.12 raw,
worse than warm's 15.67). The lift does the work; temperature does not. Do not
dim or filter cover art — that is the parchment gimmick the manifesto bans and it
degrades the one thing the library exists to show. Accept the residual: a
near-white cover should be the brightest object in a dim room.

**2. Remap the accent — Stitch's ochre is a fill colour, not a text colour.**
Nostos uses `--color-accent` for *text* (`.concept-tag` links, underline
`border-bottom`), so it must be legible:

```
Stitch ochre  #8C6D53 as text on ground : 3.74:1   UNUSABLE
-> --color-accent        #D1AC8F        : 8.47:1   OK
-> --color-accent-hover  #E5BFA1        : 10.40:1  OK
```

This is the same trap as §2 in a different token: `tertiary` in Stitch's system
is a container colour. Nostos needs the light end of that warm family for links.

**3. Redefine the three nostos-named accents onto the cool system.**
Stitch's `SECONDARY / Smoked Indigo #3A4556` measures **1.92:1** as text — it
cannot serve Nostos's accent role. Mapping:

| Nostos token | Light | Dark | Notes |
| --- | --- | --- | --- |
| `--color-primary` (ink) | `#28372D` pine | `#ACCDC4` pale mint | Stitch `primary` |
| `--color-accent` (clay links) | `#8A6D58` clay | `#D1AC8F` smoked warm | **remapped** — see above |
| `--color-secondary` (indigo) | — | `#3A4556` | **container tint only** |

Smoked indigo survives exactly as Stitch defines it — a structural container
tint (tags, badges, selection). It is not a text colour.

### 3.4 Verified contrast table (measured, not estimated)

Light build for reference: text-main **16.33**, text-muted **6.54**,
text-light **3.44**, border-vs-page **1.24**.

| Token | Value | Role | On ground | Light equiv. |
| --- | --- | --- | --- | --- |
| `--color-text-main` | `#EDEEF2` | body **and headings** (§3.2a) | **15.32** | 16.33 |
| `--primary-ink` | `#ACCDC4` | accent: icons, indicators, focus | **10.39** | 11.90 |
| `--color-text-muted` | `#C5C9D0` | secondary | **10.69** | 6.54 |
| `--color-text-light` | `#949CA9` | meta / captions | **6.42** | 3.44 |
| `--color-text-placeholder` | `#7A8290` | de-emphasis | **4.59** | 2.38 |
| `--color-text-faint` | `#4A5260` | cover glyph | 2.26 | — |
| `--primary-fill` | `#2D4B44` | reserved; no longer the CTA (§5.1) | 1.86 sep. | — |
| `--on-primary` | `#F0F2F5` | text on fill; **inverted CTA surface** (§5.1) | **15.3** | 12.54 |
| `--color-accent` | `#D1AC8F` | concept links | **8.47** | 4.52 |
| `--border-color` | `#262A34` | hairlines | **1.24 sep.** | 1.24 sep. |
| `--bg-surface` | `#1B1E26` | panels | 1.07 | 1.05 |
| `--bg-surface-alt` | `#21252E` | raised | 1.16 | 1.05 |
| `--bg-hover` | `#252A34` | hover | 1.23 | 1.10 |
| dock/float surface | `#323A48` | floating layer (§3.2a) | **1.55 sep.** | 1.05+shadow |
| `--color-danger` | `#FFB4AB` | restrained danger | **10.46** | — |
| `--color-success` | `#ACCDC4` | finished | **10.39** | — |
| `--color-highlight` | `#E0C275` | stars | **10.27** | — |

Every text role meets or exceeds its light-mode counterpart. Structural
hairlines match light **exactly** at 1.24. The one place dark must *exceed*
light is the floating layer: light floats the dock on a shadow, dark has to raise
the surface instead (1.55 vs light's 1.05), because a dark shadow on a dark
ground carries no elevation.

> **Note on `--color-success` = `--color-primary`.** Stitch deliberately uses one
> mint for both, for cohesion. Acceptable here, but it means the "finished"
> checkmark reads in the brand colour while "favourite" (`--color-danger-vivid`)
> reads red. If that feels ambiguous in the library grid, the fallback is a
> cooler green (`#8FC7A8`) — decide during the Library review (§6.5).

---

### 3.5 Palette-coverage audit (both themes)

Because the Stitch kit supplies **both** systems (`nordic_editorial_reader/DESIGN.md`
and `nordic_nocturne/DESIGN.md`), the mapping can be audited directly rather
than eyeballed. The light app defines **103** `:root` tokens. Breakdown for the
dark block:

| Category | Count | Status |
| --- | --- | --- |
| Explicitly re-inked for dark | **68** | ✓ in the drop-in block |
| Auto-adapting via `color-mix()` | 5 | ✓ `--danger-*` family derives from `--color-danger` |
| Theme-invariant (geometry/motion/type) | 32 | ✓ correctly omitted — radii, motion, `--text-*`, `--space-*`, `--fw-*`, shadows' blur, `--container-width-*` |

**The first draft of this plan covered only 47 and silently let 21 colour tokens
fall through — 60 call sites in total.** Every one of them resolved to its
*light* value under the dark theme (verified live over CDP), which is exactly the
failure class that killed the previous attempt. They are now covered (§5), and
the findings are worth recording because each is a trap a future pass would hit:

| Gap | Symptom under dark | Fix |
| --- | --- | --- |
| `--editor-ui-focus` / `-accent` / `-accent-soft` | TinyMCE chrome kept light *blue* chroma (4.09:1 / 3.17:1) | `#9AAEC3` / `#B3C2D1` — reuse the values the *deleted* dark block had already chosen correctly |
| `--color-info` trio | `.upload-status` in the Add-Book modal rendered **blue-on-pale-blue**; `#0050b3` measures **2.37:1** on the dark page | `#A8C4E8` on `#1A2433`, border `#4A6A94` |
| `--pastel-peach` | `#F4EDE7` is a **light** chip; it would appear as a bright pill on dark | `#2A2318` |
| `--gradient-pastel` / `-soft`, `--pastel-lavender/sky` | Light stops `#28372D → #5B6B60 → #8A6D58` are all dark → **gradients vanish** (book-detail, settings, home, studio) | re-derived from mint → dim pine → smoked warm |
| `--shadow-glass` / `-lg`, `--shadow-glow` | 17 uses fell back to light-tuned ambient shadows; glow stayed clay-tinted | darkened; glow re-inked to mint |
| `--bg-sidebar` seam | `app-sidebar-collections`'s **host** rule paints `--bg-surface-alt` while `.sidebar` inside paints `--bg-sidebar` → an 8px light seam in the collapsed rail | Task 3 must set the host's background to `var(--bg-sidebar)`. Light hides this because `#F7F3F0` and `#F7F3F0` are the same value; dark splits them (verified: host `rgb(33,37,46)` vs inner `rgb(18,20,26)`) |

**One more bug found and fixed, with no token needed.** `.wait-field::before`
builds its breathing glow as `color-mix(--surface-image-ground 72%, #fff)` — a
*white* wash sized for light. On dark it resolves to roughly `#5E6166`, i.e. a
glow **13× brighter than the page**: a visible bright blob during every load.
The fix is to overlay a light film instead of mixing toward white:

```css
:root[data-theme='dark'] .wait-field::before {
  background: radial-gradient(120% 85% at 50% 38%,
    color-mix(in srgb, var(--surface-image-ground) 82%, var(--color-text-main)) 0%,
    transparent 72%);
}
```

Re-verified after all fixes: **every token resolves to a dark value** and the
rendering is clean (`nostos-dark-verified.png`) — no stray light panel, all text
legible.

---

### 3.6 Pre-existing toolbar collision at 1400–1640px (both themes)

**Not a dark-mode bug** — found while checking the dark capture, but it is present
in the light build identically and is already baked into the committed baselines.

`.toolbar .search-bar-container` is absolutely positioned at `left: 50%` with
`width: min(480px, calc(100% - 2 * 25rem))`. That `100%` is the toolbar's
**content box**, not the space left over after the control cluster, so the field
can overrun the cluster. Measured:

| viewport | search ends | controls start | result |
| --- | --- | --- | --- |
| 1366 / 1400 | — | — | wraps to 2 rows → **clear** |
| **1440** | 1032 | 1009 | **overlap 23px** |
| 1500 | 1092 | 1069 | **overlap 23px** |
| 1600 | 1186 | 1169 | **overlap 17px** |
| 1640 | 1206 | 1209 | clear |
| 1920 / 2560 | 1346 / 1666 | 1489 / 2129 | clear |

So the window is roughly **1401–1639px**, worst case 23px directly on top of the
"Last Read" dropdown. Confirmed in *both* themes.

**Why it went unnoticed:** the visual harness captures the library at exactly
**1440×900** (`visual-capture.ts:38`), which is inside the broken band — and that
baseline carries no collision check, so 10/10 green says nothing about it.
A 1920 or 2560 monitor clears it, which is why it was never seen on the real
desktop.

**Fix** — cap the field against the actual cluster rather than the toolbar width:

```css
@media (min-width: 1401px) {
  .toolbar .search-bar-container {
    /* 3rem = toolbar side padding; 375px = measured cluster width
       (sort 152 + 16 + toggle group 68 + 16 + Add Book 123); 1.5rem = clearance */
    width: min(480px, calc(100% - 2 * (3rem + 375px + 1.5rem))) !important;
  }
}
```

Verified clear at **every** width 1401→2560 with a consistent ≥24px gap, and the
narrowest field lands at 199px — which matches the file's own documented intent
of never dropping below ~205px.

**Harness action required:** add a **toolbar-collision check** to
`e2e/visual-regression.spec.ts` in both themes, and capture the library at a
**second desktop width inside the broken band** (1500 as well as 1440). A single
viewport can hide a whole responsive bug class; two crossing the boundary catch
it.

---

### 3.7 The brand mark needs a dark variant (it fails as-is)

The mark is two flat fills — pine `#293E32` and clay `#A07859` (`favicon-light.svg`).
**Both are dark colours, because they were drawn for light paper.** On the dark
sidebar the pine resolves to **1.60:1** — effectively invisible; the clay survives
at 4.50 but the arch it sits in disappears.

Measured, and this is the key insight: 

| build | outer shape vs its ground | inner vs outer (structure) |
| --- | --- | --- |
| light (pine/clay on `#FDF8F6`) | **10.90** | **2.91** |
| dark, unchanged | **1.60** ✗ | 2.91 (moot — arch invisible) |

**The fix is to flip the value order while holding the internal delta.** Light is
a *dark* outer on a light ground; dark must be a *light* outer on a dark ground,
with the inner staying darker than the outer so the two-part structure survives.
Tested five candidates rendered at 2× on the real sidebar:

| variant | outer / inner | outer vs sidebar | inner vs outer | verdict |
| --- | --- | --- | --- | --- |
| original | `#293E32` / `#A07859` | 1.60 | 2.91 | arch vanishes |
| A | `#ACCDC4` / `#D1AC8F` | 10.39 | **1.23** | inner lost — both parts light |
| B | `#EDEEF2` / `#D1AC8F` | 15.32 | 1.81 | good, outer a touch stark |
| **C (recommended)** | **`#ACCDC4` / `#8A6D58`** | **10.77** | **2.79** | **best — near-parity with light** |
| D | `#EDEEF2` / `#ACCDC4` | 15.32 | 1.00 | inner invisible (cool-on-cool) |

**Variant C**: mint outer `#ACCDC4` + clay doorway `#8A6D58`. Parity with the
light build is almost exact — outer **10.90 → 10.77**, internal structure
**2.91 → 2.79** — so it is the same mark, not a redesign. Verified in the real
sidebar at the real 40px: rendered pixels are `#accdc4` + `#8a6d58`, the mark is
crisp, and the inner shape remains distinguishable.

**Implementation — prefer tokens over a second asset.** Since the mark is already
a two-path SVG, inline it once and drive both paths from the palette so it can
never drift:

```html
<svg class="brand-mark" viewBox="0 0 1254 1254" role="img" aria-label="Nostos">
  <path class="brand-mark__shape"   d="…"/>
  <path class="brand-mark__doorway" d="…"/>
</svg>
```

```css
:root                 { --brand-shape: #293E32; --brand-doorway: #A07859; }
:root[data-theme=dark]{ --brand-shape: #ACCDC4; --brand-doorway: #8A6D58; }

.brand-mark__shape   { fill: var(--brand-shape); }
.brand-mark__doorway { fill: var(--brand-doorway); }
```

A static second file (`nostos-symbol-dark.svg`, written to `/home/dev/` as a
drop-in if a tokenised version is not wanted) works too, but then three call
sites need swapping and future edits can drift:
`sidebar-collections.component.html:7` (`nostos-symbol-fullcolor-128.png`),
`home.component.html:4` and `home.html:7` (`nostos-symbol-fullcolor-512.png`).

> **Do not swap the logo with CSS `content: url(...)` on an `<img>`.** Tested and
> it silently overrides the element's `src` (and renders the wrong asset). Use
> `srcset`/`picture`, a tokenised inline SVG, or a class-driven `background-image`.

**Note the favicon already does something different, deliberately:** the OSes
chrome is not ours, so `favicon-dark.svg` puts the *unchanged* pine mark on a
Paper `#FDF8F6` tile — the tile supplies the ground. That is right for a browser
tab. It would be wrong inside the app, where a bright tile would be the loudest
thing on a dark page. Keep both approaches: **tile the favicon, recolour the
in-app mark.**

---

## 4. What was actually verified (live, not theoretical)

Measured on the running library at `localhost:5214`, at the harness's exact
1440×900 / DPR 1.

1. **`html`/`:root` cascade trap.** Injecting a dark token block on `html`
   changed **nothing** — every surface still measured light, because `:root`
   (specificity 0,1,0) beats `html` (0,0,1). The theme block **must** be
   `:root[data-theme="dark"]`, which also matches the removed system and the
   specs still in the repo. (A `@media (prefers-color-scheme: dark)` auto-theme
   must supply both the `:root` block *and* an explicit
   `[data-theme="light"]` override, or a manual light choice cannot win.)
2. **The inversion bug reproduces, empirically.** Naive palette: active nav pill
   `rgb(53,80,63)` with text `rgb(30,27,24)` — 1.24:1.
3. **The role split fixes it, and the final palette renders cleanly.** On the
   live library, Nordic Nocturne + the role-split CSS resolves to: body
   `rgb(21,24,31)`, sidebar `rgb(18,20,26)`, toolbar `rgba(27,30,38,0.92)`,
   active pill `rgb(45,75,68)` with text `rgb(240,242,245)` (= `--on-primary`),
   headings/titles `rgb(172,205,196)` (= `--primary-ink`), cover border
   `rgb(38,42,52)`. Independently sighted and confirmed: active nav and "Add
   Book" readable, headings and titles legible, **covers read as distinct
   objects**, nothing broken or washed out.
4. **The token graph auto-repaints.** Sidebar (`--bg-sidebar`), toolbar
   (`--glass-bg-strong`), inputs, controls, card meta, scrollbars all resolved
   with no component edits. The graph is in far better shape than at the time of
   the removal: `color-mix()` adoption (book-detail 12×, styles 6×, settings 4×)
   now auto-adapts several derived values, including the whole `--danger-*`
   family.
5. **Screenshots captured** in `/home/dev/`:
   `nostos-compare-1-light.png` (baseline),
   `nostos-dark-final-nocturne.png` (**the recommended rendering**),
   `nostos-dark-A-lamplight.png` / `nostos-dark-B-nocturne.png` (direction
   comparison), `nostos-dark-C-deep.png` / `nostos-dark-D-lifted.png` (the
   glare-lift experiment).

---

## 5. The recommended dark token block (drop-in ready)

Values verified in §3.4 / §4. `--primary-ink`, `--primary-fill`, `--on-primary`
are **new** tokens (Task 1); everything else maps 1:1 onto the existing graph.

```css
:root[data-theme='dark'] {
  /* ── Surfaces — matte slate, tonal ladder (no shadows carry depth) ── */
  --bg-body: #15181F;            /* one step up from Stitch #111318: anti-glare */
  --bg-surface: #1B1E26;
  --bg-surface-alt: #21252E;
  --bg-sidebar: #12141A;
  --bg-input: #1B1E26;
  --bg-hover: #252A34;
  --surface-image-ground: #1F232B;

  /* ── Text — Porcelain / Chalk / Muted Slate ── */
  --color-text-main: #EDEEF2;
  --color-text-muted: #C5C9D0;
  --color-text-light: #949CA9;
  --color-text-placeholder: #7A8290;
  --color-text-faint: #4A5260;

  /* ── Primary, split into its three jobs (the core fix, §2) ── */
  --primary-ink: #ACCDC4;        /* headings, brand, icons, active  — light */
  --primary-fill: #2D4B44;       /* button/pill surfaces            — dark  */
  --on-primary: #F0F2F5;         /* text ON the fill                       */
  --color-primary: #ACCDC4;      /* legacy alias -> ink, for old callers   */
  --color-primary-hover: #375A52;
  --color-primary-dim: #5C7A72;

  /* ── Accents ── */
  --color-accent: #D1AC8F;          /* smoked warm — link text, remapped  */
  --color-accent-hover: #E5BFA1;
  --color-accent-faint: rgba(209, 172, 143, 0.32);
  --color-accent-bg: #2A2318;
  --color-secondary: #3A4556;       /* smoked indigo — container tint ONLY */

  /* ── Implicit / utility ── */
  --color-danger: #FFB4AB;
  --color-danger-vivid: #FF8A7A;
  --color-danger-bg: #3A1A18;
  --color-success: #ACCDC4;         /* see the note at the end of §3.4 */
  --color-success-dark: #ACCDC4;
  --color-highlight: #E0C275;       /* rated stars */

  /* ── Structure — hairlines are the only structural device ── */
  --border-color: #262A34;
  --border-light: #1F232B;
  --border-focus: #ACCDC4;
  --scrollbar-thumb: #2C313B;
  --scrollbar-thumb-hover: #3B4250;

  /* ── Depth — glass re-inks to the slate family ── */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.40);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.45);
  --shadow-lg: 0 10px 28px rgba(0, 0, 0, 0.55);
  --glass-bg: rgba(27, 30, 38, 0.60);
  --glass-bg-strong: rgba(27, 30, 38, 0.92);
  --glass-border: rgba(38, 42, 52, 0.90);
  --modal-scrim: rgba(8, 9, 12, 0.66);
  --overlay-heavy: rgba(0, 0, 0, 0.80);
  --overlay-medium: rgba(16, 18, 22, 0.72);
  --overlay-light: rgba(0, 0, 0, 0.40);

  /* ── TinyMCE bridge ── */
  --editor-ui-bg: #1B1E26;
  --editor-ui-bg-hover: #21252E;
  --editor-ui-bg-active: #2A303C;
  --editor-ui-text: #EDEEF2;
  --editor-ui-muted: #9CA4AF;
  --editor-ui-border: rgba(237, 238, 242, 0.10);
  --editor-ui-focus: #9AAEC3;          /* was leaking light #687b91 (4.09:1) */
  --editor-ui-accent: #B3C2D1;         /* was leaking light #536a82 (3.17:1) */
  --editor-ui-accent-soft: rgba(179, 194, 209, 0.13);
  --editor-ui-shadow: 0 16px 44px rgba(0, 0, 0, 0.60);

  /* ── Info (was NOT covered: light blue-on-pale leaked into dark) ── */
  --color-info: #A8C4E8;               /* light #0050b3 is 2.37:1 here — unreadable */
  --color-info-border: #4A6A94;
  --color-info-bg: #1A2433;

  --color-highlight-hover: #F0D264;

  /* ── Gradients & legacy pastel aliases (dark stops were invisible on dark) ── */
  --pastel-blue: #C7A98F;
  --pastel-lavender: #ACCDC4;
  --pastel-pink: #D1AC8F;
  --pastel-peach: #2A2318;             /* light #F4EDE7 was a LIGHT chip on dark */
  --pastel-sky: #5C7A72;
  --gradient-pastel: linear-gradient(120deg, #ACCDC4, #5C7A72, #D1AC8F);
  --gradient-pastel-soft: linear-gradient(120deg, rgba(172,205,196,0.28), rgba(209,172,143,0.28));
  --gradient-accent: linear-gradient(120deg, #ACCDC4, #D1AC8F);

  /* ── Glass-family shadows ── */
  --shadow-glass: 0 8px 24px -6px rgba(0, 0, 0, 0.50), 0 2px 6px rgba(0, 0, 0, 0.30);
  --shadow-glass-lg: 0 16px 36px -8px rgba(0, 0, 0, 0.60), 0 4px 10px rgba(0, 0, 0, 0.35);
  --shadow-glow: 0 6px 20px -4px rgba(172, 205, 196, 0.22);

  color-scheme: dark;   /* native scrollbars, form controls, PDF chrome */
}
```

### Dark-only rules that cannot live in tokens

Tokens cover almost everything, but four things need explicit dark rules. These
are the *verified* fix set — with them applied, the library renders correctly
(§4.3); without them, the active nav and Add Book are invisible (the 1.24:1 bug):

```css
/* 1. Headings stay PORCELAIN — mint is an accent, never a title (§3.2a) */
:root[data-theme='dark'] h1, :root[data-theme='dark'] h2,
:root[data-theme='dark'] h3, :root[data-theme='dark'] h4,
:root[data-theme='dark'] .brand,
:root[data-theme='dark'] .library-title,
:root[data-theme='dark'] .meta-title { color: var(--color-text-main); }

/* 2. ACTIVE nav = raised surface + porcelain text + mint INDICATOR bar.
      Not a spruce fill: measured against the reference, a filled green pill
      reads washed out. (§3.2b) */
:root[data-theme='dark'] .nav-item.active {
  background: transparent;
  color: var(--on-primary) !important;
}
:root[data-theme='dark'] .nav-item.active::before {
  background: #262C38;              /* raised tint, ~1.25 vs the sidebar */
  box-shadow: none !important;
}
:root[data-theme='dark'] .nav-item.active .count-badge {
  background: rgba(0, 0, 0, 0.28) !important;
  color: var(--on-primary) !important;
}

/* 3. The inverted porcelain CTA (§5.1) */
:root[data-theme='dark'] .btn-primary {
  background: var(--on-primary);
  color: var(--bg-body);
  border-color: var(--on-primary);
}
:root[data-theme='dark'] .btn-primary:hover {
  background: #C1C8C5;
  border-color: #C1C8C5;
}

:root[data-theme='dark'] .action-circle:hover { color: var(--on-primary) !important; }
:root[data-theme='dark'] ::selection {
  background: #3A4556;              /* smoked indigo — Stitch's selection */
  color: var(--on-primary);
}

/* 4. The FLOATING layer — the dock (§3.2c) */
:root[data-theme='dark'] .app-dock-container {
  background: #323A48;              /* raised: sep. 1.55 vs the page (page #15181F) */
  border-color: #454E60;
  box-shadow:
    0 16px 40px rgba(0, 0, 0, 0.62),
    0 3px 10px rgba(0, 0, 0, 0.45),
    0 0 0 1px rgba(172, 205, 196, 0.06);
}
:root[data-theme='dark'] .dock-item { color: #9AA3B2; }
:root[data-theme='dark'] .dock-item:hover {
  background: #3D4657;
  color: var(--on-primary);
}
:root[data-theme='dark'] .dock-item.active { color: var(--on-primary); }
/* ONE accent, not two: the marker is mint to match the sidebar's state colour,
   replacing the clay --color-accent that clashed with mint text. */
:root[data-theme='dark'] .dock-pill { background: var(--primary-ink); }

/* 2. Covers: the hairline alone is too weak on a dark ground — add a shadow */
:root[data-theme='dark'] .cover-wrapper {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.50);
}
:root[data-theme='dark'] .book-card:hover .cover-wrapper {
  box-shadow: 0 14px 30px -6px rgba(0, 0, 0, 0.65),
              0 0 16px -2px rgba(172, 205, 196, 0.14);
}

/* 3. The 4 hardcoded light SVGs in data: URIs are invisible on dark */
:root[data-theme='dark'] .sort-select {
  background-image: url("data:image/svg+xml;…stroke='%23949CA9'…");
}

/* 4. Surfaces that are hardcoded light (§6.4) */
:root[data-theme='dark'] .control-group { background: #161922; }
:root[data-theme='dark'] .toggle-opt.active {
  background: #2A303C;
  color: var(--primary-ink);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(172, 205, 196, 0.26);
}
:root[data-theme='dark'] .action-circle { background: #242833; color: var(--primary-ink); }
:root[data-theme='dark'] .sidebar { box-shadow: 4px 0 14px rgba(0, 0, 0, 0.42); }
```

### 5.1 The inverted primary CTA (resolved)

**Decision: adopt the reference's inverted porcelain pill.** A spruce/mint fill
was rejected on review: mint is a *light* colour, so using it as a *surface*
produces exactly the washed-out result the reference avoids — and it is the same
category error as the original bug (§2) with the roles flipped.

```css
:root[data-theme='dark'] .btn-primary {
  background: var(--on-primary);      /* #F0F2F5 */
  color: var(--bg-body);              /* #15181F — 15.3:1 */
  border: 1px solid var(--on-primary);   /* MUST be explicit — see below */
}
:root[data-theme='dark'] .btn-primary:hover {
  background: #C1C8C5; border-color: #C1C8C5;
}
```

**The border must be declared, not assumed.** `.btn-primary` is
`background: var(--color-primary); border: 1px solid var(--color-primary)`, so
once `--color-primary` became the *mint ink* role the button silently acquired a
**1px mint ring** around its fill. Verified: border resolved to
`rgb(172,205,196)` against a `rgb(45,75,68)` fill. It is subtle enough to
misread as "just a border I'm unsure about", but it is a bug — the ring belongs
to the old single-token world where fill and ink were the same value. Recolour it
to match the CTA surface and the button reads as one clean pill (verified).

Consequences to accept deliberately: the CTA becomes **the single brightest
element on screen** (which is the point — it is the only inverted surface in the
app), and it is a visible departure from the light build, where `.btn-primary` is
a pine fill. Everything else that used to be a primary *fill* (the sidebar's
active pill) moves to the raised-surface treatment instead (§3.2a).

---

## 6. Migration plan

Ordered so each task is independently verifiable and the risky work is isolated.
Nothing here touches layout, spacing, typography or motion — **palette only**.

### Task 1 — Split the primary token (do this FIRST, in light mode)

**Objective:** make the three jobs separable *before* any dark value exists, so
the split is provably behaviour-preserving.

- Add `--primary-ink: #28372D; --primary-fill: #28372D; --on-primary: #FFFFFF;`
  to `:root` in `src/styles.css` — all three equal to today's light behaviour.
- Repoint **fill** call sites to `var(--primary-fill)` / `var(--on-primary)`:
  `styles.css:436-437` (`.btn-primary`), `styles.css:533` (`::selection`).
- Repoint **ink** call sites to `var(--primary-ink)`: `styles.css:366` (`h1–h4`),
  `.brand`, `.meta-title`.
- Leave `--color-primary` as an alias so the 25 inversion sites keep working.

**Verify:** light rendering is **pixel-identical** (visual harness **10/10
green**). This is the regression gate for the entire plan.

**Files:** `Nostos.Frontend/src/styles.css`.

### Task 2 — Add the theme block + resolver, no UI yet

- Add the `:root[data-theme='dark']` block (§5) plus the dark-only rules to
  `styles.css`.
- Reinstate `data-theme` handling in `app.component.ts` (boot hydration only —
  this is what the deleted `ThemeService` did).
- `color-scheme: dark` inside the dark block.
- Capability: `localStorage` + explicit attribute. **No toggle in the UI yet**,
  so this task is reviewable in isolation.

**Verify:** set `data-theme="dark"` by hand; the library must match
`nostos-dark-final-nocturne.png`.

### Task 3 — The CLI capstone of the fix: replace the 25 inversions

Every site from the audit (`color: var(--bg-surface*)`):

| File | Lines |
| --- | --- |
| `styles.css` | 436, 533 |
| `app/library/library.component.css` | 785, 789, 1038 |
| `app/library/sidebar-collections/sidebar-collections.component.css` | 206, 211 |
| `app/reader/reader-shell.component.css` | 249, 279, 476 |
| `app/reader/pdf-reader/pdf-reader.component.css` | 127, 146 (`!important`) |
| `app/reader/audio-reader/audio-reader.component.css` | 237 |
| `app/book-detail/book-detail.component.css` | 1129 |
| `app/second-brain/second-brain.component.css` | 128 |
| `app/settings/settings.component.css` | 177 |
| `app/add-book-modal/add-book-modal.component.css` | 279 |
| `app/ui/confirm-modal/confirm-modal.component.css` | 146 |
| `app/ui/note-card.component/note-card.component.css` | 157 |
| `app/home/home.component.css` | 76 |

**Rule:** a foreground reading a surface token becomes `var(--on-primary)` when it
sits on a primary fill, else `var(--color-text-main)`.

**Verify:** grep returns **zero** `color: var(--bg-surface*`; light still 10/10.

> Prefer **both**: change the call sites *and* keep the §5 dark-only rules as
> defence-in-depth. Call-site fixes make the token graph honest; the dark rules
> guarantee the rendering even if a future inversion slips in.

**Also in this task — the sidebar seam (§3.5).** `library.component.css:43` paints
`app-sidebar-collections` with `var(--bg-surface-alt)` while
`sidebar-collections.component.css:42` paints `.sidebar` inside it with
`var(--bg-sidebar)`. In light both resolve to `#F7F3F0`, so the mismatch is
invisible; in dark they diverge (`#21252E` vs `#12141A`) and the collapsed rail
shows a lighter band. Set the host to `var(--bg-sidebar)` — the sidebar should be
*darker* than the page, which is what the Stitch reference does too
(sidebar `#0E1014` < canvas `#111318`).

### Task 4 — The light-mode-only islands

These bypass the token graph and **will stay light** until fixed:

| File | Line | Current | Fix |
| --- | --- | --- | --- |
| `app/book-detail/book-detail.component.css` | 514 | `background: #fff` | `var(--bg-surface)` |
| `app/settings/settings.component.css` | 124 | `background-color: white` | `var(--bg-surface)` |
| `app/settings/settings.component.css` | 263 | `background: #fff8e1` | cool info tint, or dark variant |
| `app/writing-studio/writing-studio.component.css` | 419 | `background: #ffffff` | **keep** — this is the paper |
| `app/library/library.component.css` | 533 | `rgba(18,18,18,.82)` HUD | **keep** — already dark |
| `app/library/library.component.css` | 692 | `rgba(255,255,255,.85)` | `color-mix` on `--bg-surface` |
| `app/library/sidebar-collections/…` | 251 | `rgba(255,255,255,.22)` | dark fill of `--primary-fill` |

**Plus the toolbar collision (§3.6)** — a pre-existing layout bug in *both*
themes: `.toolbar .search-bar-container` overlaps the control cluster by up to
23px between 1401–1639px. Fix the width cap, add a collision check, and add a
second desktop capture width (1500) to the harness.

Plus the **4 hardcoded light SVGs** in `data:` URIs (dropdown chevron):
`library.component.css:278`, `add-book-modal.component.css`,
`book-detail.component.css`, `settings.component.css`. Either tokenise via
`currentColor` + `mask`, or add a dark-only override (as §5 does).

Also: `index.html` hardcodes `<meta name="theme-color" content="#28372D">` — a
green browser chrome. Under dark it should follow `--bg-body`. (`favicon-light.svg`
/ `favicon-dark.svg` already handle the tab icon via `prefers-color-scheme` and
need no change.)

### Task 5 — Per-surface review, beginning with the Library

The Library is the most polished and the stated reference, so it validates the
palette first — this is also where the two open design decisions (success-mint
vs distinct green, and CTA option a/b) should be settled.

Then, in order of risk:

- **Brand mark** (§3.7) — needs the dark variant; it is currently invisible on
  the dark sidebar. Tokenise the two paths rather than shipping a second asset
  (3 call sites).
- **Book-detail** — the heaviest debt: 15 × `rgba(0,0,0,*)` shadows and
  10 × `rgba(255,255,255,*)` glass values. It also has 6 paper-specific
  `rgba(253,248,246,*)` literals in its hero wash that must be re-derived from
  `--bg-body` or they will smear a pale rectangle across a dark page.
- **Settings / Second Brain / modals** — small, token-driven, low risk.
- **Readers and Writing Studio last.** They were the least polished surfaces and
  the source of the previous attempt's worst regressions.

### Task 6 — Theme control + tests

- Toggle in Settings (not the reader shell — see below).
- **Do not re-introduce a sepia theme.** The manifesto bans parchment;
  `reader-shell.component.spec.ts:244` asserts *"renders no theme toggle and no
  data-theme binding anywhere in the shell"*, and `docs/visual-verification.md:167`
  asserts *"The reader shell has no theme controls."* Keep both contracts unless
  deliberately reversing them — the removed system had already learned this for
  PDFs: *"a white page may remain white, but it must sit on a clearly dark
  canvas."*
- Reinstate dark-era specs for boot hydration, persistence, and no-flash first paint.
- **CI guard — two checks, both required:**
  1. fail the build on `color: var(--bg-surface` (the inversion bug, §2) — a
     call-site check;
  2. fail the build when a colour token defined in the light `:root` has no
     counterpart in the dark block and is not `color-mix()`-derived (§3.5) — a
     *graph* check.

  Check 1 catches one bug class; **check 2 is the one that generalises.** The
  first draft of this plan failed check 2 with 21 uncovered tokens across 60 call
  sites, and nothing in the light build would ever have revealed it. A short
  script comparing the two token sets on every run makes the whole category
  impossible to reintroduce — including on the readers and studio, which Task 5
  reviews last.

### Task 7 — Extend the visual harness (this is what makes it stick)

The harness is **fixed-light by contract**: 10 images, no theme parameterisation,
and `visual-capture.ts:48-51` hardcodes `READER_IFRAME_LIGHT` /
`READER_SHELL_LIGHT` as *rendering invariants*. Dark mode therefore requires
deliberately amending that contract:

- Re-introduce a `theme` argument to `newCapturePage`
  (`e2e/support/visual-capture.ts:148`).
- Add the dark half of the matrix (mirror the 10; minimum: library desktop +
  mobile, book-detail, reader shell, studio).
- **Add a second desktop width.** The library is captured only at 1440×900 —
  which happens to sit inside the 1401–1639px collision band (§3.6), so the
  existing baseline both hides that bug and cannot detect it. Capture at 1500 as
  well, and add the toolbar-collision assertion, so a responsive regression has
  somewhere to fail.
- Update `docs/visual-verification.md` — its opening sentence ("exactly one light
  rendering") becomes false the moment a second rendering exists, and line 167
  (no reader theme controls) must be reconciled with Task 6.
- **Keep the light matrix green** throughout as the regression gate for Tasks 1–4.

### Suggested sequencing
Tasks 1→2 in one sitting. Task 3 is mechanical and reviewable in isolation.
Task 4 is the manual sweep. Task 5 is design judgement — **stop for review on
the Library** before continuing. Tasks 6–7 are hardening.

---

## 7. Risks and open questions

1. **Bright cover art remains the one unsolved tension** (verified — and going
   cool does not fix it; only the page lift does). Options: accept (recommended),
   or offer a user-toggleable ~6% cover scrim — never on by default.
2. **Success-green doubles as the brand mint** (§3.4 note). Still open: decide
   at the Library review whether "finished" should read as brand-coloured or as
   its own cool green.
3. ~~CTA treatment~~ — **resolved** in favour of the inverted porcelain pill
   (§5.1).
4. **Mint must not be over-used.** The review found three places competing for
   mint (headings, the active pill's icon, the dock marker). Two are now
   porcelain/neutral. Before shipping, audit for any *other* mint-on-everything
   drift — the reference spends its mint 15 times and porcelain 70.
4. **Paper is intentionally a light object.** The Writing Studio's paper and the
   EPUB/PDF pages should stay light. Reuse the removed system's PDF conclusion
   (no `invert()`/`hue-rotate()`), but that means the studio reads as *dark room,
   lit page* — confirm that is wanted.
5. **`.cover-wrapper` has no shadow by design** (the hairline carries
   separation). On dark a shadow becomes load-bearing. Small but real change to a
   light-mode aesthetic rule — it is the one place dark mode alters the light
   system's logic rather than re-inking it.
6. **The service worker** (`ngsw.json`) caches styles; theme changes may need a
   version bump to reach installed clients (this has bitten the project before).
7. **Auto dark via `prefers-color-scheme`** is a product decision, not a
   technical one. If enabled it must still let a manual "light" choice win (§4.1).

## 8. Files likely to change

- `Nostos.Frontend/src/styles.css` — theme block, dark-only rules, token split
- `Nostos.Frontend/src/index.html` — `theme-color` meta
- `Nostos.Frontend/src/app/app.component.ts` — theme hydration
- `Nostos.Frontend/src/app/settings/*` — theme control
- 14 component CSS files listed in Tasks 3–4
- `Nostos.Frontend/e2e/support/visual-capture.ts`,
  `e2e/visual-regression.spec.ts`, `docs/visual-verification.md` — harness contract
- `docs/design-manifesto.md` — add a short dark-mode section (currently silent)
