#!/usr/bin/env python3
"""
Generate the repo's brand lockups from the brand kit — kerning-correct and
TIGHTLY CANVASSED.

    uv run --with fonttools --with brotli \
      python Nostos.Frontend/tools/gen-brand-lockups.py

Writes docs/brand/{logo-light,logo-dark,mark}.svg.

WHY THE WORDMARK IS OUTLINED
  The kit's editable lockups (05_Lockups/*.svg) use <text> + font-family
  'Hanken Grotesk'. That renders fine inside the app, but GitHub (and any
  sanitiser with a strict CSP) strips webfonts, so the wordmark silently falls
  back to a default sans and the lockup breaks. Anything that leaves the app must
  therefore carry the wordmark as outlines. `brand-guidelines.md` says the same:
  convert <text> to outlines before it goes out.

WHY THE CANVAS IS TRIMMED TO INK (do not "restore" 1840x512)
  The kit's lockup canvas is 1840x512, but its ink only reaches x=1335 — 504px of
  EMPTY canvas sits on the right. Centring that file centres the empty canvas, not
  the artwork, so the lockup visibly sits left of centre in a README (measured:
  the ink's mass centre lands ~29% of the canvas width to the left). The canvas is
  therefore trimmed to the actual ink box, which makes the artwork itself centred.
  Do not reintroduce fixed padding here; centring depends on it.

WHY THE GLYPH POSITIONS ARE HARD-CODED
  Computing advances from fontTools alone ignores kerning and drifted the wordmark
  +3px from the 5th glyph (the 't'->'o' pair). The START offsets below were read
  from the browser's own text layout (SVGTextContentElement.getStartPositionOfChar),
  which applies kerning AND letter-spacing. Verified pixel-identical to the kit's
  <text> render: all six glyphs land on the same pixel columns, width 693px both.

  To re-derive, render 05_Lockups/nostos-horizontal-editable.svg with Hanken
  Grotesk loaded and read getStartPositionOfChar(i).x for i in 0..5.

VERIFY AFTER ANY CHANGE
  1. Fidelity: render logo-light.svg and the kit lockup at the same scale and diff
     the ink masks (bboxes + per-glyph columns must match).
  2. Centring: the ink's mass centre must sit within ~1% of the canvas centre.
     Checking fidelity alone is NOT enough — that is the exact mistake that made
     the first version look left-aligned.
"""
from __future__ import annotations

import os
import sys
import urllib.request

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(REPO, "docs", "brand")
FONT_URL = ("https://fonts.gstatic.com/s/hankengrotesk/v12/"
            "ieVq2YZDLWuGJpnzaiwFXS9tYvBRzyFLlZg_f_NcgWZq5vBJ.ttf")
FONT_CACHE = os.path.join(os.path.expanduser("~"), ".cache", "nostos", "HankenGrotesk-500.ttf")

FOREST = "#293E32"
PAPER = "#FDF8F6"
INK = "#1C1B1A"
WORD = "nostos"

# Locked master geometry (brand-guidelines.md). Never recentre the doorway.
MARK_SIZE = 1024          # master canvas
MARK_SCALE = 0.5          # -> 512x512 in the lockup
TILE_R = 205
ARCH_D = ("M 282 764 L 282 509 A 229 234 0 0 1 740 509 L 740 764 Z "
          "M 358 764 L 358 509 A 110 112 0 0 1 578 509 L 578 764 Z")

# Horizontal lockup: baseline 345, font-size 255, letter-spacing -8.
H_BASELINE, H_SIZE = 345.0, 255.0
H_STARTS = [625.0, 758.0, 896.625, 1008.7344, 1088.2031, 1226.8281]


def font_path() -> str:
    if not os.path.exists(FONT_CACHE):
        os.makedirs(os.path.dirname(FONT_CACHE), exist_ok=True)
        print(f"fetching Hanken Grotesk 500 -> {FONT_CACHE}")
        with urllib.request.urlopen(FONT_URL) as r, open(FONT_CACHE, "wb") as f:
            f.write(r.read())
    return FONT_CACHE


def glyph_paths(font, scale, baseline, starts, offset_x=0.0, offset_y=0.0):
    """Outlined glyphs, translated so the ink box starts at (offset_x, offset_y)."""
    cmap = font.getBestCmap()
    gs = font.getGlyphSet()
    out = []
    for ch, x in zip(WORD, starts):
        if ord(ch) not in cmap:
            raise SystemExit(f"Hanken Grotesk has no glyph for {ch!r}")
        pen = SVGPathPen(gs)
        gs[cmap[ord(ch)]].draw(pen)
        d = pen.getCommands()
        if d:
            out.append(f'<path transform="translate({x - offset_x:.4f} '
                       f'{baseline - offset_y:.4f}) scale({scale:.8f} {-scale:.8f})" d="{d}"/>')
    return out


def ink_box(font, scale, baseline, starts):
    """Ink bounding box (in lockup user units, before any trimming)."""
    # Mark occupies 0..MARK_SIZE*MARK_SCALE in both axes.
    xs = [0.0, MARK_SIZE * MARK_SCALE]
    ys = [0.0, MARK_SIZE * MARK_SCALE]
    for ch, x in zip(WORD, starts):
        gname = font.getBestCmap()[ord(ch)]
        g = font["glyf"][gname]
        # glyf yMax is in font units, y-up; SVG flips it.
        xs += [x + g.xMin * scale, x + g.xMax * scale]
        ys += [baseline - g.yMax * scale, baseline - g.yMin * scale]
    return min(xs), min(ys), max(xs), max(ys)


def build(font_file):
    font = TTFont(font_file)
    scale = H_SIZE / font["head"].unitsPerEm

    x0, y0, x1, y1 = ink_box(font, scale, H_BASELINE, H_STARTS)
    w, h = x1 - x0, y1 - y0
    glyphs = glyph_paths(font, scale, H_BASELINE, H_STARTS, offset_x=x0, offset_y=y0)

    def lockup(word_fill):
        g = "\n    ".join(glyphs)
        return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{w:.0f}" height="{h:.0f}" viewBox="0 0 {w:.0f} {h:.0f}" role="img" aria-label="Nostos">
  <title>Nostos</title>
  <!-- GENERATED by Nostos.Frontend/tools/gen-brand-lockups.py — do not hand-edit.
       Wordmark is OUTLINED (no <text>/webfont) so it survives sanitisers that strip
       fonts (GitHub, strict-CSP renderers), which would otherwise silently fall back
       to a default sans and break the lockup.
       Canvas is TRIMMED TO INK so the artwork itself is centred when the browser
       centres the image. Do not pad it back out.
       Mark: Forest tile + Paper arch (the theme-invariant primary variant). -->
  <g transform="translate({-x0:.4f} {-y0:.4f}) scale({MARK_SCALE})">
    <rect x="0" y="0" width="1024" height="1024" rx="{TILE_R}" fill="{FOREST}"/>
    <path d="{ARCH_D}" fill="{PAPER}" fill-rule="evenodd"/>
  </g>
  <g fill="{word_fill}">
    {g}
  </g>
</svg>
"""
    mark = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{MARK_SIZE}" height="{MARK_SIZE}" viewBox="0 0 {MARK_SIZE} {MARK_SIZE}" role="img" aria-label="Nostos brand mark">
  <title>Nostos mark</title>
  <rect x="0" y="0" width="{MARK_SIZE}" height="{MARK_SIZE}" rx="{TILE_R}" fill="{FOREST}"/>
  <path d="{ARCH_D}" fill="{PAPER}" fill-rule="evenodd"/>
</svg>
"""
    return {
        "logo-light.svg": lockup(INK),
        "logo-dark.svg": lockup(PAPER),
        "mark.svg": mark,
    }, (w, h)


def main() -> int:
    files, (w, h) = build(font_path())
    os.makedirs(OUT, exist_ok=True)
    for name, content in files.items():
        path = os.path.join(OUT, name)
        with open(path, "w") as fh:
            fh.write(content)
        print(f"wrote {path} ({len(content)} bytes)")
    print(f"lockup canvas trimmed to ink: {w:.0f} x {h:.0f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
