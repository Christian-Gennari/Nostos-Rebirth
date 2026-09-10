# Glass & Pastel Personality Pass — Task Prompt

## Context

The `styles.css` root now includes these shared design tokens:

```
--glass-bg: rgba(255, 255, 255, 0.55);
--glass-bg-strong: rgba(255, 255, 255, 0.82);
--glass-border: rgba(255, 255, 255, 0.65);
--glass-blur: blur(16px);
--glass-blur-strong: blur(24px);
--pastel-blue: #a8c0ff;
--pastel-lavender: #c4a8ff;
--pastel-pink: #ffafcc;
--pastel-peach: #ffc8a2;
--pastel-sky: #bde0fe;
--gradient-pastel: linear-gradient(120deg, var(--pastel-blue), var(--pastel-lavender), var(--pastel-pink), var(--pastel-peach));
--gradient-pastel-soft: linear-gradient(120deg, rgba(168,192,255,0.4), rgba(196,168,255,0.4), rgba(255,175,204,0.4));
--gradient-accent: linear-gradient(120deg, var(--pastel-lavender), var(--pastel-pink));
--shadow-glass: 0 8px 24px -6px rgba(80, 70, 140, 0.13), 0 2px 6px rgba(0, 0, 0, 0.04);
--shadow-glass-lg: 0 16px 36px -8px rgba(80, 70, 140, 0.18), 0 4px 10px rgba(0, 0, 0, 0.05);
--shadow-glow: 0 6px 20px -4px rgba(196, 168, 255, 0.45);
```

Also:
- `.glass-panel` utility: applies `--glass-bg-strong`, `--glass-blur`, `--glass-border`, `--shadow-glass`
- `.gradient-edge` utility: shows a pastel gradient hairline border on hover/active
- `body` background has soft pastel radial gradients fixed behind everything

The floating dock already fully embraces the Apple Glass aesthetic with conic-gradient rainbow glow, translucent glass, expanding hover. DO NOT touch the dock component (app-dock.component.ts) at all.

## Goal

Bring the Apple Glass / pastel personality into 6 component CSS files. The changes should be **CSS-only** — no Angular template (.html) or TypeScript (.ts) changes. Every surface should feel like it belongs in the same app as the glowing dock.

## Rules

1. **CSS ONLY.** Do not modify any `.ts`, `.html`, `angular.json`, or other files.
2. **Do not touch** `app-dock.component.ts` or `app-dock.component.css` — the dock is already perfect.
3. Use the design tokens from `styles.css` (e.g. `var(--glass-bg)`, `var(--shadow-glass)`, etc.)
4. Do NOT break existing layout structures, grid definitions, or responsive breakpoints.
5. Keep all existing functionality — hover states, active states, transitions.
6. Make changes feel warm and layered, not heavy or overdone. Subtlety is key.

## Changes Per File

### 1. `src/app/library/library.component.css`

**Toolbar** (`.toolbar`):
- Change background from `color-mix(in srgb, var(--bg-surface) 90%, transparent)` to `var(--glass-bg-strong)`
- Add `backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur);`
- Change `border-bottom` to `border-bottom: 1px solid var(--glass-border);`

**Search input** (`.search-input`):
- On `:focus`, add `box-shadow: 0 0 0 3px rgba(196, 168, 255, 0.2);` (lavender focus ring)

**Active view toggle** (`.toggle-opt.active`):
- Change `box-shadow` to `var(--shadow-sm), 0 0 0 1px rgba(196, 168, 255, 0.3);`

**Book cards on hover** (`.book-card:hover .cover-wrapper`):
- Change `box-shadow` from `0 12px 24px rgba(0, 0, 0, 0.08)` to `var(--shadow-glass-lg)`

**Note card grid cards** (`.note-card` in second-brain, already addressed below)

**List view row hover** (`.table-row:hover`):
- Change `background` to `var(--glass-bg);`

### 2. `src/app/home/home.component.css`

**Hero wrapper** (`.hero-wrapper`):
- Change `background: var(--bg-body)` to `background: transparent;` (let body's pastel wash show through)

**Hero divider** (`.hero-divider`):
- Replace `background: var(--color-primary); opacity: 0.2;` with `background: var(--gradient-pastel); opacity: 0.6; height: 2px;` (pastel gradient divider, slightly taller)

**CTA button** (`.btn.btn-primary.lg`):
- Change `box-shadow` to `var(--shadow-glass), 0 0 16px -4px rgba(196, 168, 255, 0.4);`
- On `:hover`, change to `var(--shadow-glass-lg), 0 0 24px -4px rgba(196, 168, 255, 0.5);`

**Logo** (`#nostos-logo`):
- Change `filter` to `drop-shadow(0 8px 24px rgba(196, 168, 255, 0.25));` (lavender tinted shadow)

### 3. `src/app/settings/settings.component.css`

**Settings cards** (`.settings-card`):
- Change `box-shadow` to `var(--shadow-glass);`
- Change `border` to `1px solid var(--glass-border);`

**Card header** (`.card-header`):
- Change `background` to `var(--glass-bg);`
- Change `border-bottom` to `1px solid var(--glass-border);`

**Toggle checked** (`.toggle input:checked + .toggle-slider`):
- Add a rule beneath it: give the slider a subtle glow: `box-shadow: 0 0 10px rgba(196, 168, 255, 0.35);`

**Progress bar fill** (`.progress-bar-fill`):
- Change `background` to `var(--gradient-pastel);` (pastel gradient progress)

### 4. `src/app/second-brain/second-brain.component.css`

**Index column** (`.index-col`):
- Change `background: var(--bg-surface)` to `background: var(--glass-bg-strong);`
- Add `backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur);`
- Change `border-right` to `1px solid var(--glass-border);`

**Active index item** (`.index-item.active`):
- Change `box-shadow` to `var(--shadow-sm), var(--shadow-glow);` — adds soft lavender glow

**Note cards** (`.note-card`):
- Change `box-shadow` to `var(--shadow-glass);`
- Change `border` to `1px solid var(--glass-border);`

**Note card hover** (`.note-card:hover`):
- Change `box-shadow` to `var(--shadow-glass-lg);`

**Quote block** (`.highlight-block`):
- Change `border-left: 3px solid var(--color-primary)` to `border-left: 3px solid var(--pastel-lavender);`
- Change `background` to `rgba(196, 168, 255, 0.08);` (faint lavender tint)

**Content column** (`.content-col`):
- Change `background-color: var(--bg-body);` to `background-color: transparent;`

**Icon circle in landing** (`.icon-circle`):
- Change `background` to `var(--gradient-pastel-soft);`
- Add `box-shadow: 0 4px 12px rgba(196, 168, 255, 0.2);`

### 5. `src/app/book-detail/book-detail.component.css`

**Cover frame** (`.cover-frame`):
- Change `box-shadow` to `var(--shadow-glass-lg), 0 0 40px -12px rgba(196, 168, 255, 0.3);`

**Edition cards active** (`.edition-select-card.active`):
- Change `box-shadow` to `0 0 0 1px var(--color-primary), var(--shadow-glow);` (add lavender glow)

**Edition section** (`.edition-section`):
- Change `border` to `1px solid var(--glass-border);`

**Status chips** — keep as-is, they're functional indicators.

**Reset confirm dialog** (`.reset-confirm-dialog`):
- Change `box-shadow` to `var(--shadow-glass-lg);`
- Change `border` to `1px solid var(--glass-border);`

### 6. `src/app/writing-studio/writing-studio.component.css`

Read the file first. Apply these patterns:
- Any panel sidebar backgrounds → use `var(--glass-bg-strong)` with `backdrop-filter: var(--glass-blur);`
- Any `border: 1px solid var(--border-color)` on panels → use `var(--glass-border)`
- Any `box-shadow: 0 1px 3px rgba(0,0,0,...)` on cards → use `var(--shadow-glass)`
- The icon circle or empty-state circle → use `var(--gradient-pastel-soft)`
- Keep all existing layout and responsive rules intact

## Verification

After making all changes, run `npx ng build` from `Nostos.Frontend/` and verify 0 errors.
Do NOT run tests — CSS-only changes don't need them.

## Summary

You are bringing warmth and depth to every surface. The dock is already radiant glass; now panels should feel like frosted glass too (lighter, more subtle), cards should have purple-tinted depth shadows, focus rings should glow lavender, progress bars should be gradient, and empty-state circles should pulse with pastel color. Subtle, cohesive, alive.
