# Library = source of truth. Copy, do not invent.

The Brain page is not a new design; it is the same app. Every control whose
equivalent exists in the Library must use the Library's **exact** geometry,
colour roles and motion. Divergence is a bug.

Verbatim values extracted from `library.component.css` and
`library/sidebar-collections/sidebar-collections.component.css`.

## Radii — use these, nothing else

| token | value | used for |
|---|---|---|
| `--radius-sm` | **3px** | small inner elements |
| `--radius-md` | **4px** | search input, sort select, toolbar control-group |
| `--radius-lg` | **6px** | — |
| nav row / pill | **8px** | sidebar `nav-item` and its `::before` pill |

There is **no** `--radius-full` token. Library filter chips hardcode `999px`.
Do not reach for `--radius-lg` (6px) on a control — Library uses `--radius-md`
(4px) for both the search input and the sort select.

## Sidebar row (`nav-item`) — the selected state

```css
.nav-item {
  position: relative; z-index: 0;           /* own stacking ctx for the pill */
  display: flex; align-items: center; gap: 0.65rem;
  width: 100%; padding: 0.45rem 0.75rem;
  border: none; background: transparent;
  border-radius: 8px;
  color: var(--color-text-muted);
  font-family: 'Hanken Grotesk', sans-serif;
  font-size: 0.88rem; font-weight: 500; letter-spacing: -0.01em;
  transition: color 0.12s ease;
}
/* The pill is a PSEUDO-ELEMENT, so geometry can morph without moving the icon. */
.nav-item::before {
  content: ''; position: absolute; z-index: -1;
  top: 50%; left: 0; width: 100%; height: 100%;
  transform: translateY(-50%);
  border-radius: 8px; background: transparent;
  transition: background-color 0.12s ease;
}
.nav-item:hover { color: var(--color-text-main); }
.nav-item:hover::before { background: var(--bg-hover); }

.nav-item.active { color: var(--on-primary); }
.nav-item.active::before {
  background: var(--primary-fill);           /* SURFACE role, never --color-primary */
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
```

Dark theme override for the selected pill lives in `styles.css` and targets
`.index-item.active` too, so keep that class name.

### Count badge

```css
.nav-item .count-badge {
  margin-left: auto; min-width: 20px; height: 20px; padding: 0 6px;
  border-radius: 999px; background: var(--bg-hover);
  color: var(--color-text-light);
  font-size: 0.72rem; font-weight: 500; line-height: 1;
}
```
Dark active: `:root[data-theme='dark'] .nav-item.active .count-badge` →
`color: var(--on-primary); background: rgba(0,0,0,0.28)`.

## Search input

```css
.search-bar-container { position: relative; display: flex; align-items: center; }
.search-icon {                             /* ABSOLUTE — see note */
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  color: var(--color-text-light); pointer-events: none; z-index: 1;
  transition: color 0.2s ease;
}
.search-input {
  width: 100%;
  padding: 0.6rem 1rem 0.6rem 2.5rem;      /* 2.5rem left gutter for the icon */
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);          /* 4px */
  font-size: 0.9rem;
  background: var(--bg-surface);
  transition: all 0.2s ease;
  color: var(--color-text-main);
}
.search-input::placeholder { color: var(--color-text-light); }
.search-input:hover { border-color: var(--border-color); background: var(--bg-surface-alt); }
.search-input:focus {
  background: var(--bg-surface);
  border-color: var(--border-focus);
  outline: none;
  box-shadow: 0 0 0 3px var(--color-accent-faint);   /* the focus treatment */
}
.search-bar-container:has(.search-input:focus) .search-icon { color: var(--color-text-main); }
```

**The icon must be absolutely positioned and the input must own the padding.**
As a flow sibling, the icon's 18px box pushes the visible input ~9px off centre
and the border you see is not the box you centred. This was a real measured bug.

## Sort select

```css
.select-wrapper { position: relative; min-width: 140px; }
.sort-select {
  width: 100%;
  padding: 0.6rem 2rem 0.6rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);          /* 4px */
  font-size: 0.9rem; cursor: pointer;
  color: var(--color-text-muted);
  background-color: var(--bg-input);
  outline: none; appearance: none;
  transition: all 0.2s ease;
  /* chevron as a background-image, NOT a positioned <lucide-icon> sibling */
  background-image: url('data:image/svg+xml;…');
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
  background-size: 1em;
}
.sort-select:hover { background-color: var(--bg-hover); }
```
The chevron is a data-URI background, so the select needs no wrapper element and
the text can never collide with it. A positioned icon sibling is what produced
the "weird border issues" — the wrapper's border and the inner control's border
both painted.

## List/grid toggle

```css
.control-group {                 /* the container */
  display: flex; background: var(--bg-hover);
  padding: 3px; border-radius: var(--radius-md); gap: 2px;
}
.toggle-opt {
  background: 0 0; border: none; padding: 4px 6px;
  border-radius: var(--radius-sm);           /* 3px */
  cursor: pointer; color: var(--color-text-light);
  display: flex;
}
.toggle-opt:hover { color: var(--color-text-main); }
.toggle-opt.active {
  background: var(--bg-surface);
  color: var(--color-primary);
  box-shadow: var(--shadow-sm);
  outline: 1px solid var(--border-color);
  outline-offset: -1px;
}
```
Icons are `[size]="18"` with `strokeWidth="1.5"` in the Library toggle.
The Brain toggle must be markup- and metric-identical.

## Filter chip

```css
.filter-chip {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.3rem 0.4rem 0.3rem 0.75rem;
  font-size: 0.8rem; font-weight: var(--fw-medium);
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-primary) 35%, transparent);
  border-radius: 999px;
  cursor: pointer; transition: background 0.15s ease;
  animation: chip-in 180ms var(--ease-out) both;
}
.filter-chip:hover { background: color-mix(in srgb, var(--color-primary) 22%, transparent); }
@keyframes chip-in { from { opacity: 0; } to { opacity: 1; } }
```

## Buttons — use the global classes, do not hand-roll

`.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-sm`, `.btn-xs`
all live in `src/styles.css`. Reach for those before writing a bespoke button.
Text on a fill uses `--on-primary`; the fill itself is `--primary-fill`.
Destructive uses the `--danger-*` family (`.btn-ghost.danger`).

## Colour roles — the hierarchy I got wrong

- `--color-primary` is **ink** (dim green on dark). Never use it as a surface.
- `--primary-fill` is the **surface** role (dark spruce both themes).
- `--on-primary` is text sitting ON a fill.
- `--border-color` is the hairline. `--border-focus` is the focus border.
- `--color-text-light` is **text**. Never use it as a border (this is what made
  every control wear a dark box).

## Toolbar surface (for reference)

`.toolbar` uses `background: var(--glass-bg-strong)`, `backdrop-filter: var(--glass-blur)`,
`border-bottom: 1px solid var(--glass-border)`, sticky at top, `padding: 1.5rem 3rem`.
