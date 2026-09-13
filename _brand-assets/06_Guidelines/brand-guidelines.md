# Nostos Brand Mark Guidelines — v1.0

## Source of truth

`01_Primary_Mark/nostos-mark-primary.svg` is the canonical master.

The form is **locked**. Do not redraw it from screenshots and do not independently recreate small-size versions.

## The intentional asymmetry

The outer arch is centered on the icon at **x = 511 / 1024**.

The inner doorway is centered at **x = 468 / 1024**.

That means the doorway is shifted **43 px to the left**, or **4.20% of the full icon width**.

This is deliberate. It creates the visual reading that makes the mark work simultaneously as:

- an open doorway / home threshold;
- a lowercase / abstract `n` for Nostos.

The right side of the arch is therefore intentionally heavier than the left. **Never recenter the inner doorway.**

## Locked geometry

- Canvas: `1024 × 1024`
- Outer container corner radius: `205`
- Outer arch: x `282–740`, top `275`, springline `509`, bottom `764`
- Inner doorway: x `358–578`, top `397`, springline `509`, bottom `764`
- Doorway center offset: `-43 px`

## Primary colors

- Forest: `#293E32`
- Paper: `#FDF8F6`
- Ink: `#1C1B1A`
- Clay accent: `#A07859`

The primary logo is **Forest container + Paper arch**.

Clay is a supporting brand accent, not a substitute for the primary logo unless a future brand decision explicitly changes that.

## Typography

Nostos already uses:

- **Hanken Grotesk** — interface and sans-serif brand typography
- **Newsreader** — editorial / literary typography

Font files are intentionally not included in this package. The editable lockups reference Hanken Grotesk by family name.

## Usage rules

1. Preserve the exact mark geometry.
2. Preserve the doorway's left offset.
3. Never stretch, skew, rotate, narrow, widen, or re-round the mark.
4. Do not add gradients, shadows, strokes, bevels, or glass effects.
5. Do not create a special favicon redraw. Use the master geometry at every size.
6. Use the primary version on warm/light surfaces.
7. Use the reversed or monochrome knockout versions when contrast requires it.

## Folder guide

- `01_Primary_Mark` — canonical SVG and PNG sizes
- `02_Color_Variants` — color-only variants, identical geometry
- `03_Favicon` — ICO + PNG favicon exports
- `04_App_Icon` — app icon exports
- `05_Lockups` — editable Hanken Grotesk lockups
- `06_Guidelines` — construction, tokens, geometry, this document
- `07_Reference` — reconstruction comparison / visual reference
