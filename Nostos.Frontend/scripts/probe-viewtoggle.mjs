#!/usr/bin/env node
/**
 * Computed-style probe for the view toggle (`nostos-view-toggle`).
 *
 * WHY THIS EXISTS
 * ---------------
 * Moving a hand-copied control into a shared component claims "the control is
 * unchanged". Screenshots cannot settle that: the library captures static frames,
 * and the interesting properties of this control live in states a frame does not
 * hold — the hover wash, the focus ring, the sliding thumb's transform, the
 * transition that makes it slide, and the roving tabindex that decides which
 * option Tab reaches. Geometry is the easy part; a migration that keeps the box
 * 68x32 and silently drops the motion or swaps which option is the tab stop still
 * "looks right" in every still.
 *
 * So: read the COMPUTED values for a fixed field list, per surface, per theme,
 * per width, at rest, on hover and on focus. Then compare a before-run against an
 * after-run and classify every difference as intended or not — the classifier is
 * the point, because "the JSON changed" is not a finding, and "every difference is
 * one of the four this change intends" is.
 *
 * Deliberately DUMB and DETERMINISTIC: flat sorted keys, no timestamps, no
 * element handles. Two runs on the same build must produce byte-identical JSON.
 *
 * Usage (assumes the app is already serving; it does not start one):
 *   node scripts/probe-viewtoggle.mjs --out /tmp/vt-before --port 5214
 *   node scripts/probe-viewtoggle.mjs --out /tmp/vt-after  --port 5391
 *   node scripts/probe-viewtoggle.mjs --diff /tmp/vt-before /tmp/vt-after
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
void here;

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

/** Surfaces that render the control, with the host class each surface used to
 *  carry (kept by the component, so one selector works on both builds). */
const SURFACES = [
  ['library', '/library', '.control-group'],
  ['brain', '/second-brain', '.view-mode-control'],
];
const THEMES = ['light', 'dark'];
const WIDTHS = [
  ['desktop', 1440, 900],
  ['mobile', 390, 780],
];

const measure = (page, selector) =>
  page.evaluate((sel) => {
    const g = document.querySelector(sel);
    if (!g) return null;
    const opts = Array.from(g.querySelectorAll('button'));
    const cs = (el, pseudo) => getComputedStyle(el, pseudo);
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    };
    const px = (v) => (v === undefined || v === null ? null : v);
    const thumb = cs(g, '::before');
    const thumbOn = thumb.content !== 'none' && thumb.content !== '';
    const pressed = opts.find((o) => o.getAttribute('aria-pressed') === 'true') ?? opts[0];
    const outline = (el, pseudo) => {
      const s = cs(el, pseudo);
      return `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`;
    };
    const glyph = (el) => {
      const svg = el.querySelector('svg');
      return svg
        ? {
            w: Math.round(svg.getBoundingClientRect().width * 100) / 100,
            h: Math.round(svg.getBoundingClientRect().height * 100) / 100,
            // Path geometry is a weight signature: light and regular are different
            // drawings, so a dropped weight change shows up as an equal length.
            path: svg.innerHTML.length,
            ink: cs(svg).fill !== 'none' ? cs(svg).fill : cs(el).color,
          }
        : null;
    };

    const out = {
      'track/w': box(g).w,
      'track/h': box(g).h,
      'track/radius': cs(g).borderRadius,
      'track/bg': cs(g).backgroundColor,
      'track/ring': cs(g).boxShadow,
      'track/padding': cs(g).padding,
      [`selected/fill`]: thumbOn ? thumb.backgroundColor : cs(pressed).backgroundColor,
      [`selected/ink`]: cs(pressed).color,
      // The tile's hairline. Which element CARRIES it moved (option -> thumb ::before),
      // so record both carriers and one normalized value: the normalized field is the
      // invariant this migration must not touch, and the carriers explain the move.
      [`selected/hairline`]: thumbOn ? outline(g, '::before') : outline(pressed),
      [`selected/tabindex`]: px(pressed.getAttribute('tabindex')),
      [`thumb/present`]: thumbOn,
    };
    if (thumbOn) {
      out['thumb/w'] = Math.round(parseFloat(thumb.width));
      out['thumb/h'] = Math.round(parseFloat(thumb.height));
      out['thumb/bg'] = thumb.backgroundColor;
      out['thumb/shadow'] = thumb.boxShadow;
      out['thumb/transform'] = thumb.transform;
      out['thumb/transition'] = `${thumb.transitionProperty} ${thumb.transitionDuration} ${thumb.transitionTimingFunction}`;
      out['thumb/outline'] = outline(g, '::before');
    }
    opts.forEach((o, i) => {
      out[`opt${i}/size`] = `${box(o).w}x${box(o).h}`;
      out[`opt${i}/bg`] = cs(o).backgroundColor;
      out[`opt${i}/ink`] = cs(o).color;
      out[`opt${i}/shadow`] = cs(o).boxShadow;
      out[`opt${i}/outline`] = outline(o);
      out[`opt${i}/aria-pressed`] = o.getAttribute('aria-pressed');
      out[`opt${i}/label`] = o.getAttribute('aria-label');
      const gl = glyph(o);
      if (gl) {
        out[`opt${i}/glyph/size`] = `${gl.w}x${gl.h}`;
        out[`opt${i}/glyph/drawing`] = gl.path;
        out[`opt${i}/glyph/ink`] = gl.ink;
      }
    });
    return out;
  }, selector);

const capture = async (page, target, theme, width) => {
  const { surface, path, selector } = target;
  await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => localStorage.setItem('nostos.theme', t), theme);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector(selector, { timeout: 25_000 });
  const fields = await measure(page, selector);
  const out = { ...(fields ?? {}) };
  if (!fields) return out;

  // Hover the option that is NOT selected: the wash is a state, not a frame.
  const others = page.locator(`${selector} button`);
  const count = await others.count();
  for (let i = 0; i < count; i += 1) {
    const o = others.nth(i);
    if ((await o.getAttribute('aria-pressed')) === 'true') continue;
    await o.hover();
    await page.waitForTimeout(240);
    out['state/hover/unselected-bg'] = await o.evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(120);
    break;
  }

  // Focus the selected option: the ring must be the shared focus token.
  const sel = page.locator(`${selector} button[aria-pressed="true"]`).first();
  await sel.focus();
  await page.waitForTimeout(120);
  out['state/focus/outline'] = await sel.evaluate((el) => {
    const s = getComputedStyle(el);
    return `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`;
  });
  out['state/focus/is-selected'] = await sel.evaluate((el) => document.activeElement === el);

  const prefix = `${surface}/${theme}/${width}`;
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [`${prefix}/${k}`, v]));
};

const port = arg('port', '5391');
const out = arg('out', null);
const diffPair = argv.includes('--diff') ? [argv[argv.indexOf('--diff') + 1], argv[argv.indexOf('--diff') + 2]] : null;

if (diffPair) {
  const [aDir, bDir] = diffPair;
  const a = JSON.parse(readFileSync(join(resolve(aDir), 'view-toggle-probe.json'), 'utf8'));
  const b = JSON.parse(readFileSync(join(resolve(bDir), 'view-toggle-probe.json'), 'utf8'));

  /**
   * What this change is allowed to move. Everything else must be identical, and
   * that is the assertion: a migration is only "preserved behaviour plus N intended
   * differences", never "close enough".
   */
  const INTENDED = [
    /\/thumb\//, // the thumb is new: the raise moved from the option to a shared tile
    /\/track\/ring$/, // one hairline around the track
    /\/opt\d\/shadow$/, // the raise left the option
    /\/glyph\/(drawing|ink)$/, // light -> regular is a different drawing
    /\/state\/hover\/unselected-bg$/, // the wash under an unselected option is new
  ];
  /** Does the field at `key` hold `value` in the after-run? */
  const after = (key) => b[key];
  /**
   * The three differences this migration produces that are MOVES rather than
   * changes. Each is only acceptable while its invariant holds, so each is gated:
   * a blanket whitelist here would hide a real colour change.
   */
  const isMechanismMove = (k) => {
    // Keys are `<surface>/<theme>/<width>/<owner>/<field>`; the owner is either an
    // option (`opt0`) or the normalized `selected`/`thumb` groups. Parse both, or the
    // gate below looks up "brain/light/desktop/opt0/opt0/aria-pressed" and silently
    // classifies nothing.
    const parts = k.split('/');
    const field = parts[parts.length - 1];
    const owner = parts[parts.length - 2];
    const scope = parts.slice(0, -2).join('/');
    // 1. The tile's fill moved from the option onto the thumb behind it: the option's
    //    own background goes transparent while the paint stays put.
    if (/^opt\d$/.test(owner) && field === 'bg') {
      return (
        b[`${scope}/${owner}/aria-pressed`] === 'true' &&
        after(`${scope}/selected/fill`) === a[`${scope}/selected/fill`]
      );
    }
    // 2. The tile's hairline moved from the option's outline onto the thumb's:
    //    same 1px, same colour, different carrier.
    if (/^opt\d$/.test(owner) && field === 'outline') {
      return after(`${scope}/selected/hairline`) === a[`${scope}/selected/hairline`];
    }
    // 3. Roving tabindex: the selected option is now the single tab stop, which is
    //    the intent (arrow keys change the view; Tab used to stop on both options).
    return owner === 'selected' && field === 'tabindex';
  };

  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const intended = [];
  const added = [];
  const removed = [];
  const unexpected = [];
  for (const k of keys) {
    const hasA = k in a;
    const hasB = k in b;
    if (hasA && !hasB) removed.push(`${k}: ${JSON.stringify(a[k])} -> (absent)`);
    else if (!hasA && hasB) (INTENDED.some((re) => re.test(k)) ? intended : added).push(`${k}: ${JSON.stringify(b[k])}`);
    else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
      const line = `${k}: ${JSON.stringify(a[k])} -> ${JSON.stringify(b[k])}`;
      (INTENDED.some((re) => re.test(k)) || isMechanismMove(k) ? intended : unexpected).push(line);
    }
  }
  const show = (label, list) => {
    console.log(`\n${label} (${list.length})`);
    for (const line of list) console.log(`  ${line}`);
  };
  show('INTENDED DIFFERENCES', intended);
  show('KEYS ADDED (unclassified)', added);
  show('KEYS REMOVED (unclassified)', removed);
  show('UNEXPECTED DIFFERENCES', unexpected);
  console.log(
    `\n${unexpected.length + added.length + removed.length === 0 ? 'PASS' : 'FAIL'}: ` +
      `${intended.length} intended, ${unexpected.length + added.length + removed.length} unexplained of ${keys.length} fields.`
  );
  process.exit(unexpected.length + added.length + removed.length === 0 ? 0 : 1);
}

const browser = await chromium.launch();
const report = {};
for (const [surfaceName, path, selector] of SURFACES) {
  for (const theme of THEMES) {
    for (const [widthLabel, width, height] of WIDTHS) {
      const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width, height } });
      Object.assign(report, await capture(page, { surface: surfaceName, path, selector }, theme, widthLabel));
      await page.close();
    }
  }
}
await browser.close();

const sorted = Object.fromEntries(Object.entries(report).sort(([x], [y]) => (x < y ? -1 : 1)));
if (!out) {
  console.log(JSON.stringify(sorted, null, 1));
} else {
  mkdirSync(resolve(out), { recursive: true });
  writeFileSync(join(resolve(out), 'view-toggle-probe.json'), `${JSON.stringify(sorted, null, 1)}\n`);
  console.log(`wrote ${join(resolve(out), 'view-toggle-probe.json')} (${Object.keys(sorted).length} fields)`);
}
