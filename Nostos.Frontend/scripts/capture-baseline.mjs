#!/usr/bin/env node
/**
 * Design-language baseline capture.
 *
 * A CSS refactor compiles perfectly while changing every surface, so the
 * acceptance test for this work cannot be `npm run build` — it has to be a
 * pixel-and-computed-value baseline taken from the RUNNING app.
 *
 * This captures, for each surface x viewport x theme:
 *   - a PNG at DPR 1 (artifact pixels are exact; downscaling hides defects)
 *   - a JSON of computed values clustered over the painted DOM
 *
 * It also records a BUILD FINGERPRINT. This matters: a previous audit session
 * measured a bundle that predated a merge to main, and every number it produced
 * described the old code. Every later diff must state which build it measured,
 * so the fingerprint is captured with the baseline rather than reconstructed
 * later.
 *
 * Usage:
 *   node scripts/capture-baseline.mjs [--port 5214] [--out <dir>]
 *   node scripts/capture-baseline.mjs --theme dark --surface library
 *
 * Assumes an app is already serving (npm run prod / npm start). It does NOT
 * start one: a baseline captured against a freshly-started server would race
 * the build, which is the exact failure this harness exists to prevent.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, '..');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const PORT = arg('port', '5214');
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = resolve(arg('out', join(frontendRoot, 'e2e/visual-evidence/design-baseline')));
const ONLY_THEME = arg('theme', null);
const ONLY_SURFACE = arg('surface', null);

/** Surfaces worth pinning. Protected surfaces (pdf/tinymce) are out of scope. */
const SURFACES = [
  { name: 'library', route: '/library', settle: 'networkidle' },
  { name: 'brain', route: '/second-brain', settle: 'networkidle' },
  { name: 'studio', route: '/studio', settle: 'networkidle' },
  { name: 'settings', route: '/settings', settle: 'networkidle' },
  { name: 'home', route: '/', settle: 'networkidle' },
];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

const THEMES = ['light', 'dark'];

/** Clusters computed values over every element that actually paints. */
const SWEEP = () => {
  const buckets = {
    radius: {}, fontSize: {}, fontWeight: {}, fontFamily: {},
    bg: {}, fg: {}, borderW: {}, borderC: {}, shadow: {},
    outlineW: {}, outlineC: {}, transitionDur: {}, transitionProp: {}, easing: {},
  };
  const bump = (o, k) => { if (k) o[k] = (o[k] || 0) + 1; };
  let painted = 0;

  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    painted++;
    const cs = getComputedStyle(el);

    bump(buckets.radius, cs.borderTopLeftRadius);
    bump(buckets.fontSize, cs.fontSize);
    bump(buckets.fontWeight, cs.fontWeight);
    bump(buckets.fontFamily, (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim());
    bump(buckets.bg, cs.backgroundColor);
    bump(buckets.fg, cs.color);
    if (cs.boxShadow && cs.boxShadow !== 'none') bump(buckets.shadow, cs.boxShadow);

    // OUTLINE only counts when a ring is actually drawn.
    if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) {
      bump(buckets.outlineW, cs.outlineWidth);
      bump(buckets.outlineC, cs.outlineColor);
    }
    // BORDER only when a style is set: with `border-style: none` the computed
    // colour is `currentColor`, which would otherwise flood this bucket with
    // text colours and read as a border that does not exist.
    if (cs.borderTopStyle !== 'none' && parseFloat(cs.borderTopWidth) > 0) {
      bump(buckets.borderW, cs.borderTopWidth);
      bump(buckets.borderC, cs.borderTopColor);
    }
    if (cs.transitionDuration && cs.transitionDuration !== '0s') {
      for (const d of cs.transitionDuration.split(',')) bump(buckets.transitionDur, d.trim());
      for (const p of cs.transitionProperty.split(',')) bump(buckets.transitionProp, p.trim());
      // Splitting on commas must ignore commas inside cubic-bezier().
      for (const e of cs.transitionTimingFunction.split(/,(?![^(]*\))/)) bump(buckets.easing, e.trim());
    }
  }

  const sorted = {};
  for (const [k, v] of Object.entries(buckets)) {
    sorted[k] = Object.entries(v).sort((a, b) => b[1] - a[1]);
  }
  return { painted, buckets: sorted };
};

/**
 * Build fingerprint. Reads the served HTML + its stylesheet from the app
 * itself, so the baseline is bound to what the browser was actually given
 * rather than to whatever happens to be in the checkout.
 */
async function fingerprint(page) {
  return page.evaluate(async () => {
    const links = [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.getAttribute('href'));
    const sheets = [];
    for (const href of links) {
      try {
        const res = await fetch(href);
        const text = await res.text();
        let h = 0;
        for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
        sheets.push({ href, bytes: text.length, hash: (h >>> 0).toString(16) });
      } catch (e) { sheets.push({ href, error: String(e) }); }
    }
    // Sentinel: a selector that only exists AFTER the Brain active-row fix.
    // A pre-merge bundle therefore fails this rather than being baselined
    // silently — which is the exact mistake this harness exists to prevent.
    // NOTE: do not OR this with "does a <style> tag exist"; that short-circuits
    // to true and the sentinel then passes against every bundle, including the
    // stale one. It was written that way first and proved vacuous.
    let sentinel = false;
    for (const s of document.styleSheets) {
      try {
        if ([...s.cssRules].some((r) => r.selectorText?.includes('index-list .index-row-shell'))) { sentinel = true; break; }
      } catch { /* cross-origin sheet: not ours, skip */ }
    }
    return { html: location.origin + '/', sheets, sentinel_darkIndexRow: sentinel };
  });
}

/** Counts serve as the non-vacuity guard for the sweep itself. */
async function geometry(page) {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    dpr: window.devicePixelRatio,
    theme: document.documentElement.getAttribute('data-theme'),
    bodyClass: document.body.className,
    scrollHeight: document.documentElement.scrollHeight,
    elementCount: document.querySelectorAll('*').length,
  }));
}

function walkCss(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walkCss(full, out);
    else if (e.endsWith('.css')) out.push(full);
  }
  return out;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const surfaces = ONLY_SURFACE ? SURFACES.filter((s) => s.name === ONLY_SURFACE) : SURFACES;
  const themes = ONLY_THEME ? [ONLY_THEME] : THEMES;
  if (!surfaces.length) throw new Error(`no surface named ${ONLY_SURFACE}`);

  const browser = await chromium.launch();
  const report = { generatedAt: new Date().toISOString(), base: BASE, captures: [], fingerprint: null };

  try {
    for (const vp of VIEWPORTS) {
      for (const theme of themes) {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: 1,
          isMobile: vp.width < 500,
          hasTouch: vp.width < 500,
        });
        const page = await context.newPage();
        const errors = [];
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
        page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

        // Seed the theme the way the app persists it, then let the app apply it.
        await page.goto(BASE, { waitUntil: 'domcontentloaded' });
        await page.evaluate((t) => localStorage.setItem('nostos.theme', t), theme);

        for (const surface of surfaces) {
          await page.goto(BASE + surface.route, { waitUntil: 'networkidle' });
          // Let the wait-field breathe out and late art resolve before sampling.
          await page.waitForTimeout(1500);

          const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
          const geo = await geometry(page);
          const sweep = await page.evaluate(SWEEP);
          if (!report.fingerprint) report.fingerprint = await fingerprint(page);

          const tag = `${surface.name}-${vp.name}-${theme}`;
          const png = join(OUT, `${tag}.png`);
          await page.screenshot({ path: png, fullPage: false, animations: 'disabled' });

          // Non-vacuity: a surface that rendered nothing must fail loudly rather
          // than baseline as an empty page that every later diff "matches".
          if (geo.elementCount < 20 || sweep.painted < 10) {
            throw new Error(`${tag}: surface looks empty (elements=${geo.elementCount}, painted=${sweep.painted})`);
          }
          if (geo.dpr !== 1) throw new Error(`${tag}: DPR ${geo.dpr}, expected 1`);
          const themeOk = theme === 'dark' ? applied === 'dark' : applied === null || applied === 'light';
          if (!themeOk) throw new Error(`${tag}: theme '${theme}' not applied (data-theme=${applied})`);

          report.captures.push({ tag, surface: surface.name, viewport: vp.name, theme, png, applied, geo, sweep, errors });
          console.log(`  ✔ ${tag}  elements=${geo.elementCount} painted=${sweep.painted}${errors.length ? `  (${errors.length} console errors)` : ''}`);
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  // Non-vacuity on the whole run.
  if (report.captures.length !== VIEWPORTS.length * themes.length * surfaces.length) {
    throw new Error(`captured ${report.captures.length} of ${VIEWPORTS.length * themes.length * surfaces.length}`);
  }
  if (!report.fingerprint) throw new Error('no build fingerprint captured');
  // The bundle must be the code we think it is. This is the check that a whole
  // earlier session went without: it measured a bundle predating a merge to
  // main and every number described the old code. `node scripts/check-sentinel.mjs`
  // additionally proves the sentinel can go false.
  if (!report.fingerprint.sentinel_darkIndexRow) {
    throw new Error(
      'build sentinel FAILED: the served bundle does not contain the post-merge ' +
      "selector `index-list .index-row-shell`. The app is serving a stale build — " +
      'rebuild/restart before baselining (npm run prod, or PM2_HOME=/home/dev/.pm2 pm2 restart nostos).',
    );
  }

  const json = join(OUT, 'painted-values.json');
  writeFileSync(json, JSON.stringify(report, null, 1));

  const cssFiles = walkCss(join(frontendRoot, 'src'));
  const srcHash = createHash('sha256');
  for (const f of cssFiles.sort()) srcHash.update(f.replace(frontendRoot, '') + statSync(f).size);

  console.log(`\n  captures : ${report.captures.length}`);
  console.log(`  sheets   : ${report.fingerprint.sheets.map((s) => `${s.href?.split('/').pop()}(${s.hash})`).join(', ')}`);
  console.log(`  srcHash  : ${srcHash.digest('hex').slice(0, 12)}  (${cssFiles.length} css files)`);
  console.log(`  json     : ${json}`);
  console.log(`  pngs     : ${OUT}\n`);
}

main().catch((e) => { console.error('\n✖ ' + e.message + '\n'); process.exit(1); });
