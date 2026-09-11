#!/usr/bin/env node
/**
 * profile-fade.mjs — measure whether a hero→page fade is smooth.
 *
 * A "harsh" or "banded" fade is not a taste judgement: it is a measurable shape
 * defect. This tool reports the fade's ramp in **OKLab lightness** — which is
 * what the eye actually reads — rather than in luminance or alpha, because the
 * three do not agree. Alpha compositing is non-linear, so a ramp built as a
 * smoothstep in *alpha* comes out front-loaded in *lightness*.
 *
 * Two failure modes it is designed to catch, both of which have shipped here:
 *   - a layer that DARKENS where the fade must lighten, making the lightness
 *     profile dip and then jump (reads as a hard band);
 *   - a ramp whose slope accelerates mid-way and then stops dead (reads as a
 *     wall at the band edge).
 *
 * Usage — capture live:
 *   node tools/profile-fade.mjs --url http://localhost:4310/library/<book-id>
 *
 * Usage — analyse an existing screenshot (needs the band geometry):
 *   node tools/profile-fade.mjs --png shot.png --fade-top 170 --fade-bottom 470
 *
 * Exit code is 0 only if the ramp is smooth, so it can gate a check.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

// ── colour maths (Björn Ottosson's OKLab) ────────────────────────────────────
const srgbToLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

function oklab(rgb) {
  const R = srgbToLinear(rgb[0]);
  const G = srgbToLinear(rgb[1]);
  const B = srgbToLinear(rgb[2]);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

// ── args ─────────────────────────────────────────────────────────────────────
const { values: argv } = parseArgs({
  options: {
    url: { type: 'string' },
    png: { type: 'string' },
    'fade-top': { type: 'string' },
    'fade-bottom': { type: 'string' },
    'fade-color': { type: 'string', default: '253,248,246' },
    stops: { type: 'string', default: '0,0.15,0.30,0.50,0.70,0.85,1' },
    strip: { type: 'string' },
    out: { type: 'string' },
    dpr: { type: 'string', default: '1' },
    json: { type: 'boolean', default: false },
  },
});

const FADE_COLOR = argv['fade-color'].split(',').map(Number);
const STOP_T = argv.stops.split(',').map(Number);
const smoothstep = (t) => 3 * t * t - 2 * t * t * t;

/**
 * Decode a PNG to raw RGBA using the browser's own image pipeline, so the tool
 * needs no image dependency (Playwright is already a devDependency).
 */
async function decodePng(page, pngPath) {
  const b64 = readFileSync(pngPath).toString('base64');
  return page.evaluate(async (dataUrl) => {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error('image decode failed'));
      img.src = dataUrl;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    return { width: c.width, height: c.height, data: Array.from(data) };
  }, `data:image/png;base64,${b64}`);
}

/** Mean colour of a horizontal strip of the image, one value per row. */
function columnProfile(img, x0, x1) {
  const { width, height, data } = img;
  const lo = Math.max(0, Math.min(x0, x1));
  const hi = Math.min(width, Math.max(x0, x1));
  if (hi - lo < 8) throw new Error(`strip too narrow: x ${lo}..${hi}`);
  const rows = [];
  for (let y = 0; y < height; y++) {
    let r = 0, g = 0, b = 0;
    for (let x = lo; x < hi; x++) {
      const i = (y * width + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    const n = hi - lo;
    rows.push([r / n, g / n, b / n]);
  }
  return rows;
}

function analyse(profile, top, bottom, label) {
  const band = profile.slice(top, bottom + 1);
  const lab = band.map(oklab);
  const Ls = lab.map((c) => c.L);
  const Cs = lab.map((c) => Math.hypot(c.a, c.b));
  const L0 = Ls[0];
  const L1 = Ls[Ls.length - 1];
  const span = L1 - L0;

  // Lightness at each declared stop position, against a true smoothstep.
  const at = STOP_T.map((t) => {
    const idx = Math.min(Ls.length - 1, Math.round(t * (Ls.length - 1)));
    return { t, L: Ls[idx], norm: (Ls[idx] - L0) / span };
  });
  const ideal = STOP_T.map(smoothstep);
  const deviation = at.map((s, i) => s.norm - ideal[i]);
  const maxDevIdx = deviation.reduce((b, d, i) => (Math.abs(d) > Math.abs(deviation[b]) ? i : b), 0);

  // Slope profile: does the ramp accelerate after its peak, or stop dead?
  const block = Math.max(4, Math.round((bottom - top) / 10));
  const slopes = [];
  for (let i = 0; i + block < Ls.length; i += block) {
    slopes.push({ y: top + i, s: (Ls[i + block] - Ls[i]) / block });
  }
  const peakIdx = slopes.reduce((b, v, i) => (v.s > slopes[b].s ? i : b), 0);
  const after = slopes.slice(peakIdx + 1);
  // Tolerance matters here: the art under a semi-transparent fade is not uniform,
  // so a block-to-block slope can wiggle ~1% without meaning anything. Only a
  // MATERIAL re-acceleration is the defect (the shipped bug went +0.92 -> +1.44/px,
  // i.e. +57%). Flag only rises above 10% of the peak.
  const peakSlopeSoFar = Math.max(...slopes.map((s) => s.s), 1e-9);
  const accelIdx = after.findIndex((v, i) => i > 0 && v.s > after[i - 1].s * 1.1 && v.s > peakSlopeSoFar * 0.1);
  const acceleratesAfterPeak = accelIdx !== -1;
  const peakPos = slopes.length > 1 ? peakIdx / (slopes.length - 1) : 0.5;

  // Dips: luminance must never fall where the fade is meant to lighten.
  const dips = [];
  let run = null;
  for (let i = 1; i < Ls.length; i++) {
    if (Ls[i] < Ls[i - 1] - 1e-4) {
      if (!run) run = { from: top + i - 1, to: top + i, worst: 0 };
      run.to = top + i;
      run.worst = Math.min(run.worst, Ls[i] - Ls[i - 1]);
    } else if (run) {
      if (run.to - run.from >= 4) dips.push(run);
      run = null;
    }
  }
  if (run && run.to - run.from >= 4) dips.push(run);

  const steps = Ls.slice(1).map((v, i) => Math.abs(v - Ls[i]));
  const lastDelta = Math.abs(profile[bottom + 2] ? oklab(profile[bottom + 2]).L - L1 : L1);

  // Ends must be gentle relative to the peak, or the ramp draws an onset/stop line.
  const peakSlope = Math.max(...slopes.map((s) => s.s), 1e-9);
  const startRatio = slopes[0].s / peakSlope;
  const endRatio = slopes[slopes.length - 1].s / peakSlope;

  const problems = [];
  if (dips.length) problems.push(`lightness DIPS at ${dips.map((d) => `${d.from}-${d.to}`).join(', ')}`);
  if (acceleratesAfterPeak) problems.push('slope ACCELERATES after its peak — ramp gets steeper then stops');
  if (startRatio > 0.5) problems.push(`starts too steeply (${(startRatio * 100).toFixed(0)}% of peak) — visible onset line`);
  if (endRatio > 0.5) problems.push(`ends too steeply (${(endRatio * 100).toFixed(0)}% of peak) — visible stop line`);
  if (lastDelta > 0.004) problems.push(`hard stop at the band edge (ΔL ${lastDelta.toFixed(4)})`);
  if (peakPos < 0.25 || peakPos > 0.75) problems.push(`slope peaks at ${(peakPos * 100).toFixed(0)}% of the ramp, not the middle — asymmetric`);

  const chromaMax = Math.max(...Cs);
  const chromaMin = Math.min(...Cs);
  const greyRows = Cs.filter((c) => c < chromaMin * 1.15).length;

  return {
    label, top, bottom, height: bottom - top,
    L0, L1, span,
    at, ideal, deviation, maxDeviation: deviation[maxDevIdx], maxDevAt: at[maxDevIdx].t,
    slopes, peakPos, startRatio, endRatio,
    dips, maxStep: Math.max(...steps), lastDelta,
    chromaMax, chromaMin, greyRows,
    problems, smooth: problems.length === 0,
  };
}

function report(r) {
  const f = (n, d = 4) => n.toFixed(d);
  console.log(`\n── fade profile: ${r.label}`);
  console.log(`   band y=${r.top}..${r.bottom} (${r.height}px)   OKLab L ${f(r.L0)} -> ${f(r.L1)}`);
  console.log(`\n   x%     L        norm     smoothstep   error`);
  r.at.forEach((s, i) => {
    const err = r.deviation[i];
    const flag = Math.abs(err) > 0.02 ? '  <--' : '';
    console.log(`   ${String(Math.round(s.t * 100)).padStart(3)}%   ${f(s.L)}   ${f(s.norm)}   ${f(r.ideal[i])}       ${(err >= 0 ? '+' : '') + f(err, 3)}${flag}`);
  });
  console.log(`\n   max lightness deviation from smoothstep: ${f(Math.abs(r.maxDeviation), 3)} at ${Math.round(r.maxDevAt * 100)}%`);
  console.log(`   slope peaks at ${Math.round(r.peakPos * 100)}% of the ramp; ends at ${Math.round(r.startRatio * 100)}% / ${Math.round(r.endRatio * 100)}% of peak`);
  console.log(`   max single-step ΔL ${f(r.maxStep, 5)}   hard-stop ΔL at edge ${f(r.lastDelta, 5)}`);
  console.log(`   OKLab chroma ${f(r.chromaMax)} -> ${f(r.chromaMin)} (lower ${r.greyRows}px within 15% of min)`);
  if (r.smooth) {
    console.log(`\n   PASS — ramp is smooth: monotonic, symmetric, gentle at both ends.`);
  } else {
    console.log(`\n   FAIL`);
    r.problems.forEach((p) => console.log(`     - ${p}`));
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: Number(argv.dpr) === 1 ? 1440 : 1440, height: 900 },
  deviceScaleFactor: Number(argv.dpr),
  ignoreHTTPSErrors: true,
});
const page = await ctx.newPage();

let pngPath = argv.png;
let top = argv['fade-top'] !== undefined ? Number(argv['fade-top']) : null;
let bottom = argv['fade-bottom'] !== undefined ? Number(argv['fade-bottom']) : null;
let strip = argv.strip ? argv.strip.split(',').map(Number) : null;
let label = argv.png ?? 'capture';

if (argv.url) {
  await page.goto(argv.url, { waitUntil: 'domcontentloaded' });
  await page.locator('.book-title').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(2200); // let the art decode
  const rect = await page.evaluate(() => {
    const el = document.querySelector('.art-fade');
    if (!el) throw new Error('no .art-fade on the page');
    const r = el.getBoundingClientRect();
    const pageBg = getComputedStyle(document.documentElement).getPropertyValue('--bg-body').trim();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left),
             right: Math.round(r.right), width: Math.round(r.width), pageBg };
  });
  if (rect.bottom > 900) throw new Error(`fade band is cut off (bottom ${rect.bottom} > 900); scroll to top first`);
  top = rect.top;
  bottom = rect.bottom;
  // Right-hand slice of the band, inset so no border or scrollbar lands in it.
  strip = [rect.right - 140, rect.right - 24];
  pngPath = argv.out ?? join(mkdtempSync(join(tmpdir(), 'fade-')), 'capture.png');
  await page.screenshot({ path: pngPath });
  label = `${argv.url} (dpr ${argv.dpr})`;
  // Progress notes go to stderr so --json always leaves stdout as clean JSON.
  console.error(`captured ${pngPath}   fade band y=${top}..${bottom}   page bg ${rect.pageBg || 'n/a'}`);
  if (rect.pageBg && /^#?[0-9a-f]{6}$/i.test(rect.pageBg)) {
    const hex = rect.pageBg.replace('#', '');
    FADE_COLOR[0] = parseInt(hex.slice(0, 2), 16);
    FADE_COLOR[1] = parseInt(hex.slice(2, 4), 16);
    FADE_COLOR[2] = parseInt(hex.slice(4, 6), 16);
  }
}

if (top === null || bottom === null) {
  throw new Error('need --url, or --png with --fade-top and --fade-bottom');
}

const img = await decodePng(page, pngPath);
if (!strip) strip = [Math.round(img.width * 0.9), Math.round(img.width * 0.98)];
const profile = columnProfile(img, strip[0], strip[1]);
const result = analyse(profile, top, bottom, label);
result.imageSize = { w: img.width, h: img.height };
result.strip = strip;

if (argv.json) console.log(JSON.stringify(result, null, 2));
else report(result);

await browser.close();
process.exit(result.smooth ? 0 : 1);
