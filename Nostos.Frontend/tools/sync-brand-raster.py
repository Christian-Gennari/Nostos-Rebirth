#!/usr/bin/env python3
"""
Synchronise the brand kit's derived raster assets (PNG + ICO) with the palette
declared in the SVG sources.

WHY THIS EXISTS
There is no SVG rasteriser CLI on this machine (no rsvg-convert, inkscape,
magick, resvg, cairosvg or sharp), so the kit's PNGs could not simply be
re-exported. Re-rasterising through a browser is possible but WRONG for a
colour-only change: it moves every glyph edge by a sub-pixel of antialiasing.
Measured on UNCHANGED source, a browser re-render differed from the committed
512px PNG at 1918 pixels (max channel delta 214) purely from antialiasing — so a
recolour done that way would smuggle in a geometry change.

WHAT IT DOES INSTEAD
The mark is flat two-colour artwork, so every pixel is a known blend of exactly
two colours and the coverage is recoverable exactly:

    C = t*A + (1-t)*B     =>     t = dot(C-B, A-B) / |A-B|^2

Swapping A -> A' gives C' = C + t*(A'-B). Only the A colour changes: canvas
size, alpha, geometry and every non-A pixel are untouched BY CONSTRUCTION.
Verified on the 512px primary mark: 31,075 paper pixels became exactly 31,075
white pixels, 0 of 220,612 pure-tile pixels moved, alpha bit-identical.

A file with no pixels of the A colour is reported as "no change needed" rather
than failed — the kit's single-colour variants (monochrome dark/light, forest
knockout) legitimately contain no Paper. A file that DOES contain Paper but does
not fit the two-colour model is refused, because then the model is wrong and
guessing would corrupt artwork.

USAGE
    python3 Nostos.Frontend/tools/sync-brand-raster.py --check   # report only
    python3 Nostos.Frontend/tools/sync-brand-raster.py           # write files

Deps: Pillow + numpy.
"""
from __future__ import annotations

import argparse
import glob
import os
import sys

from PIL import Image
import numpy as np

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
KIT = os.path.join(REPO, "_brand-assets")
PUBLIC = os.path.join(REPO, "Nostos.Frontend", "public")

FOREST = np.array([0x29, 0x3E, 0x32], float)
PAPER = np.array([0xFD, 0xF8, 0xF6], float)
WHITE = np.array([0xFF, 0xFF, 0xFF], float)

# Both the primary mark (arch knocked out of the tile) and the reversed mark
# (light tile, forest arch) paint Paper in the same "A" role, so one
# substitution covers both.
A_OLD, A_NEW, B_FIXED = PAPER, WHITE, FOREST

# The two-colour model must reconstruct every opaque pixel to within this.
TOLERANCE = 2.0
# Below this many pixels of the A colour, the asset is "single colour".
MIN_A_PIXELS = 4

# Composed sheets and reference captures are illustrations, not artwork: the
# paper colour appears there as a page ground and as text, so the blend model
# does not apply. Reported and skipped, never silently rewritten.
SKIP = (
    "06_Guidelines/brand-kit-overview.png",
    "07_Reference/reference-vs-locked-vector.png",
    "07_Reference/selected-hero-reference.png",
)

# ICO containers are rebuilt from the recoloured favicon PNGs of the same sizes,
# because their small frames contain resampled greys that break the two-colour
# model. Rebuilding makes the .ico agree with the .pngs by construction.
ICOS = (
    (f"{KIT}/03_Favicon/favicon.ico", f"{KIT}/03_Favicon"),
    (os.path.join(PUBLIC, "favicon.ico"), f"{KIT}/03_Favicon"),
)


def png_targets() -> list[str]:
    out = glob.glob(f"{KIT}/**/*.png", recursive=True)
    out += glob.glob(f"{PUBLIC}/*.png")
    return sorted(p for p in out if not any(s in p for s in SKIP))


def solve(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    d = A_OLD - B_FIXED
    t = np.clip(((rgb - B_FIXED) @ d) / (d @ d), 0.0, 1.0)
    err = np.abs((B_FIXED + t[:, :, None] * d) - rgb).max(axis=2)
    new = rgb + t[:, :, None] * (A_NEW - A_OLD)
    return t, err, new


def process_png(path: str, write: bool) -> tuple[str, int, int, float]:
    arr = np.asarray(Image.open(path).convert("RGBA")).astype(float)
    rgb, alpha = arr[:, :, :3], arr[:, :, 3]
    opaque = alpha > 250

    # Does this asset actually paint with Paper? The kit's single-colour
    # variants (monochrome dark/light, forest knockout) legitimately do not,
    # and monochrome-light is already pure white — nothing to do for any of
    # them. Deciding on an exact-colour census, not on a model fit, keeps
    # "already white" from being confused with "needs the blend solved".
    n_paper = int((np.abs(rgb - A_OLD).max(axis=2) <= 1.0)[opaque].sum())

    t, err, new = solve(rgb)
    worst = float(err[opaque].max()) if opaque.any() else 0.0

    if n_paper < MIN_A_PIXELS:
        return "no Paper; unchanged", 0, int(opaque.sum()), worst
    if worst > TOLERANCE:
        return "FAIL: not a two-colour blend", 0, int(opaque.sum()), worst

    changed = int((np.abs(new - rgb).max(axis=2) > 0.5).sum())
    if write:
        Image.fromarray(
            np.dstack([np.clip(new, 0, 255), alpha]).round().astype(np.uint8),
            "RGBA").save(path)
    return "recoloured", changed, int(opaque.sum()), worst


def rebuild_ico(ico: str, srcdir: str, write: bool) -> tuple[str, int, int]:
    """Rebuild an ICO from the favicon PNGs of the matching sizes.

    Pillow's ICO writer SKIPS any requested size larger than the base image, so
    the frames must be supplied largest-first with the largest as the base —
    otherwise only the 16px frame survives and the file silently loses its
    32/48px frames.
    """
    want = sorted(Image.open(ico).info.get("sizes", []), reverse=True)
    frames, missing = [], []
    for s in want:
        cand = os.path.join(srcdir, f"favicon-{s[0]}.png")
        if os.path.exists(cand):
            frames.append(Image.open(cand).convert("RGBA"))
        else:
            missing.append(s[0])
    if missing:
        return f"FAIL: no source png for {missing}", 0, 0
    if write and frames:
        frames[0].save(ico, format="ICO",
                       sizes=[(f.width, f.height) for f in frames],
                       append_images=frames[1:])
    return f"rebuilt from {len(frames)} png", sum(
        f.width * f.height for f in frames), len(frames)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="report what would change; write nothing")
    args = ap.parse_args()
    write = not args.check

    print(f"{'file':58} {'changed':>8} {'px':>9}  worst  result")
    changed_total = failed = 0

    for p in png_targets():
        result, changed, px, worst = process_png(p, write)
        if result.startswith("FAIL"):
            failed += 1
        changed_total += changed
        print(f"{os.path.relpath(p, REPO):58} {changed:>8} {px:>9}  "
              f"{worst:5.1f}  {result}")

    for ico, srcdir in ICOS:
        result, px, n = rebuild_ico(ico, srcdir, write)
        if result.startswith("FAIL"):
            failed += 1
        print(f"{os.path.relpath(ico, REPO):58} {'-':>8} {px:>9}  "
              f"{'-':>5}  {result}")

    print(f"\n{changed_total} pixel(s) recoloured")
    for s in SKIP:
        print(f"skipped (illustration, not artwork): {s}")
    if failed:
        print(f"\n{failed} file(s) could not be handled; nothing written for "
              f"those.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
