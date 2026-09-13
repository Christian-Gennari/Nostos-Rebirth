# Library = source of truth. Copy, do not invent.

The Brain page is not a new design; it is the same app. Every control whose
equivalent exists in the Library must use the Library's **exact** geometry,
colour roles and motion. Divergence is a bug.

Verbatim values extracted from `library.component.css`,
`library/sidebar-collections/sidebar-collections.component.css` and — for
anything with per-row actions — `ui/flat-tree/flat-tree.component.css`, which is
where the Library's collection rows actually come from.

**Before porting anything, find the component the Library itself uses.** The
collection rows are not bespoke sidebar CSS; they are the shared `app-flat-tree`.
Copying CSS that merely looks similar is how the sidebar drift happened.

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

## Sidebar rows — there are TWO styles. Pick by affordance.

The Library sidebar does not have "a" row style. It has two, and using the
wrong one is a visible bug even though both look plausible in isolation:

| | `.nav-item` | `.tree-row` |
|---|---|---|
| used by | status filters (All Books, In Progress, …) | **collections** (`ui/flat-tree`) |
| radius | **8px** | **6px** |
| fill | painted by a `::before` pill | painted straight onto the row |
| shadow | `0 1px 3px rgba(0,0,0,.08)` | **none** |
| padding | `0.45rem 0.75rem` | `0 8px 0 12px` |
| row actions | none | **hover rename/delete, 22×22, 13px glyphs** |

**Choose by affordance, not by looks.** If the row carries a count *and* hover
rename/delete, it is a `.tree-row` analogue — copy that. `.nav-item` is for a
filter that only toggles a status and has no per-row actions. The Second Brain
index is a collections analogue (count + rename + delete), so it follows
`.tree-row`; copying `.nav-item` gave it a pill and a shadow with no counterpart
and left the actions at 34×32 with 15px glyphs.

### `.tree-row` (collections) — the row with actions

```css
.tree-row {
  display: flex; align-items: center; position: relative;
  height: 34px; margin-bottom: 2px;
  padding-right: 8px; padding-left: 12px;   /* no vertical padding — height is fixed */
  border-radius: 6px;
  color: var(--color-text-muted);
  font-size: 0.88rem; font-weight: 500;
  background: transparent;
  transition: background 0.12s ease, color 0.12s ease, outline-color 0.12s ease;
}
.tree-row:hover { background: var(--bg-hover); color: var(--color-text-main); }
.tree-row.active {
  background: var(--primary-fill);           /* SURFACE role, never --color-primary */
  color: var(--on-primary);
  font-weight: var(--fw-medium);
}
.tree-row:focus-visible {                     /* inset so the 2px gap cannot clip it */
  outline: 2px solid var(--focus-ring); outline-offset: -2px;
}
```

### `.tree-row`'s count badge and hover actions

```css
.count-badge {
  margin-left: auto; min-width: 20px; height: 20px; padding: 0 6px;
  border-radius: 999px; background: var(--bg-hover);
  color: var(--color-text-light);
  font-size: 0.72rem; font-weight: 500; line-height: 1;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}
.tree-row.active .count-badge {
  background: color-mix(in srgb, var(--on-primary) 22%, transparent);
  color: var(--on-primary);
}

/* One slot, shared: the actions are an OUT-OF-FLOW overlay on the badge's slot,
   so the name's truncation point never moves when they appear. */
.node-actions {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  z-index: 2;                                   /* above the ::after fade layer */
  display: flex; align-items: center; justify-content: flex-end;
  gap: 2px; width: calc(76px - 6px);            /* 76px = 3×22 + 2×2 + 6 inset */
  opacity: 0; visibility: hidden; pointer-events: none;
  transition: opacity 0.15s, visibility 0s linear 0.15s;
}
.tree-row:hover .node-actions,
.tree-row:focus-within .node-actions {
  opacity: 1; visibility: visible; pointer-events: auto;
  transition: opacity 0.15s, visibility 0s;
}
.tree-row:hover .count-badge { opacity: 0; }    /* the badge yields the slot */

.action-mini {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; padding: 0; border: none;
  border-radius: 4px; background: transparent;
  color: var(--color-text-muted); flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}
/* On the filled active row the actions sit ON the fill, so their hover ground
   derives from the pill's foreground, not the page's. */
.tree-row.active .action-mini { color: color-mix(in srgb, var(--on-primary) 82%, transparent); }
.action-mini:hover { background: var(--bg-hover); color: var(--color-text-main); }
.tree-row.active .action-mini:hover {
  background: color-mix(in srgb, var(--on-primary) 20%, transparent);
  color: var(--on-primary);
}
.action-mini.danger:hover {
  color: var(--color-danger);
  background: color-mix(in srgb, var(--color-danger) 16%, transparent);
}
```
Icons are `[size]="13"`. On touch there is no hover, so the **selected** row
(`.active`) shows its actions — never all rows at once, which reads as a wall of
icons.

### The name tail fades into the actions

Because the actions are an overlay, they sit ON whatever the name painted. A
row-level `::after` gradient (transparent → the row's own ground) makes the tail
recede into the buttons instead of ending at a hard cut. Anchor the gradient to
the OVERLAY's left edge (`100% - var(--actions-w) - 22px`), not to the name's
right edge — the name box stops earlier on rows that render a badge.

### `.nav-item` (status filters) — for completeness

Same as the table above: `::before` pill at 8px with a shadow, `padding:
0.45rem 0.75rem`, `gap: 0.65rem`, `letter-spacing: -0.01em`. No row actions, so
nothing in the Brain should look like this.

Dark theme override for the selected pill lives in `styles.css` and targets
`.index-item.active` too, so keep that class name.

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
