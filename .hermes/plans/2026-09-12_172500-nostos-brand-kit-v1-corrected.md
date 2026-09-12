# Nostos Brand Kit v1 (corrected) — Adoption Plan

> **For Hermes:** planning only. Nothing here has been executed. No repo file was created, modified, or deleted.
>
> **Supersedes:** `.hermes/plans/2026-09-12_164200-nostos-brand-kit-v1-adoption.md` (written against the WRONG kit — see §0.1). **That file has since been committed by another session into `4326e47`** and is now tracked in git. Delete it rather than leaving two contradictory plans in the repo:
> ```bash
> git rm .hermes/plans/2026-09-12_164200-nostos-brand-kit-v1-adoption.md
> ```

**Goal:** Replace every logotype, favicon and app icon in Nostos with `Nostos_Brand_Kit_v1` (the kit you sent second), confirm whether its colours drift from the theme tokens, and leave both light and dark mode CSS untouched.

**Source of truth:** `Nostos_Brand_Kit_v1/` in `/home/dev/.hermes/cache/documents/doc_7bc3bed27a76_Nostos_Brand_Kit_v1_NEW.zip`

---

## 0. What changed vs the previous plan (read first)

### 0.1 The previous plan analysed the wrong kit

The first zip contained **two** trees. I flagged `Nostos_Brand_Kit_Final/` as sanctioned because its palette was not yet in the repo. **That was wrong** — the correct kit is the `Nostos_Brand_Kit_v1/` tree you sent separately.

- The zip you just sent is **byte-identical** to the `Nostos_Brand_Kit_v1/` tree inside the first zip (verified: `diff -rq` reports no differences, 49 files, 752 KB).
- `Nostos_Brand_Kit_Final/` is **not to be used at all.** Every number in this plan comes from `Nostos_Brand_Kit_v1/`.

### 0.2 Your greens: **NO CHANGE NEEDED** — the kit matches your tokens exactly

Asked: "tell me if there are any differences between the colors, especially the greens I use; they should be the same."

**They are the same.** Kit v1 palette vs live `Nostos.Frontend/src/styles.css`:

| Kit v1 | Hex | Matching Nostos token | ΔE76 |
| --- | --- | --- | --- |
| Forest (brand green) | `#293E32` | `--brand-shape` `#293E32` | **0.00** |
| Paper | `#FDF8F6` | `--bg-body` `#FDF8F6` | **0.00** |
| Ink | `#1C1B1A` | `--color-text-main` `#1C1B1A` | **0.00** |
| Clay | `#A07859` | `--brand-doorway` `#A07859` | **0.00** |
| Muted | `#8A8680` | `--color-text-light` `#8A8680` | **0.00** |
| Border | `#E4E1DB` | `--border-color` `#E4E1DB` | **0.00** |

All six are **exact**. "Align colors if needed" resolves to **do nothing**.

One advisory, and it is **not** an instruction to change anything: your UI primary `--color-primary` is `#28372D`, which differs from the brand Forest `#293E32` by ΔE 3.82 (RGB −1, −7, −5). That pair already coexists today and is below the visible threshold — the brand mark has always used `#293E32` while buttons use `#28372D`. Leave it.

### 0.3 This is a **composition inversion**, not a re-trace

This is the single most important thing in the plan. The incoming mark is **not** the same object as what ships today:

| | Live (today) | Kit v1 |
| --- | --- | --- |
| Form | **bare arch / threshold silhouette**, no container | **solid rounded-square tile** with the arch knocked out |
| Geometry | traced blob path, `viewBox="0 0 1254 1254"` | two SVG primitives (rect + arch path), `viewBox="0 0 1024 1024"` |
| Colours | Forest arch `#293E32` + Clay doorway `#A07859` | Forest **tile** `#293E32` + Paper **arch** `#FDF8F6` |
| Clay | used (the doorway) | **not used at all** in the mark |

Silhouette IoU against the live asset: **0.683** (31% of pixels differ). That is not "the same idea, cleaned up" — it is a different design, so treating this as a recolour would be wrong.

**The mark inverts:** a dark arch → a dark tile with a *light* arch. Your Clay doorway accent is retired from the mark entirely.

### 0.4 **BLOCKER: five of the kit's own PNG exports are broken**

I rendered each of the kit's SVGs in Chromium and compared them against the kit's own PNG exports at matching sample points.

**The SVGs are correct. Five PNG exports are not** — they have lost the arch knockout and are solid, blank tiles:

| Variant | Tile fill | Arch knockout | Kit SVG | Kit PNG export |
| --- | --- | --- | --- | --- |
| `mark-primary` | `#293E32` | `#FDF8F6` | ok ✅ | ok ✅ |
| `mark-reversed` | `#FDF8F6` | `#293E32` | ok ✅ | ok ✅ |
| `nostos-app-icon` | `#293E32` | `#FDF8F6` | ok ✅ | ok ✅ |
| `mark-forest-knockout` | `#293E32` | transparent | ok ✅ | **BLANK ❌** |
| `mark-monochrome-light` | `#FFFFFF` | transparent | ok ✅ | **BLANK ❌** |
| `mark-monochrome-dark` | `#1C1B1A` | transparent | ok ✅ | **BLANK ❌** |

Confirmed at every raster size the kit ships (256/512/1024, and 128 for the app icon): the knockout is missing in the PNGs but intact in the SVGs. **The SVGs are the good master.**

**Consequence:** never source a variant from the kit's PNGs. Generate every raster from the kit's SVG geometry. This is cheap because the mark is two primitives, not a 3,000-point trace.

### 0.5 The kit is missing assets the repo links today

The kit ships **no `pwa-*`, no `maskable-*`, no `apple-touch-icon`, and no `favicon.svg`**. It ships only `01_Primary_Mark` PNGs, `02_Color_Variants` PNGs, `03_Favicon` (16/32/48/64 PNG + `.ico`), and `04_App_Icon` PNGs.

Everything the repo links but the kit omits must be **generated**. That includes `favicon-light.svg` / `favicon-dark.svg` / `pwa-192.png` / `pwa-512.png` / `maskable-512.png` / `apple-touch-icon.png`.

### 0.6 The kit has no theme-aware mark — and the new form **cannot** be token-driven

Today's sidebar mark is a *transparent* bare arch with two token-driven fills, which is why it adapts to dark mode. The new mark is a **solid tile**, and no single variant works on both grounds:

| Variant | On light sidebar `#F7F3F0` | On dark sidebar `#12141A` |
| --- | --- | --- |
| `mark-primary` (forest tile) | 10.40:1 ✅ | **1.60:1 — tile vanishes** ❌ |
| `mark-reversed` (paper tile) | **1.05:1 — tile vanishes** ❌ | 17.48:1 ✅ |

The tile **is** the mark, so the container can no longer stay transparent — it must be recoloured per theme. The good news: because the new mark is a **tile fill + arch fill**, the existing two-token mechanism still fits, it just changes meaning:

- `--brand-shape` → the **tile** fill (was: arch)
- `--brand-doorway` → the **arch knockout** fill (was: clay doorway)

**Light maps to the kit byte-for-byte** (`#293E32` tile / `#FDF8F6` arch = kit `mark-primary`). **Dark needs a decision** — see Q2.

### 0.7 The wordmark is live `<text>`, not outlines

`05_Lockups/*.svg` render `nostos` as a **live `<text>` element** in `'Hanken Grotesk', sans-serif`, `font-size: 255` (horizontal) / `220` (stacked), `letter-spacing: -8` / `-7`, `font-weight: 500`, lowercase.

Consequences:
- Hanken Grotesk is **not embedded and not bundled**; your app loads it from Google Fonts via `@import` in `styles.css:1`. The lockup only renders correctly where that font is actually available — fine in-app, **not** fine for a README badge, an SVG in an email, or anywhere the font is absent (it will fall back to a system sans and look wrong).
- `font-size: 255` does **not** scale when the SVG is scaled; it is in viewBox units, so that is fine, but the text will reflow if the font metrics differ on another machine.
- **Recommendation:** for any lockup that leaves the app (README, favicon, icon), convert the `<text>` to outlines first. In-app, live text is acceptable.

### 0.8 Lockup sizing problem for the sidebar

The horizontal lockup places the mark at `scale(0.5)` → **512×512 units** on a 1840×512 canvas. Your sidebar brand mark is **40px** wide. Rendering the whole lockup there would give a **20px tile with the wordmark beside it** — a large layout change, not an asset swap. See Q3.

---

## 1. Scope

**Change:** favicons, logotypes, app/PWA icons, and the in-app brand mark.
**Confirm-only:** colours (result: **no work needed**, §0.2).
**Forbidden:** any edit to the light/dark theme blocks in `styles.css` beyond the mark's own two tokens, and any change to `theme-color` (already `#28372D`, and kit Forest is `#293E32` — the meta tag is out of scope).

### 1.1 Hard boundaries

1. **Do not touch `:root[data-theme='dark']`** (`styles.css:301-416+`) except the two `--brand-*` lines in Task 5.
2. **Do not touch `theme-color`**, `--color-primary`, `--color-accent`, or any other palette token.
3. **`src/styles.css` is now CLEAN — but verify that before staging.** When this plan was drafted the file had 7 uncommitted lines inside the dark block (`--danger-ink`). That work has since landed in `4326e47`/`8b7ea3e`, and the brand tokens are untouched by it (light `#293E32`/`#A07859`, dark `#EDEEF2`/`#D1AC8F`, as this plan assumes). Re-check with `git status --porcelain -- Nostos.Frontend/src/styles.css` before you start: if it is dirty again, stage with `git add -p` so only the 4 `--brand-*` lines go in.
4. **Never source a raster from the kit's PNG exports** (§0.4). Generate from the SVG geometry.
5. **Never redraw the mark.** Kit guideline: "Preserve the exact mark geometry… do not independently recreate small-size versions."

---

## 2. Complete inventory of logo surfaces

| # | Surface | File | Current | Change |
| --- | --- | --- | --- | --- |
| 1 | Sidebar in-app mark | `src/app/library/sidebar-collections/sidebar-collections.component.html:12-27` | inline SVG, `viewBox="0 0 1254 1254"`, 2 trapezoid paths | new geometry: `<rect rx=205>` tile + arch path, `viewBox="0 0 1024 1024"` |
| 2 | Sidebar wordmark | same file, line 28 | `<span class="brand">Collections</span>` (Newsreader) | → SVG lockup (your Q3 answer) |
| 3 | Home hero mark | `src/app/home/home.component.html:4` | `<img src="nostos-symbol-fullcolor-512.png">` | new PNG, same filename |
| 4 | Home hero title | `src/app/home/home.component.html:13` | `<h1 class="hero-title">Nostos</h1>` (Newsreader) | → SVG lockup (your Q3 answer) |
| 5 | Browser tab | `src/index.html:9-27` + `public/favicon*.{svg,ico}` | scheme-aware pair + `.ico` | regenerate all three from kit geometry |
| 6 | PWA icons | `public/pwa-192.png`, `pwa-512.png`, `maskable-512.png` | old mark, `pwa-512` == `maskable-512` (same file — packaging bug) | generate new, and make them distinct |
| 7 | iOS icon | `public/apple-touch-icon.png` | 180px paper tile | generate new |
| 8 | Home symbol PNGs | `public/nostos-symbol-fullcolor-128.png`, `-512.png` | old mark | regenerate from kit |
| 9 | Dead template | `src/app/home/home.html` | orphan duplicate of #3/#4 | **delete** (nothing references it) |
| 10 | Backend static output | `Nostos.Backend/wwwroot/*` | built copy — **gitignored** (`git ls-files` = 0) | regenerated by the build |

**Not found anywhere:** logo in `Nostos.Shared`, backend views/routes/controllers, the README, or any `.cs`. No OG/social meta tags exist. `manifest.webmanifest` already declares `theme_color: #28372D` / `background_color: #FDF8F6` — **no manifest change needed**, only the icon files under it.

**e2e:** no test asserts favicon/logo/manifest, but `e2e/test-results/*.log` shows the backend serving `/favicon.ico`, `/manifest.webmanifest`, `/nostos-symbol-fullcolor-128.png`, so **filenames are load-bearing — preserve every one**.

---

## 3. Tasks

### Task 1: Vendor the kit, restricted to what is actually used

**Files:** create `_brand-assets/brand-kit-v1/{source/,FILE-MAP.md}`

1. `cp -r` the v1 kit into `_brand-assets/brand-kit-v1/source/` (752 KB total — small, so vendoring it all is fine, unlike the 3.5 MB first kit).
2. Write `FILE-MAP.md`: kit version, the 6 hexes, and per repo path → kit source + source `sha256`.
3. Record the §0.4 defect in that file so no future session sources a PNG variant by accident.
4. Commit: `chore(brand): vendor the Nostos brand kit v1`

### Task 2: Extract the canonical geometry once

**Files:** create `Nostos.Frontend/scripts/extract-brand-geometry.mjs`; output `_brand-assets/brand-kit-v1/mark.json`

The mark is two primitives, so this is a small, exact extraction from `01_Primary_Mark/nostos-mark-primary.svg`:

```json
{
  "viewBox": "0 0 1024 1024",
  "tile":    { "w": 1024, "h": 1024, "rx": 205 },
  "arch":    "M 282 764 L 282 509 A 229 234 0 0 1 740 509 L 740 764 Z M 358 764 L 358 509 A 110 112 0 0 1 578 509 L 578 764 Z",
  "colors":  { "forest": "#293E32", "paper": "#FDF8F6", "ink": "#1C1B1A", "clay": "#A07859" }
}
```

1. Script asserts the extracted `arch` string is **byte-identical** to the one in the kit's SVG.
2. Assert `rx` extracts as `205` and the viewBox as `0 0 1024 1024`.
3. Commit.

**Verify:** `node -e "const m=require('./_brand-assets/brand-kit-v1/mark.json'); console.log(m.viewBox, m.tile.rx)"` → `0 0 1024 1024 205`

### Task 3: Web icons in `public/`

**Files:** `public/favicon.ico`, `favicon-light.svg`, `favicon-dark.svg`, `apple-touch-icon.png`, `pwa-192.png`, `pwa-512.png`, `maskable-512.png`, `nostos-symbol-fullcolor-128.png`, `nostos-symbol-fullcolor-512.png`

**Preserve every filename** — `index.html`, `manifest.webmanifest` and the e2e logs depend on them.

1. **`nostos-symbol-*.png`** (hero + anywhere the bare mark is used): generate from the kit's `<rect>` + arch, transparent background. Per the kit's usage rules the primary mark is the **tile** form, so render tile-on-transparent at 128 and 512.
2. **`apple-touch-icon.png`** (180): the kit tile form on Paper, matching `app-icon-1024` composition. iOS applies its own rounding, so ship a **square** Paper tile with the tile mark centred — do not pre-round.
   - Sizing note: the kit's own app icon puts the tile at **100% of canvas**, and the current live one is much smaller. At 100% there is **zero margin**; iOS will not clip the rounded corners, but the mark will look noticeably larger than today. Recommend tile at **~80%** of canvas for optical parity with the live icon — flagging it as a deliberate choice, since the kit gives no padding guidance.
3. **`pwa-192.png` / `pwa-512.png`** (purpose `any`): kit tile form on Paper, same sizing as `apple-touch-icon`.
4. **`maskable-512.png`** — the kit ships **none**, and the kit's own app icon **cannot** be used as-is: the tile's farthest point from centre is **0.624 of the side**, but the maskable safe radius is **0.400**, so the tile's corners get cropped by the platform mask (verified by circle-crop test: 219,969 px of ink outside the safe circle at 100%).
   - **Build it as full-bleed Forest `#293E32` canvas + the Paper arch at native scale.** The arch's farthest point is only **0.333 of the side**, leaving 6.7% margin — comfortably safe, and the visible result is identical to `mark-primary`.
5. **`favicon-light.svg`** — kit tile form, `viewBox="0 0 1024 1024"`, Forest tile + Paper arch. Forest on light chrome = 10.16:1 ✅
6. **`favicon-dark.svg`** — keep the tile treatment (it is what makes it legible on either chrome). Two options; see Q4. Recommended: **Paper `#FDF8F6` tile + Forest `#293E32` arch** (= kit `mark-reversed`), which gives Paper-vs-dark-chrome 13.44:1 ✅.
7. **`favicon.ico`** — cannot be theme-adaptive, so it must be one legible-on-both rendering. The kit's `.ico` carries **frames 16/32/48** (the live one has only 16/32 — an upgrade). Use the kit's `.ico` **if and only if** a legibility check passes at 16px; the paper arch is only ~6.7% of pixels at 16px (§ measured), so verify visually rather than assuming. If it fails, plate on Paper with a larger arch.
8. **`index.html`** — keep the two `prefers-color-scheme` `<link rel="icon">` blocks and the `alternate icon` fallback structurally identical; only the files behind them change. Update the explanatory comment (it currently says "Improved brand kit"). **Do not touch `theme-color`.**

**Verify:**
```bash
cd Nostos.Frontend/public
ls favicon.ico favicon-light.svg favicon-dark.svg apple-touch-icon.png \
   pwa-192.png pwa-512.png maskable-512.png \
   nostos-symbol-fullcolor-128.png nostos-symbol-fullcolor-512.png
# the old 1254 geometry must be GONE from the SVGs
grep -c '1254 1254' favicon-light.svg favicon-dark.svg   # expect 0 0
grep -c 'A 229 234' favicon-light.svg favicon-dark.svg   # expect 1 1
# pwa-512 and maskable-512 must now be genuinely different files
[ "$(sha256sum pwa-512.png|cut -c1-16)" != "$(sha256sum maskable-512.png|cut -c1-16)" ] && echo distinct-ok
```

### Task 4: Home hero mark + lockup

**Files:** `src/app/home/home.component.html`, `src/app/home/home.component.css`, `src/app/home/home.html` (delete)

1. Hero mark (`line 4`): still points at `nostos-symbol-fullcolor-512.png`, which Task 3 regenerates — **no template edit needed**, but do confirm the new tile form still reads correctly at `width: 140px`.
   - The CSS has `opacity: 0.8` and a `drop-shadow(0 8px 24px rgba(40,55,45,0.18))`. A **solid tile** at 80% opacity will look washed out where the old thin arch did not. Recommend raising opacity to `1` for the tile form and keeping the shadow — **flagged as a small CSS judgement call**, not a theme change.
2. Hero title (`line 13`): replace `<h1 class="hero-title">Nostos</h1>` with the kit lockup per Q3.
3. Delete `src/app/home/home.html` — dead code (no `templateUrl` references it; only `home.component.html` is bound).

**Verify:** hero renders the new mark; `git diff` on `home.component.css` shows only the opacity line (if approved).

### Task 5: In-app sidebar mark — **the one real CSS edit**

**Files:** `src/app/library/sidebar-collections/sidebar-collections.component.html:12-27`, `src/styles.css` (4 lines: 2 light, 2 dark)

1. Replace the `<svg>` block. New structure is a **tile + arch** (both fills token-driven):
   - `viewBox="0 0 1024 1024"`
   - a `<rect x="0" y="0" width="1024" height="1024" rx="205" class="brand-icon__shape"/>`
   - the arch `<path class="brand-icon__doorway" d="M 282 764 … Z"/>` with the **two-subpath `evenodd`** form, so the arch is knocked out of the tile in one shape.
   - Keep `class="brand-icon"`, `role="img"`, `aria-label="Nostos"`, `focusable="false"`.
   - **`--brand-shape` / `--brand-doorway` swap meaning:** shape = *tile*, doorway = *arch knockout*. Update the class names' CSS comments, keep `.brand-icon__shape { fill: var(--brand-shape) }` etc. (no CSS change needed to the rules themselves — only `styles.css` values).
2. `styles.css` **light block (line 39-40)**:
   ```css
   --brand-shape: #293E32;    /* unchanged — now the TILE fill */
   --brand-doorway: #A07859;  /* → #FDF8F6  the arch knockout (was Clay) */
   ```
   That reproduces kit `mark-primary` byte-for-byte.
3. `styles.css` **dark block (line 337-338)** — per Q2:
   - Option A (recommended): `--brand-shape: #FDF8F6;` `--brand-doorway: #293E32;` (= kit `mark-reversed`; 17.48:1 on the dark sidebar, and the mark then matches the light one inverted).
   - Option B: keep the existing porcelain treatment — `--brand-shape: #EDEEF2;` `--brand-doorway: #1C1B1A;` (15.88:1 / 14.83:1). Preserves your Nordic Nocturne intent, but the mark is then porcelain rather than Paper.
4. Update the two comment blocks to reflect the new meaning. **No other line in either block may change.**

**Verify:** `npm run check:theme` → exit 0. Then a diff audit:
```bash
git diff Nostos.Frontend/src/styles.css | grep -E '^[+-]' | grep -E '#[0-9A-Fa-f]{6}'
# must show ONLY --brand-shape / --brand-doorway on both sides
```
⚠️ If `styles.css` is dirty again when you start, `git diff` will show that unrelated work too. Stage with `git add -p`; the brand commit must contain **only** the 4 brand lines. (When this plan was written the file was already clean.)

### Task 6: Verify the kit's own SVGs before trusting them

Already done in §0.4, and it is why the plan says *generate from SVG, never from the PNGs*. Re-run the check as a guard before generating:

```bash
# render each kit SVG and each kit PNG at 512, compare the arch-ring sample
python3 /tmp/bk2/svgcheck/verify_svg.py
```
Expected: SVGs all `arch PRESENT`; `forest-knockout`, `monochrome-light`, `monochrome-dark` PNGs `arch MISSING`; `reversed`, `primary` PNGs fine. **If a future kit fixes this, re-point the generator at the PNGs.**

### Task 7: Service-worker / cache invalidation

**Files:** none — verified no change needed.

`Nostos.Frontend/ngsw-config.json` already covers everything this task touches:
- `app-shell` (prefetch): `/favicon.ico`, `/manifest.webmanifest`, `/*.css`, `/*.js`, `/*.html`
- `static-assets` (lazy, prefetch updates): `/assets/**`, `/*.png`, `/*.ico`, **`/*.svg`**

So **no `ngsw-config.json` change is required**, and no new glob is needed for the regenerated SVGs.

Still required: `public/` assets are served by **raw filename with no content hash**, so an already-installed profile will keep the old icon until the SW version rolls. `src/app/core/services/sw-update.service.ts` exists — confirm it rotates the cache on the next load, and if not, note that a hard refresh / reinstall is needed. Worst case is a stale tab icon, not a broken app.

**Verify:** `GET /favicon.ico` returns the new byte length; DevTools shows no `(from disk cache)` for the icons.

### Task 8: Build and publish

**Files:** `Nostos.Backend/wwwroot/*` (gitignored)

1. `cd Nostos.Frontend && npm run build`
2. Confirm the built output carries the new icons; `sha256sum` each against `public/`.
3. Back up first, following the existing convention (`~/backups/nostos-wwwroot-pre-*-deploy-*.tgz`):
   ```bash
   tar czf ~/backups/nostos-wwwroot-pre-brandkitv1-$(date +%Y%m%d-%H%M%S).tgz -C Nostos.Backend wwwroot
   ```
4. Static assets are served from disk, so **no backend restart is needed**. The backend runs as a plain `dotnet run -c Release` (pid on 0.0.0.0:5214), **not** pm2 (`pm2 list` is empty). Per the standing rule, **ask before restarting** — and there is no need here.

### Task 9: Verification

**A. Gates**
```bash
cd Nostos.Frontend
npm run check:theme      # theme graph complete
ng build                 # compiles
npm test                 # 24 spec files
npx playwright test      # incl. visual-regression.spec.ts
```

**B. Prove the theme is untouched**
```bash
git diff --stat Nostos.Frontend/src/styles.css    # expect 4 brand lines (+ pre-existing 7)
git diff Nostos.Frontend/src/styles.css | grep -E '^[+-].*#[0-9A-Fa-f]{6}'
# only --brand-{shape,doorway} may appear
```

**C. Prove served bytes == kit bytes**
```bash
for f in favicon.ico favicon-light.svg favicon-dark.svg apple-touch-icon.png \
         pwa-192.png pwa-512.png maskable-512.png; do
  curl -so /tmp/s_$f http://localhost:5214/$f
  a=$(sha256sum /tmp/s_$f | cut -d' ' -f1); b=$(sha256sum Nostos.Frontend/public/$f | cut -d' ' -f1)
  printf "%-24s %s\n" "$f" "$([ "$a" = "$b" ] && echo MATCH || echo DIFFER)"
done
```

**D. Picture proof — both themes (you asked for light + dark variants wherever needed)**
Capture: sidebar mark light, sidebar mark dark, home hero light, home hero dark, tab icon on light chrome, tab icon on dark chrome, installed PWA icon.

**E. Confirm the old mark is fully gone**
```bash
grep -rn '1254 1254\|M 850 248\|M 798 414' Nostos.Frontend/src Nostos.Frontend/public   # expect no hits
```

---

## 4. Commit sequence

1. `chore(brand): vendor the Nostos brand kit v1` — kit + FILE-MAP
2. `chore(brand): extract the canonical mark geometry` — script + mark.json
3. `feat(brand): adopt kit v1 across web icons and favicons` — `public/**` + `index.html`
4. `feat(brand): swap the in-app brand mark to the kit v1 tile` — sidebar template + 4 token lines
5. `feat(brand): use the kit v1 lockup for the brand wordmark` — hero + sidebar (if Q3 = adopt)
6. `chore: drop the orphaned home.html duplicate`
7. `chore(deploy): publish the new brand assets to wwwroot` — after the backup

---

## 5. Open questions

**Q1 — Favicon, given the kit ships no theme-aware pair.**
You chose "mirror the kit, 4 variants". Confirming what that means concretely: the kit has **no** `favicon.svg` at all, so both SVGs must be authored from its geometry. Recommended: `favicon-light.svg` = forest tile + paper arch; `favicon-dark.svg` = paper tile + forest arch. OK?
*(If you'd rather keep it to ONE file, the only safe single file is a Paper-tile rendering — Paper on dark chrome is 13.44:1 and the tile on light chrome is fine.)*

**Q2 — The dark-mode in-app mark. This is the one genuine design decision.**
The new mark is a solid tile, so it can no longer stay transparent in dark mode; the tile must be recoloured. **Option A (recommended):** `--brand-shape: #FDF8F6` + `--brand-doorway: #293E32` — the mark becomes the kit's `reversed` variant, exact mirror of light, 17.48:1. **Option B:** keep your Nordic Nocturne porcelain/hairline look (`#EDEEF2` / `#1C1B1A`) but with the new tile form. Which?

**Q3 — Adopting the lockup, and the sidebar sizing.**
You chose "drop the text, use the SVG lockup". Two things that answer changes:
- **Sidebar:** the lockup's mark is `scale(0.5)` = 512/1840 of the canvas. In the current 40px mark slot the tile would come out ~20px with the wordmark beside it. Do you want (a) the tile enlarged to fill the 40px with the wordmark beside it (widens the header), or (b) the sidebar keeps just the tile and the lockup is used only where there's room (e.g. the home hero)?
- **Hero:** replacing `<h1>Nostos</h1>` with the lockup replaces a **Newsreader serif** wordmark with a **Hanken Grotesk sans** one. That is a visible typographic change to your editorial design language. Confirm you want that.
- Also: the lockup's wordmark is live `<text>`; should I **outline it to paths** so it renders identically outside the app (README etc.)?

**Q4 — Should I report the broken PNG exports back to whoever generated the kit?**
Five of the seven `02_Color_Variants`/`01_Primary_Mark` PNG ramps have a missing knockout. The SVGs are fine, so we can work around it completely — but the kit as delivered is not internally consistent.

**Q5 — `apple-touch-icon` / app-icon sizing.** The kit ships the tile at **100% of canvas** (zero margin). Today's icon is much smaller. Ship at 100% (kit-literal, noticeably larger on the home screen) or ~80% (closer to today's optical weight)?

---

## 6. What I did NOT do

Planning only, as instructed. No repo file was created, modified or deleted; nothing was built, committed, or restarted; no backend process was touched. All inspection was read-only; extraction, rendering and measurement happened in `/tmp/bk2` and `/tmp/bk2/svgcheck`.

**Evidence artefacts produced during analysis** (outside the repo):
- `MEDIA:/home/dev/bk2-current-vs-v1.png` — labelled current vs kit v1 across all surfaces, including the dark-sidebar row that motivates Q2
- `MEDIA:/home/dev/bk2-svg-vs-png.png` — the kit's own SVG vs PNG exports, showing the missing knockout (§0.4)
