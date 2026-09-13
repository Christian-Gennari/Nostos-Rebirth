#!/usr/bin/env node
/**
 * Computed-style probe for icon buttons.
 *
 * WHY THIS EXISTS
 * ---------------
 * The pixel gate (`check-pixels.mjs`) captures STATIC frames. It cannot see
 * `:hover`, `:focus` or `:disabled` — so a migration can silently break a hover
 * transition and every screenshot still matches. That is not hypothetical: a
 * `transition: all` -> explicit-property conversion left 25 sites where the
 * trailing time bound only to the LAST property, so the earlier properties SNAPPED
 * instead of animating. 24/24 captures matched throughout.
 *
 * So any claim of the form "this migration preserved behaviour" is only meaningful
 * if it is backed by a computed-style comparison at rest AND on hover AND on focus.
 * That is what this produces.
 *
 * It is deliberately DUMB and DETERMINISTIC: stable identity per element, fixed
 * field list, sorted output, no timestamps. Two runs on the same build must produce
 * byte-identical JSON, or the diff below means nothing. (Verify with `--verify`.)
 *
 * Usage:
 *   node scripts/probe-iconbutton.mjs --out /tmp/probe-before
 *   node scripts/probe-iconbutton.mjs --out /tmp/probe-after
 *   node scripts/probe-iconbutton.mjs --diff /tmp/probe-before /tmp/probe-after
 *
 * Assumes the app is already serving, like capture-baseline.mjs. It does not start one.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, '..');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const PORT = arg('port', '5214');
const BASE = `http://127.0.0.1:${PORT}`;
// Icon buttons live on these. The reader is first because the harness elsewhere
// learned that surface ORDER changes what a time-dependent page renders.
/**
 * Surfaces that actually render icon buttons, in capture order, each with the
 * SETUP needed to expose them.
 *
 * Only ~13 of the 30 call sites in the templates are reachable at rest: the rest
 * live inside `@if` branches (reader panels, studio zen mode, library list view,
 * the add-book modal). A probe that only samples the default view would leave the
 * majority of call sites unverified, so each surface runs real interactions first.
 *
 * `settings` is deliberately ABSENT: it contains no icon-button call site at all
 * (verified by grep), and probing a surface with zero buttons proves nothing.
 *
 * What must be covered is every distinct SIZE, TONE and STATE, not every call site:
 * the risk in a shared component is that one variant renders wrong, and 20 copies of
 * the same variant add no information.
 */
const SURFACES = [
  {
    name: 'reader',
    route: '/read/f9c17fb2-e42d-4db5-a3d0-b0a45b73f12e',
    // TOC and notes panels carry their own close buttons.
    setup: async (page) => {
      for (const sel of ['.icon-btn[title*="Table"], .icon-btn[title*="Contents"]', '.icon-btn[title*="Notes"]']) {
        const el = await page.$(sel);
        if (el) { await el.click().catch(() => {}); await page.waitForTimeout(300); }
      }
    },
  },
  {
    name: 'library-list',
    route: '/library',
    // The two row buttons (.edit / .delete) exist only in LIST view.
    setup: async (page) => {
      const opts = await page.$$('.toggle-opt');
      if (opts[0]) { await opts[0].click().catch(() => {}); await page.waitForTimeout(500); }
    },
  },
  {
    name: 'library-modal',
    route: '/library',
    // The modal's close button is a distinct icon-btn with a 20px glyph.
    setup: async (page) => {
      const btn = await page.$('button.btn-primary');
      if (btn) { await btn.click().catch(() => {}); await page.waitForTimeout(600); }
    },
  },
  {
    name: 'studio',
    route: '/studio',
    setup: async (page) => {
      // Zen mode swaps the header buttons for zen-exit / zen-toggle.
      const z = await page.$('#zen-toggle, .zen-toggle, [class*="zen"]');
      if (z) { await z.click().catch(() => {}); await page.waitForTimeout(400); }
    },
  },
  {
    name: 'brain-notes',
    route: '/second-brain',
    // note-card's 5 buttons only render once a concept with notes is open.
    setup: async (page) => {
      const item = await page.$('.index-item, .tree-row, .nav-item');
      if (item) { await item.click().catch(() => {}); await page.waitForTimeout(600); }
    },
  },
];
const THEMES = ['light', 'dark'];

/** Fields compared. Keep this list explicit: a new field must be a deliberate choice. */
// Settle-by-polling budget: ~1.2s worst case, well past the 200ms control transition.
const SETTLE_STEP_MS = 60;
const SETTLE_ATTEMPTS = 20;

const FIELDS = [
  'display', 'width', 'height', 'boxSizing', 'padding', 'margin',
  'borderRadius', 'borderTopWidth', 'borderTopColor', 'borderTopStyle',
  'backgroundColor', 'color', 'opacity', 'boxShadow', 'outline',
  'transitionProperty', 'transitionDuration', 'transitionTimingFunction',
  'alignItems', 'justifyContent', 'gap', 'position', 'transform',
  'visibility', 'pointerEvents', 'fontSize', 'cursor',
];

/** Reads the fields above, plus a stable identity, for every icon button on screen. */
const COLLECT = (fields) => {
  const css = (el, prop) => getComputedStyle(el).getPropertyValue(prop).trim();
  const els = Array.from(document.querySelectorAll('[class*="icon-btn"]'));
  return els.map((el, i) => {
    const cls = (el.className || '').trim();
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const values = {};
    for (const f of fields) values[f] = style[f] ?? '';
    // The inner glyph is where an encapsulation mistake shows up: if the component
    // cannot style it, the icon renders at its default size instead of the
    // intended one, and the button looks right while the glyph grows.
    const glyph = el.querySelector('lucide-icon, svg');
    return {
      // Stable across runs: id if present, else the class list + ordinal.
      id: el.id || `${el.tagName.toLowerCase()}:${cls}:${i}`,
      tag: el.tagName.toLowerCase(),
      cls,
      dataTip: el.getAttribute('data-tip'),
      ariaLabel: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      // Accessible name minus the native title, so a migration that drops
      // a text label (or keeps one it should not) is caught.
      text: (el.textContent || '').trim() || null,
      disabled: 'disabled' in el ? !!el.disabled : null,
      rect: { w: Math.round(rect.width), h: Math.round(rect.height) },
      glyph: glyph ? { w: Math.round(glyph.getBoundingClientRect().width), h: Math.round(glyph.getBoundingClientRect().height) } : null,
      values,
    };
  });
};

async function probe(page, theme) {
  await page.goto(`${BASE}/library`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => localStorage.setItem('nostos.theme', t), theme);

  const out = [];
  for (const surface of SURFACES) {
    await page.goto(BASE + surface.route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900); // let the surface settle before sampling
    // Expose branch-hidden buttons. A failure here is NOT fatal: the surface may
    // legitimately render no icon buttons, and the coverage report below says so.
    if (surface.setup) {
      try { await surface.setup(page); } catch { /* reported via the button count */ }
      await page.waitForTimeout(300);
    }

    // Re-apply the theme: the theme service is the only writer of the attribute and
    // re-applies from localStorage on boot, so a set BEFORE navigation is wiped.
    const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const timings = [];
    for (const [state, act] of [
      ['rest', null],
      ['hover', async (h) => { await h.hover({ timeout: 2000 }); }],
      ['focus', async (h) => { await h.evaluate((e) => e.focus()); }],
    ]) {
      const els = await page.$$('[class*="icon-btn"]');
      // Sample at most MAX_PER_CLASS elements per distinct class. The library list
      // renders 80 identical row buttons; verifying the variant once is enough, and
      // hovering all 240 of them made the probe too slow to finish in one command.
      const MAX_PER_CLASS = Number(arg('max-per-class', '3'));
      const seen = new Map();
      const indexes = [];
      for (let i = 0; i < els.length; i++) {
        const cls = (await els[i].getAttribute('class')) || '';
        const n = seen.get(cls) ?? 0;
        if (n >= MAX_PER_CLASS) continue;
        seen.set(cls, n + 1);
        indexes.push(i);
      }
      const collected = [];
      for (const i of indexes) {
        const el = els[i];
        try {
          // Apply the state, and VERIFY it took. A hover that silently misses makes
          // the sample a lie, so retry a few times and record the outcome.
          const applyState = async () => {
            if (state === 'hover') await el.hover({ timeout: 1500 });
            else if (state === 'focus') await el.evaluate((e) => e.focus());
          };
          await applyState();
          for (let attempt = 0; attempt < 3; attempt++) {
            const applied = await el
              .evaluate((e) => e.matches(':hover') || document.activeElement === e)
              .catch(() => false);
            if (applied) break;
            await page.waitForTimeout(80);
            await applyState();
          }
          // Settle by polling, NOT by a fixed magic wait. A fixed wait is what broke
          // this probe: at 60ms a 200ms hover transition is sampled mid-flight, so
          // the same CSS produced different numbers and the diff reported phantom
          // regressions. Poll until two consecutive reads agree, so the sampled value
          // is the settled one, and cap it so a genuinely animating property fails
          // loudly rather than hanging.
          const readOnce = () =>
            page.evaluate(
              ([idx, fields]) => {
                const all = Array.from(document.querySelectorAll('[class*="icon-btn"]'));
                const el = all[idx];
                if (!el) return null;
                const style = getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                const values = {};
                for (const f of fields) values[f] = style[f] ?? '';
                const glyph = el.querySelector('lucide-icon, svg');
                // Optical offset of the glyph against the button box. A component that
                // changes the host's box model can leave the glyph correctly sized but
                // off-centre, which is exactly the defect that survives a size check.
                const grect = glyph ? glyph.getBoundingClientRect() : null;
                const offset = grect
                  ? { dx: +((grect.left + grect.width / 2) - (rect.left + rect.width / 2)).toFixed(2),
                      dy: +((grect.top + grect.height / 2) - (rect.top + rect.height / 2)).toFixed(2) }
                  : null;
                return {
                  id: el.id || `${el.tagName.toLowerCase()}:${(el.className || '').trim()}:${idx}`,
                  offset,
                  tag: el.tagName.toLowerCase(),
                  cls: (el.className || '').trim(),
                  dataTip: el.getAttribute('data-tip'),
                  ariaLabel: el.getAttribute('aria-label'),
                  title: el.getAttribute('title'),
                  text: (el.textContent || '').trim() || null,
                  disabled: 'disabled' in el ? !!el.disabled : null,
                  rect: { w: Math.round(rect.width), h: Math.round(rect.height) },
                  glyph: glyph ? { w: Math.round(glyph.getBoundingClientRect().width), h: Math.round(glyph.getBoundingClientRect().height) } : null,
                  // Did the state we asked for actually take effect? Without this the
                  // probe silently records the UN-hovered values in a `hover` sample
                  // when the pointer misses (or Angular re-renders the node mid-hover),
                  // and the diff then reports a phantom regression.
                  stateApplied: el.matches(':hover') || document.activeElement === el,
                  values,
                };
              },
              [i, FIELDS],
            );
          let snap = await readOnce();
          for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
            await page.waitForTimeout(SETTLE_STEP_MS);
            const next = await readOnce();
            if (JSON.stringify(next) === JSON.stringify(snap)) break;
            snap = next;
          }
          if (snap) collected.push(snap);
        } catch {
          collected.push({ id: `unreachable:${i}`, error: `${state} failed` });
        }
      }
      timings.push({ state, buttons: collected });
    }
    out.push({ surface: surface.name, theme, applied, states: timings });
  }
  return out;
}

// ------------------------------------------------------------------- diff mode
if (argv.includes('--diff')) {
  const [aPath, bPath] = [argv[argv.indexOf('--diff') + 1], argv[argv.indexOf('--diff') + 2]];
  const A = JSON.parse(readFileSync(aPath, 'utf8'));
  const B = JSON.parse(readFileSync(bPath, 'utf8'));
  const key = (s) => `${s.surface}/${s.theme}`;
  const am = new Map(A.surfaces.map((s) => [key(s), s]));
  const bm = new Map(B.surfaces.map((s) => [key(s), s]));
  let diffs = 0;
  for (const [k, sa] of am) {
    const sb = bm.get(k);
    if (!sb) { console.log(`  ${k}: MISSING in after`); diffs++; continue; }
    for (const stateA of sa.states) {
      const stateB = sb.states.find((x) => x.state === stateA.state);
      if (!stateB) { console.log(`  ${k} [${stateA.state}]: MISSING`); diffs++; continue; }
      const byId = new Map(stateB.buttons.map((b) => [b.id, b]));
      for (const btnA of stateA.buttons) {
        const btnB = byId.get(btnA.id);
        if (!btnB) {
          console.log(`  ${k} [${stateA.state}] ${btnA.id}: ABSENT after (was: ${btnA.cls})`);
          diffs++;
          continue;
        }
        for (const f of Object.keys(btnA.values ?? {})) {
          const va = btnA.values[f];
          const vb = btnB.values?.[f];
          if (va !== vb) {
            console.log(`  ${k} [${stateA.state}] ${btnA.id} .${f}: "${va}" -> "${vb}"`);
            diffs++;
          }
        }
        if (JSON.stringify(btnA.glyph) !== JSON.stringify(btnB.glyph)) {
          console.log(`  ${k} [${stateA.state}] ${btnA.id} glyph: ${JSON.stringify(btnA.glyph)} -> ${JSON.stringify(btnB.glyph)}`);
          diffs++;
        }
        if (JSON.stringify(btnA.rect) !== JSON.stringify(btnB.rect)) {
          console.log(`  ${k} [${stateA.state}] ${btnA.id} rect: ${JSON.stringify(btnA.rect)} -> ${JSON.stringify(btnB.rect)}`);
          diffs++;
        }
        if (JSON.stringify(btnA.offset) !== JSON.stringify(btnB.offset)) {
          console.log(`  ${k} [${stateA.state}] ${btnA.id} glyph offset: ${JSON.stringify(btnA.offset)} -> ${JSON.stringify(btnB.offset)}`);
          diffs++;
        }
        // Accessibility + interaction surface. Without these three the diff would
        // happily report "identical" while a migration silently dropped an
        // aria-label, a tooltip, or a disabled state — the component's whole
        // reason to exist over a bare class.
        for (const f of ['ariaLabel', 'dataTip', 'disabled', 'title', 'text', 'stateApplied']) {
          if (btnA[f] === undefined && btnB[f] === undefined) continue;
          if (JSON.stringify(btnA[f]) !== JSON.stringify(btnB[f])) {
            console.log(`  ${k} [${stateA.state}] ${btnA.id} ${f}: ${JSON.stringify(btnA[f])} -> ${JSON.stringify(btnB[f])}`);
            diffs++;
          }
        }
      }
      for (const btnB of stateB.buttons) {
        if (!stateA.buttons.some((x) => x.id === btnB.id)) {
          console.log(`  ${k} [${stateA.state}] ${btnB.id}: NEW after (${btnB.cls})`);
          diffs++;
        }
      }
    }
  }
  for (const k of bm.keys()) if (!am.has(k)) { console.log(`  ${k}: NEW surface after`); diffs++; }
  console.log(diffs ? `\n✖ ${diffs} difference(s)` : '\n✔ probes identical');
  process.exit(diffs ? 1 : 0);
}

// ------------------------------------------------------------------ capture mode
const OUT = resolve(arg('out', join(frontendRoot, 'e2e/visual-evidence/iconbutton-probe')));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const surfaces = [];
let total = 0;
for (const theme of THEMES) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  // Same frozen clock as capture-baseline.mjs: the reader paints a live elapsed-time
  // readout, so without this the probe differs run to run through no fault of the code.
  if (page.clock?.install) await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  const got = await probe(page, theme);
  surfaces.push(...got);
  total += got.reduce((n, s) => n + (s.states.find((x) => x.state === 'rest')?.buttons.length ?? 0), 0);
  await context.close();
}
await browser.close();

const payload = { fields: FIELDS, surfaces };
writeFileSync(join(OUT, 'iconbutton.json'), JSON.stringify(payload, null, 1));

// --- coverage: what matters is DISTINCT VARIANTS, not raw call-site count.
// A shared component fails by rendering one variant wrong; 20 copies of the same
// variant tell us nothing extra. So report the variants actually sampled.
const variantOf = (b) => {
  const v = b.values ?? {};
  return `${v.width}x${v.height} r=${v.borderRadius} cls="${b.cls}"`;
};
const variants = new Map();
for (const s of surfaces) {
  for (const st of s.states) {
    for (const b of st.buttons) {
      if (st.state !== 'rest') continue;
      if (!variants.has(variantOf(b))) variants.set(variantOf(b), { count: 0, where: new Set() });
      const rec = variants.get(variantOf(b));
      rec.count++;
      rec.where.add(s.surface);
    }
  }
}
console.log(`  buttons sampled (rest, both themes): ${total}`);
console.log(`  distinct size/tone variants covered: ${variants.size}`);
for (const [v, rec] of [...variants.entries()].sort()) {
  console.log(`     ${rec.count}x  ${v}   [${[...rec.where].join(', ')}]`);
}
console.log(`  json: ${join(OUT, 'iconbutton.json')}`);

// Non-vacuity. What must be true for any later "identical" claim to mean something:
//  - at least 2 distinct variants (else the component is only tested one way);
//  - hover and focus states present (the states a screenshot cannot show);
//  - the .xs 24px rung present (the one most likely to be broken by a size refactor).
const hasStates = surfaces.some((s) => s.states.some((x) => x.state === 'hover' && x.buttons.length))
  && surfaces.some((s) => s.states.some((x) => x.state === 'focus' && x.buttons.length));
// Variant keys look like '24pxx24px r=50% cls="icon-btn xs delete"'.
const hasXs = [...variants.keys()].some((k) => k.startsWith('24pxx24px'));
const problems = [];
if (total < 6) problems.push(`only ${total} buttons found — the probe is not seeing them`);
if (variants.size < 2) problems.push(`only ${variants.size} distinct variant(s) — the component would be verified one way only`);
if (!hasStates) problems.push('no hover/focus state captured — the probe cannot prove what a screenshot cannot show');
if (!hasXs) problems.push('the 24px .xs rung was not captured — that is the size most likely to break');
if (problems.length) {
  console.error('\n✖ probe coverage is insufficient, so nothing it reports can be trusted:');
  for (const p of problems) console.error(`   - ${p}`);
  process.exit(1);
}
console.log('\n✔ coverage: multiple distinct variants, hover+focus captured, 24px rung present');
