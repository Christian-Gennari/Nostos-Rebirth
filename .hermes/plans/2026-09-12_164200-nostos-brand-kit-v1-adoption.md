# Nostos Brand Kit v1 — Adoption Plan

> **For Hermes:** planning only. Nothing in this document has been executed. No repo file has been modified.

**Goal:** Replace every logotype/favicon/app-icon in Nostos with the new `Nostos_Brand_Kit_Final` artwork, confirm whether the kit's colours drift from Nostos' theme tokens (they do not), and leave both light and dark mode CSS untouched.

**Source of truth:** `Nostos_Brand_Kit_Final/` inside `/home/dev/.hermes/cache/documents/doc_bfb43b237b8d_Nostos_Brand_Kit_v1.zip`

---

## 0. Headline findings (read this first)

### 0.1 The zip contains TWO kits — use only one

| Folder in zip | What it is | Verdict |
| --- | --- | --- |
| `Nostos_Brand_Kit_v1/` | Mark v1.0, the doorway/`n` with the deliberate **43px (4.20%) left-offset** inner doorway. Colours Forest `#293E32` / Clay `#A07859`. | **Superseded** — this is what is in the repo today |
| `Nostos_Brand_Kit_Final/` | The "return threshold" re-trace, flattened to the official brand colours. Pine `#28372D` / Clay `#8A6D58`. | **USE THIS** |

`Nostos_Brand_Kit_Final/README.md` calls itself "Final production kit based on the approved Nostos Return Threshold symbol… traced directly from the approved final icon".

### 0.2 Your greens: the kit matches the UI exactly — zero token changes needed

Asked: "tell me if there are any differences between the colors, especially the greens I use; they should be the same."

**They are the same.** Kit-final palette vs `Nostos.Frontend/src/styles.css`:

| Role | Kit Final | Nostos token | Match |
| --- | --- | --- | --- |
| Pine (brand green) | `#28372D` | `--color-primary`, `--primary-ink`, `--primary-fill` = `#28372D` | **identical** |
| Clay (accent) | `#8A6D58` | `--color-accent` = `#8A6D58` | **identical** |
| Paper | `#FDF8F6` | `--bg-body` = `#FDF8F6` | **identical** |
| Ink | `#1C1B1A` | `--color-text-main` = `#1C1B1A` | **identical** |
| Muted | `#5C5A55` | `--color-text-muted` = `#5C5A55` | **identical** |
| Border | `#E4E1DB` (from v1 kit) | `--border-color` = `#E4E1DB` | **identical** |

**Conclusion: no colour alignment work is required. Step "align colors if needed" resolves to a no-op.**

### 0.3 But your *logo artwork* is currently painted in the OLD colours

This is the real colour finding, and it is inside the images, not the tokens:

| | Kit Final + UI | Live logo artwork | Δ (ΔE76) | Visible? |
| --- | --- | --- | --- | --- |
| Brand green | `#28372D` | `--brand-shape: #293E32` | **3.8** | Only side-by-side |
| Doorway clay | `#8A6D58` | `--brand-doorway: #A07859` | **9.3** | Yes |

`styles.css:39-40` (`--brand-shape` / `--brand-doorway`) are the only two green/clay values in the whole repo that do not match the kit. They exist to colour the sidebar's inline SVG mark. Both get corrected as part of the logo swap — see Task 4.

### 0.4 This is a re-trace, not just a recolour

The symbol **geometry changed**. Measured on the 2048px masters, bbox-normalised:

- outline silhouette IoU (new vs old) = **0.8445**, i.e. ~11.6% of the silhouette differs
- the doorway cut-out is near-identical (IoU 0.9632)

So the mark is the same idea, cleaned up — the visible change is the outer silhouette, and it is subtle. The accepted final raster is a **flat 3-colour file** (`#28372D`, `#8A6D58`, transparent) traced from that approved source, so every asset in the kit is internally consistent.

### 0.5 One real defect in the kit's web assets: the favicon

`03_App_Web/favicon.svg` is the **bare mark** (pine, no tile). Against dark browser chrome:

- pine `#28372D` on dark tab bar `#2B2B2B` = **1.13:1 → effectively invisible**

Nostos already solved this (`favicon-light.svg` / `favicon-dark.svg` via `prefers-color-scheme`, commit `f96b924`). Adopting the kit's favicon naively would regress a fixed bug. Task 3 covers the fix. This is also what the row-3 DARK-chrome cell demonstrates in the attached comparison sheet.

### 0.6 Icon sizing in the new kit is larger than what ships today

Mark width as a fraction of canvas:

| Asset | Live | Kit Final |
| --- | --- | --- |
| `apple-touch-icon.png` (180) | 40.6% | **57.8%** |
| `pwa-192.png` | 40.6% | **57.8%** |
| `maskable-512.png` | 40.2% | **47.1%** |

`maskable-512` at 47.1% sits comfortably inside the maskable safe circle (needs ≤80%), so it is correct as shipped. The app-icon/apple-touch jump to ~58% is a visible size change on home screens — flagging it as intentional, not a defect.

### 0.7 The lockups introduce a wordmark that Nostos does not currently use anywhere

`01_Master_Vector/nostos-logo-horizontal-*.svg` render a **serif "Nostos"** lockup (I rendered the SVGs and inspected them; counters are clean, `o` holes are open, so the paths are fine). 4 colour variants exist: `fullcolor`, `pine`, `black`, `white`.

**No lockup is referenced anywhere in the repo today** — the app uses text (`<span class="brand">Collections</span>`, `<h1 class="hero-title">Nostos</h1>`) in Newsreader/Hanken Grotesk. Whether to actually start using a lockup is a design decision, not a swap — see Open Question Q1.

---

## 1. Scope

**Confirmed against the request:**

- Change: favicons, logotypes, app/PWA icons.
- Confirm-only: colour alignment (result: nothing to change — 0.2).
- **Forbidden:** any edit to the light/dark mode blocks in `styles.css`, or to any component CSS that participates in the theme.
- Where light and dark assets are needed, supply both variants.

### 1.1 Hard boundaries

1. **Do not touch the dark theme block** `:root[data-theme='dark']` (`styles.css:301-416+`).
2. **Do not touch the light token block** (`styles.css:1-~108`) except the two lines in Task 4 (`--brand-shape`, `--brand-doorway`), which exist solely to colour the logo mark.
3. **Do not touch the one file with uncommitted work in flight:**
   - `src/styles.css` — 7 uncommitted lines, all **inside the dark theme block** (`--danger-ink: #EE8271` around line 363). This is the "porcelain bleached the danger ink to pink" fix.

   The brand edit to `styles.css` is 2 lines in the **light** block (Task 4). The brand commit must stage **only those 2 lines** (`git add -p`) so the dark-block hunk is neither swept in nor discarded. Do not `git checkout`/stash it away — it is live work.

   Two other files that were dirty when this plan was drafted (`book-detail.component.css`, `library.component.css`) have since landed in `2b68936`, so they are no longer a concern.
4. **Never redraw the mark.** Kit rule 5/6: "Do not create a special favicon redraw. Use the master geometry at every size." Every new asset must be generated from the kit's exact `d` path data, never hand-traced.

---

## 2. Where the logotype actually appears (complete inventory)

Verified by repo-wide grep. There are only **three** real surfaces plus the web-icon set.

| # | Surface | File | Current | Change |
| --- | --- | --- | --- | --- |
| 1 | App sidebar mark (in-app, token-driven) | `Nostos.Frontend/src/app/library/sidebar-collections/sidebar-collections.component.html:12-31` | inline SVG, `viewBox="0 0 1254 1254"`, 2 paths (v1 geometry) | swap to kit `0 0 1000 1000` 2 paths |
| 2 | Home hero mark | `Nostos.Frontend/src/app/home/home.component.html:4` | `<img src="nostos-symbol-fullcolor-512.png">` | new PNG, same filename → no template change needed |
| 3 | Browser tab + PWA icons | `Nostos.Frontend/public/*` + `src/index.html:8-27` | `favicon-light.svg`, `favicon-dark.svg`, `favicon.ico`, `apple-touch-icon.png`, `pwa-192/512`, `maskable-512`, `nostos-symbol-fullcolor-128/512.png` | full replacement |
| 4 | Dead template | `src/app/home/home.html` | duplicate of `home.component.html:4` | orphaned (no `templateUrl`) — decide |
| 5 | Backend static output | `Nostos.Backend/wwwroot/*` | built copy | regenerated by the production build (gitignored) |

**Not found anywhere:** logo in `Nostos.Shared`, in backend views/controllers/routes, in the README, or in any `.cs`. No OG/social meta tags exist. `product-roadmap.md:376` lists `manifest.webmanifest` + maskable icons as a to-do — already done in `public/`.

**Also already correct:** `public/manifest.webmanifest` already declares `theme_color: #28372D` and `background_color: #FDF8F6`, exactly matching the kit's `manifest-snippet.json`. Only the icon files underneath it change.

**e2e:** no test asserts the favicon, logo, or manifest. `e2e/test-results/*.log` shows the backend serving `/favicon.ico`, `/manifest.webmanifest`, `/nostos-symbol-fullcolor-128.png` — so the filenames are load-bearing and must be preserved.

---

## 3. Tasks

### Task 1: Build the asset manifest and stage the kit

**Objective:** copy the final kit into a versioned repo location and produce the exact file-mapping list.

**Files:**
- Create: `_brand-assets/brand-kit-v1/` (tracked; mirrors the existing `_brand-assets/` convention)
- Create: `_brand-assets/brand-kit-v1/FILE-MAP.md`

**Steps:**

1. Verify the final kit's integrity before importing anything:
   ```bash
   cd /tmp/brandkit/Nostos_Brand_Kit_Final
   for f in 01_Master_Vector/*.svg; do echo -n "$f: "; grep -c '<path' "$f"; done
   # expect: symbol-*.svg = 2 paths, logo-horizontal-*.svg = 8 paths
   ```
2. Copy the kit: `cp -r /tmp/brandkit/Nostos_Brand_Kit_Final _brand-assets/brand-kit-v1/source/`
3. Write `_brand-assets/brand-kit-v1/FILE-MAP.md` recording: kit version, the 5 core hexes, and for each Nostos path → which kit file it came from + the sha256 of the kit source. This is the anti-drift record.
4. Commit the kit assets alone (no code): `git add _brand-assets/brand-kit-v1 && git commit -m "chore(brand): vendor the final Nostos brand kit v1"`

---

### Task 2: Extract the canonical path data once

**Objective:** every downstream asset and template is generated from one extraction, so the favicon, sidebar and lockups cannot drift apart.

**Files:**
- Create: `Nostos.Frontend/scripts/extract-brand-paths.mjs`
- Output: `_brand-assets/brand-kit-v1/paths.json`

**Steps:**

1. Script reads `nostos-symbol-pine.svg` (1 path) and `nostos-symbol-fullcolor.svg` (2 paths, pine `#28372D` + clay `#8A6D58`) and writes:
   ```json
   {
     "viewBox": "0 0 1000 1000",
     "shape":   "M 269.53,156.96 L ...",
     "doorway": "M 642.53,293.21 L ...",
     "pine": "#28372D",
     "clay": "#8A6D58"
   }
   ```
2. Run it; assert the `shape` path's `d` is byte-identical to what `01_Master_Vector/nostos-symbol-pine.svg` contains (a guard against the extractor mangling whitespace).
3. Commit.

**Verify:** `node -e "console.log(require('./_brand-assets/brand-kit-v1/paths.json').viewBox)"` → `0 0 1000 1000`.

---

### Task 3: Web icons in `public/` — including regenerating the scheme-aware favicons

**Objective:** replace the icon set with the new geometry while **keeping** the light/dark tab-chrome fix.

**Files:**
- Modify/replace in `Nostos.Frontend/public/`: `favicon.ico`, `apple-touch-icon.png`, `pwa-192.png`, `pwa-512.png`, `maskable-512.png`, `nostos-symbol-fullcolor-128.png`, `nostos-symbol-fullcolor-512.png` — straight copies from kit `03_App_Web/` and `02_PNG/Symbol/fullcolor/`
- **Regenerate** `favicon-light.svg` and `favicon-dark.svg` from `paths.json` (do not take the kit's `favicon.svg`)
- Delete: nothing (all filenames are referenced by `index.html` / the manifest / e2e logs)
- Modify: `Nostos.Frontend/src/index.html:8-27`

**Steps:**

1. Copy the kit's binary icons over the live ones, preserving filenames:
   - `favicon.ico` ← `03_App_Web/favicon.ico`
   - `apple-touch-icon.png` ← `03_App_Web/apple-touch-icon.png`
   - `pwa-192.png` ← `03_App_Web/pwa-192.png`
   - `pwa-512.png` ← `03_App_Web/pwa-512.png`
   - `maskable-512.png` ← `03_App_Web/maskable-512.png`
   - `nostos-symbol-fullcolor-128.png` / `-512.png` ← `02_PNG/Symbol/fullcolor/nostos-symbol-fullcolor-128.png` / `-512.png`
   - Note: live `pwa-512.png` and `maskable-512.png` are currently the **same file** (both sha `45…`, 45654 bytes) — that was a packaging bug; the kit ships them as distinct assets. Keep them distinct.
2. Regenerate `favicon-light.svg` to match the existing (working) behaviour with the **new** geometry: bare mark on transparent, `shape` = `#28372D`, `doorway` = `#8A6D58`, `viewBox="0 0 1000 1000"`. Contrast on light chrome: 11.10:1.
3. Regenerate `favicon-dark.svg`: same two paths scaled into a 64×64 canvas over `<rect width="64" height="64" rx="14" fill="#FDF8F6"/>`. Tile-vs-dark-chrome = 13.44:1. Keep `role="img"` + `<title>`/`<desc>` for the a11y treatment already present.
   - Scale factor: keep the old asset's convention (mark occupying ~75% of the canvas height). Old: mark `1254→64` units at `translate(8 8) scale(0.03828)`. New: compute the equivalent for a `1000`-unit viewBox so the mark lands at the same optical size.
4. `index.html`: **do not change** the `theme-color` `#28372D` (matches the kit). Keep the two scheme-aware `<link rel="icon">` blocks and the `.ico` fallback exactly as they are — they now point at regenerated files, and the existing explanatory comment should be updated to say "final kit geometry" rather than "improved brand kit".
5. Confirm the mark is not clipped in the dark tile by rasterising and measuring the ink bbox at 16/32/48px.

**Verify:**
```bash
cd Nostos.Frontend/public
# filenames all still present
ls favicon.ico favicon-light.svg favicon-dark.svg apple-touch-icon.png \
   pwa-192.png pwa-512.png maskable-512.png \
   nostos-symbol-fullcolor-128.png nostos-symbol-fullcolor-512.png
# pwa-512 and maskable-512 are now actually different
[ "$(sha256sum pwa-512.png | cut -c1-16)" != "$(sha256sum maskable-512.png | cut -c1-16)" ] && echo distinct-ok
# the new SVGs contain the kit geometry, not the old one
grep -c 'M 269.53,156.96' favicon-light.svg favicon-dark.svg   # expect 1 each
grep -c 'M 850 248'       favicon-light.svg favicon-dark.svg   # expect 0 each (old geometry gone)
```

---

### Task 4: In-app sidebar mark

**Objective:** the sidebar mark uses the new geometry and the kit's exact green/clay.

**Files:**
- Modify: `Nostos.Frontend/src/app/library/sidebar-collections/sidebar-collections.component.html:12-31`
- Modify: `Nostos.Frontend/src/styles.css:39-40` — **light block only, 2 lines**

**Steps:**

1. In the template, replace the two hardcoded `d` attributes and the `viewBox` with the values from `paths.json`:
   - `viewBox="0 0 1000 1000"`
   - `class="brand-icon__shape"` → `/p/` "shape"
   - `class="brand-icon__doorway"` → "doorway"
   Keep `class="brand-icon"`, `role="img"`, `aria-label="Nostos"`, `focusable="false"` untouched.
2. In `styles.css` light block, update only:
   ```css
   --brand-shape: #293E32;   →  --brand-shape: #28372D;
   --brand-doorway: #A07859; →  --brand-doorway: #8A6D58;
   ```
3. Leave the dark overrides at `styles.css:337-338` (`#EDEEF2` porcelain / `#D1AC8F` smoked warm). **The dark mark is a deliberate design decision** — porcelain arch, chosen over mint — and is unaffected by the kit.
4. Update the comment at `styles.css:36-38` to say the mark now follows the final kit's Pine/Clay flats.
5. Do **not** touch `sidebar-collections.component.css` (`.brand-icon*` rules are size/fill wiring only; `fill: var(--brand-shape)` keeps working).

**Verify:**
```bash
cd Nostos.Frontend && npm run check:theme
# expect exit 0 — no colour token may be left without a dark counterpart
```
Then render the sidebar in both themes and confirm the mark changed and nothing else did (Task 8).

---

### Task 5: Home hero mark

**Objective:** the hero uses the new mark.

**Files:**
- `src/app/home/home.component.html:4` — **already correct**, it points at `nostos-symbol-fullcolor-512.png`, which Task 3 replaces. No template edit.
- `src/app/home/home.component.css` — sizing only (`#nostos-logo { width: 140px }`, `110px` on mobile) → **no change**
- Decide: `src/app/home/home.html` — an orphaned duplicate (no `templateUrl` references it; only `home.component.html` is bound). Recommend **deleting** it in a separate, clearly-labelled commit so the change is reversible and not confused with the brand swap.

**Verify:** hero renders the new mark at the same 140px/110px sizing; `git diff` for `home.component.css` is empty.

---

### Task 6: Service-worker / cache invalidation

**Objective:** the new tab icon actually reaches a device that has already loaded Nostos.

**Why:** `Nostos.Frontend/package.json` has an `e2e/service-worker-navigation.spec.ts`; the app is a standalone PWA. A cached `favicon.ico`/`apple-touch-icon.png` on an existing profile will mask the change, and `index.html` itself may come from the SW.

**Steps:**

1. Inspect `ngsw-config.json` (or the equivalent) and confirm whether the icon assets are in a cached asset group.
2. Determine whether the existing cache-busting/versioning mechanism is sufficient (Angular hashes its bundles, but `public/` assets are served by raw filename and do **not** get a content hash).
3. If needed, bump the SW version so the new icons are fetched. Prefer the smallest native change — do not rewrite the SW config.
4. Verify no stale-asset path exists for `favicon.svg`/`.ico`/`apple-touch-icon.png`.

**Verify:** run the app, hard-reload, confirm `GET /favicon.ico` returns the new byte length; in DevTools confirm no `(from disk cache)` for the icon.

---

### Task 7: Build and publish

**Files:** `Nostos.Backend/wwwroot/*` (gitignored — `git ls-files` = 0; `.gitignore:9`)

**Steps:**

1. `cd Nostos.Frontend && npm run build`
2. `cd .. && npm run build:frontend` if the root wrapper is what performs the wwwroot copy — confirm which path does the copy.
3. Confirm the built `wwwroot` contains the new icons:
   ```bash
   ls -la Nostos.Backend/wwwroot/favicon*.{svg,ico} Nostos.Backend/wwwroot/apple-touch-icon.png
   sha256sum Nostos.Backend/wwwroot/favicon.ico Nostos.Frontend/public/favicon.ico  # must match
   ```
4. **Back up before publishing** (house pattern — `~/backups/nostos-wwwroot-pre-*-deploy-*.tgz` exists for prior deploys):
   ```bash
   tar czf ~/backups/nostos-wwwroot-pre-brandkit-v1-$(date +%Y%m%d-%H%M%S).tgz -C Nostos.Backend wwwroot
   ```
5. **Ask before restarting the backend.** The backend runs as a plain `dotnet run -c Release` (pid 1597852, listening 0.0.0.0:5214), *not* pm2 (`pm2 list` is empty). Restarting means kill + relaunch, which rebuilds — ask first per the standing rule.
6. Static assets under `wwwroot` are served from disk, so a restart may not even be required for the icons; confirm by curling the live port before deciding to restart.

---

### Task 8: Verification (the part that actually proves it)

**A. Automated gates — must all pass, and the theme must be provably untouched:**
```bash
cd Nostos.Frontend
npm run check:theme                 # theme token graph complete
npx ng build                        # compiles
npm test                            # 24 spec files
npx playwright test                 # incl. visual-regression.spec.ts
```

**B. Prove dark mode is byte-identical:**
```bash
git diff Nostos.Frontend/src/styles.css | grep -E '^\+' | grep -E '#' 
# every added hex line must be one of the 2 brand lines from Task 4.
# Nothing from the `:root[data-theme='dark']` block may appear in the diff.
git diff --stat Nostos.Frontend/src/styles.css   # expect ~3 changed lines
```

**C. Prove the served bytes are the kit's bytes:**
```bash
for f in favicon.ico apple-touch-icon.png pwa-192.png pwa-512.png maskable-512.png; do
  echo -n "$f "; curl -so /tmp/served_$f http://localhost:5214/$f && \
  sha256sum /tmp/served_$f Nostos.Frontend/public/$f | awk '{print $1}' | uniq | wc -l
done   # expect 1 (i.e. served == public) for each
curl -s http://localhost:5214/manifest.webmanifest | head
```

**D. Picture proof, both themes — you asked for the light/dark variants to be used where needed:**
Capture and attach, as before/after:
1. sidebar mark — light theme
2. sidebar mark — dark theme
3. home hero — light and dark
4. the browser tab on **light** chrome and on **dark** chrome (this is the one the kit regresses if Task 3 is done naively)
5. the installed PWA / home-screen icon

Use the existing `e2e/visual-evidence/` convention so the evidence lives with the code.

**E. Regression sweep of the "untouched" claim:** the final commit's diff must contain only: `_brand-assets/brand-kit-v1/**`, `public/**`, `src/index.html`, `sidebar-collections.component.html`, `styles.css` (2 brand lines), and (if chosen) the `home.html` deletion.

---

## 4. Recommended commit sequence

1. `chore(brand): vendor the final Nostos brand kit v1` — kit only
2. `chore(brand): extract canonical mark path data` — script + `paths.json`
3. `feat(brand): adopt the final kit across web icons and favicons` — `public/**` + `index.html`
4. `feat(brand): re-ink the in-app brand mark from the final kit` — sidebar template + 2 token lines
5. `chore: drop the orphaned home.html duplicate` — only if approved
6. `chore(deploy): publish the new brand assets to wwwroot` — after the backup

---

## 5. Risks / open questions

**Q1 — Do you want the horizontal lockup used anywhere? (needs your answer)**
The kit's `nostos-logo-horizontal-*.svg` render a **serif** "Nostos" wordmark. Nostos currently has **no** lockup in use — the sidebar says "Collections" and the hero renders "Nostos" in the UI font (Newsreader serif for editorial, Hanken Grotesk for UI). Options: (a) adopt nothing, icons only; (b) use the full-colour lockup on the home hero instead of the h1 + separate mark; (c) use the white lockup somewhere dark. This is a real design choice and I do not want to guess it.

**Q2 — Favicon approach.** Recommend the scheme-aware regeneration in Task 3 (keeps your fixed dark-chrome behaviour + new geometry). The alternative — take the kit's flat `favicon.svg` as-is — is simpler but the icon is invisible on a dark tab bar (1.13:1). Confirm you want the regeneration.

**Q3 — `home.html` orphan.** Delete it, or leave it? It is dead code, not a logo surface, so it is arguably out of scope.

**R1 — App-icon size jump.** Home-screen icons go from ~41% to ~58% mark coverage. Intentional per the kit, but visible. Say if you want the old optical padding preserved instead.

**R2 — Icon assets are unhashed.** `public/` assets are served by raw filename with no content hash, so the SW/cache question in Task 6 is real. Worst case is a stale tab icon, not a broken app.

**R3 — Uncommitted work in flight.** `styles.css` has 7 uncommitted lines, all in the **dark** block (`--danger-ink`, the pink-trash-icon fix). The brand change adds 2 lines to the **light** block. Stage with `git add -p` so the dark hunk is neither swept into the brand commit nor lost.

**R4 — The kit's other 60-odd files are not needed.** `02_PNG/**` (all size ramps), `01_Master_Vector/*.pdf`, and the whole `Nostos_Brand_Kit_v1/` tree have no consumer in this repo. Vendoring all of it (Task 1) bloats the repo by ~3.5MB; vendoring only the used subset is leaner. Your call — I'd vendor the masters + a README and skip the redundant PNG ramps.

---

## 6. What I did NOT do

As instructed, this is a plan only. No repo file was created, modified, or deleted; no build ran; no process was restarted; nothing was committed. All inspection was read-only, and the extraction/rendering happened in `/tmp/brandcmp` and `/tmp/brandkit`.
