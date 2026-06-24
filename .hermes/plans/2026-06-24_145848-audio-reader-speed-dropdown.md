# Audio Reader Speed Dropdown Implementation Plan

> **For Hermes:** Execute directly in the Nostos Rebirth repo after user approval; no subagent needed for this small UI-only change.

**Goal:** Replace the audio reader's stacked playback speed buttons with a polished dropdown that matches Nostos' existing minimalist controls.

**Architecture:** Keep the audio playback model unchanged. Replace the template's `@for` button group with a native `<select>` bound to the existing `currentRate` signal and `setRate()` behavior, then restyle the control locally in the audio reader CSS using the app's existing design tokens.

**Tech Stack:** Angular 21 standalone component, strict templates, Howler audio playback, PM2-managed .NET/Angular production app.

---

## Scout Notes

- Repo: `/home/dev/coding/projects/nostos-rebirth`
- Branch state: `main...origin/main`; existing local modification only in `ecosystem.config.js`.
- Important existing change to preserve: `ecosystem.config.js` already points PM2 cwd to `/home/dev/coding/projects/nostos-rebirth`; do not overwrite or reformat it.
- Running app: PM2 process `nostos`, id `4`, cwd `/home/dev/coding/projects/nostos-rebirth`, command `npm run prod`, served on `0.0.0.0:5214`.
- PM2 caveat: Hermes shell has `HOME=/home/dev/.hermes/home`, so plain `pm2` sees an empty PM2 home. Use `PM2_HOME=/home/dev/.pm2 pm2 ...` for the real Nostos process.
- User's `stat` command resolves to `/usr/bin/stat` in this non-interactive Hermes shell, not the custom dashboard script. PM2 is the reliable restart path here.
- Current audio reader route verified at `http://127.0.0.1:5214/read/9acb58cb-c89f-429e-8043-8fbd43199cb6`.
- Current issue observed: speed controls are individual `0.75x`/`0.9x`/`1x`/`1.25x`/`1.5x` buttons inside a wrapping pill and are visually cramped/clipped near the bottom toolbar.

---

## Files to Modify

- Modify: `/home/dev/coding/projects/nostos-rebirth/Nostos.Frontend/src/app/reader/audio-reader/audio-reader.component.html:57-66`
- Modify: `/home/dev/coding/projects/nostos-rebirth/Nostos.Frontend/src/app/reader/audio-reader/audio-reader.component.css:214-293`
- Modify: `/home/dev/coding/projects/nostos-rebirth/Nostos.Frontend/src/app/reader/audio-reader/audio-reader.component.ts:187-203`

No backend changes expected.

---

## Implementation Steps

### Task 1: Replace speed button group with a select

**Objective:** Render one compact dropdown instead of five buttons.

**Change:** In `audio-reader.component.html`, replace `.rate-options` and `.rate-btn` loop with:

- `<label class="rate-label" for="audio-rate-select">Speed</label>`
- `<div class="rate-select-wrap">`
- `<select id="audio-rate-select" class="rate-select" [ngModel]="currentRate()" (ngModelChange)="setRate($event)" aria-label="Playback speed">`
- `@for (rate of availableRates; track rate) { <option [ngValue]="rate">{{ rate }}x</option> }`

**Notes:** Use native select for accessibility and mobile behavior. Keep the list of rates from `availableRates`.

### Task 2: Bind the select to numeric playback rates

**Objective:** Keep the dropdown selected state and Howler playback rate synchronized as numbers.

**Change:** In `audio-reader.component.ts`:

- Add `1.1` to `availableRates`.
- Keep `setRate(rate: number)` as the single source of truth for Howler and Media Session state.
- Use Angular `ngModel` / `ngValue` in the template so the selected option stays aligned with `currentRate()`.

**Notes:** Leave `setRate(rate: number)` as the single source of truth so Howler rate and Media Session state stay synchronized.

### Task 3: Restyle speed control as a compact Nostos pill dropdown

**Objective:** Make it fit the current app style: soft surface, subtle border, Inter typography, rounded pill, muted label, black active text, custom chevron.

**Change:** In `audio-reader.component.css`:

- Keep `.rate-selector` centered and vertical, but reduce bottom footprint.
- Remove obsolete `.rate-options`, `.rate-btn`, `.rate-btn:hover`, `.rate-btn.active` styles.
- Add `.rate-select-wrap` for a subtle raised container.
- Add `.rate-select` with `appearance: none`, rounded border, app CSS variables, `font-variant-numeric: tabular-nums`, custom SVG chevron, hover/focus states.
- Add mobile-safe width rules so it stays one control and never wraps into stacked buttons.

### Task 4: Build validation

**Objective:** Prove the Angular template and CSS compile.

Run:

```bash
cd /home/dev/coding/projects/nostos-rebirth/Nostos.Frontend
npm run build
```

Expected: Angular production build succeeds. If CSS budget warnings appear but build passes, report them; if build fails, fix the actual template/type/style error.

### Task 5: Restart production app via PM2

**Objective:** Deploy the frontend change into the running app.

Run:

```bash
PM2_HOME=/home/dev/.pm2 pm2 restart nostos --update-env
```

Expected: `nostos` returns online.

### Task 6: Runtime verification

**Objective:** Confirm the restarted app is serving and the audio reader now exposes a dropdown.

Run/check:

```bash
PM2_HOME=/home/dev/.pm2 pm2 describe nostos
ss -ltnp | grep -E ':5214' || true
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5214/
```

Then inspect in browser:

- Open `http://127.0.0.1:5214/read/9acb58cb-c89f-429e-8043-8fbd43199cb6`
- Snapshot should show one `combobox` for playback speed, not five speed buttons.
- Change speed to `1.25x`; verify the select value updates and no console errors appear.

---

## Risks / Guardrails

- Do not touch `ecosystem.config.js`; it has a pre-existing local change unrelated to this UI task.
- Do not use plain `pm2` without `PM2_HOME=/home/dev/.pm2`, or it will target the wrong empty PM2 daemon.
- Use native select rather than a custom popover unless the user asks; it is smaller, accessible, mobile-friendly, and avoids adding dropdown state management.
- If `npm run build` triggers the backend-linked frontend build only through Release, run the frontend build directly first; the PM2 restart's `npm run prod` will rebuild Release on process start.
