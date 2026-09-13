#!/usr/bin/env node
/**
 * check-pixels.mjs — the pixel-identity gate.
 *
 * Compares a fresh capture set against the committed baseline and fails on any
 * difference that a human has not explicitly declared. This is the check that
 * catches the failures nothing else does: a token that moved a LIGHT-mode value,
 * a global override that was secretly load-bearing for a component, a text colour
 * that vanished because a `transition` swallowed the next declaration.
 *
 * Usage:
 *   npm run capture:baseline -- --out /tmp/after
 *   node scripts/check-pixels.mjs /tmp/after
 *
 * Two-tier comparison, because one tier cannot do both jobs:
 *
 *   1. PIXELS. Byte comparison, minus an explicit allowance for regions that are
 *      measurably nondeterministic (see FLAKE). A difference outside those
 *      regions fails. The allowance is a rectangle list, not a pixel budget,
 *      because a budget cannot tell a real 500-pixel change from a 500-pixel
 *      rendering artefact — and both occur here (a switch knob moving is ~536 px;
 *      the toolbar edge flake is ~636 px).
 *
 *   2. COMPUTED VALUES. The paint sweep (per-surface buckets of background, ink,
 *      radius, shadow, ...) must match, EXCEPT the motion buckets, which are
 *      expected to move whenever transition properties are named explicitly.
 *      Read separately so a colour regression cannot hide behind motion churn.
 *
 * Honest limitation, stated because a gate that overstates its coverage is worse
 * than none: the computed-value sweep reads what each element PAINTS, sampled
 * across the page. It cannot see a difference in an element that is present but
 * scrolled out of the captured viewport, so the pixel tier is the real contract
 * and the sweep is a fast, targeted second opinion.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const BASELINE = join(HERE, '..', 'e2e', 'visual-evidence', 'design-baseline');
const CANDIDATE = process.argv[2];
if (!CANDIDATE) {
  console.error('usage: node scripts/check-pixels.mjs <candidate-dir>');
  process.exit(2);
}

/**
 * Regions that are measurably nondeterministic across captures of IDENTICAL code.
 * Every entry must be justified by an observed, reproducible measurement — do not
 * add a rectangle to silence a real difference. Keep them as small as the evidence
 * allows: anything outside these boxes is compared byte-for-byte.
 *
 * Format: tag -> [{ x, y, w, h, why }]
 */
const FLAKE = {
  'library-desktop-light': [
    {
      x: 1006, y: 20, w: 160, h: 48,
      why: 'Toolbar control edges (sort select + segmented control). ~636 px of ' +
        'anti-aliasing drift on the group\'s top/bottom edge rows, max channel ' +
        'delta ~36, stable in position across runs. Cause not fully identified; ' +
        'narrowed to this rectangle, which is 0.0064% of the frame. Removing it ' +
        'would hide a real change to the toolbar, so it is declared here rather ' +
        'than absorbed into a global tolerance.',
    },
  ],
};

const MOTION_BUCKETS = new Set(['transitionDur', 'transitionProp', 'easing']);

function readPng(p) {
  return PNG.sync.read(readFileSync(p));
}

/** Pixels differing by more than `tol` on any channel, as a set of x,y. */
function diffPixels(a, b, tol = 8) {
  if (a.width !== b.width || a.height !== b.height) {
    return { sizeMismatch: true, points: [], count: 0 };
  }
  const points = [];
  let count = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (a.width * y + x) << 2;
      const d = Math.max(
        Math.abs(a.data[i] - b.data[i]),
        Math.abs(a.data[i + 1] - b.data[i + 1]),
        Math.abs(a.data[i + 2] - b.data[i + 2]),
      );
      if (d > tol) { count++; points.push([x, y, d]); }
    }
  }
  return { sizeMismatch: false, points, count };
}

const tol = Number(process.env.PIXEL_TOL ?? 8);
const failures = [];
const notes = [];

// ---------------------------------------------------------------- tier 1: pixels
const baselinePngs = readdirSync(BASELINE).filter((f) => f.endsWith('.png')).sort();
for (const file of baselinePngs) {
  const tag = basename(file, '.png');
  const candPath = join(CANDIDATE, file);
  if (!existsSync(candPath)) {
    failures.push(`${tag}: MISSING from the candidate set — a surface silently ` +
      `stopped being captured, which would look like a pass`);
    continue;
  }
  const a = readPng(join(BASELINE, file));
  const b = readPng(candPath);
  const { sizeMismatch, points, count } = diffPixels(a, b, tol);
  if (sizeMismatch) {
    failures.push(`${tag}: image size changed (${a.width}x${a.height} -> ${b.width}x${b.height})`);
    continue;
  }
  if (!count) continue;

  const allow = FLAKE[tag] ?? [];
  const inside = (x, y) => allow.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  const outside = points.filter(([x, y]) => !inside(x, y));
  const within = count - outside.length;

  if (outside.length) {
    // Cluster the offenders so the report names a region, not 400 coordinates.
    const xs = outside.map((p) => p[0]); const ys = outside.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const maxDelta = Math.max(...outside.map((p) => p[2]));
    const worst = outside.slice().sort((p, q) => q[2] - p[2]).slice(0, 5);
    failures.push(
      `${tag}: ${outside.length} unexpected pixel(s) differ outside the declared ` +
      `flake regions. bbox=x${x0}..${x1} y${y0}..${y1}, max channel delta ${maxDelta}, ` +
      `worst at ${worst.map(([x, y, d]) => `(${x},${y})=${d}`).join(' ')}`);
  } else if (within) {
    notes.push(`${tag}: ${within} px differ, all inside declared flake regions`);
  }
}

// ------------------------------------------------------- tier 2: computed values
const baseJson = JSON.parse(readFileSync(join(BASELINE, 'painted-values.json'), 'utf8'));
const candPath = join(CANDIDATE, 'painted-values.json');
if (!existsSync(candPath)) {
  failures.push('painted-values.json: MISSING from the candidate set');
} else {
  const candJson = JSON.parse(readFileSync(candPath, 'utf8'));
  const A = new Map(baseJson.captures.map((c) => [c.tag, c]));
  const B = new Map(candJson.captures.map((c) => [c.tag, c]));
  for (const [tag, ca] of A) {
    const cb = B.get(tag);
    if (!cb) { failures.push(`${tag}: capture missing from candidate`); continue; }
    for (const bucket of Object.keys(ca.sweep.buckets)) {
      const da = JSON.stringify([...ca.sweep.buckets[bucket]].sort());
      const db = JSON.stringify([...(cb.sweep.buckets[bucket] ?? [])].sort());
      if (da === db) continue;
      if (MOTION_BUCKETS.has(bucket)) {
        notes.push(`${tag} [${bucket}]: moved (expected when transition properties change)`);
        continue;
      }
      const oa = Object.fromEntries(ca.sweep.buckets[bucket]);
      const ob = Object.fromEntries(cb.sweep.buckets[bucket] ?? []);
      const gone = Object.keys(oa).filter((k) => oa[k] !== ob[k]);
      const added = Object.keys(ob).filter((k) => oa[k] !== ob[k]);
      failures.push(`${tag} [${bucket}]: painted values changed\n` +
        `      no longer painted: ${gone.slice(0, 4).join(', ') || '(none)'}\n` +
        `      newly painted    : ${added.slice(0, 4).join(', ') || '(none)'}`);
    }
  }
  for (const tag of B.keys()) {
    if (!A.has(tag)) notes.push(`${tag}: NEW capture (not in baseline — regenerate the baseline)`);
  }
}

// ---------------------------------------------------------------------- report
for (const n of notes) console.log(`  (note) ${n}`);
if (failures.length) {
  console.log(`\n✖ pixel-identity: ${failures.length} failure(s).`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log('\nIf a failure is INTENDED, regenerate the baseline and say so in the commit:\n' +
    '  npm run capture:baseline   (then commit the updated PNGs + painted-values.json)');
  process.exit(1);
}
console.log(`✔ pixel-identity: ${baselinePngs.length} captures match the baseline ` +
  `(tolerance ${tol}/channel; ${Object.keys(FLAKE).length} tag(s) carry a declared flake region).`);
