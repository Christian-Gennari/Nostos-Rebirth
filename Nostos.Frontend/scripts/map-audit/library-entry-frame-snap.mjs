#!/usr/bin/env node
/**
 * library-entry-frame-snap.mjs — does the Library entrance jump a device pixel
 * on the final frame of the animation?
 *
 * The defect class (see #423, `compositor-pixel-snap`): while an animation runs,
 * the animated element is rasterized on its own composited surface, whose
 * alignment can differ by one device pixel from the resting paint. When the
 * animation ends and the surface is dropped, the content snaps into place — one
 * frame of visible movement inside a page that does not move. A static
 * screenshot after the animation will never see this: the measurement has to
 * compare the LAST ANIMATED frame with the SETTLED frame of one run.
 *
 * Modes (which entrance to measure):
 *   cold     — load /library fresh (grid mount + library-content-in fade)
 *   reentry  — leave to /studio via the dock and come back (route re-entry:
 *              stage swap release + grid remount)
 *   swap     — change the sort order on a populated library (in-place swap)
 *
 * Method:
 *   - GPU Chromium (ANGLE/Vulkan, `--headless=new`): the artifact lives in the
 *     compositor path, so software raster cannot show it and a time-scrubbed
 *     animation bypasses it.
 *   - `Page.startScreencast` captures the REAL composited frames.
 *   - Every tail frame is compared to the settled frame by sub-pixel
 *     correlation of high-contrast crops:
 *       anchor  — the toolbar; must read 0.00px or the whole run moved (carrier)
 *       grid    — the entire .book-grid
 *       card    — the first .book-card
 *       wrapper — its .cover-wrapper
 *       cover   — the .cover-image art raster
 *       cover2  — the SECOND card's art (a snap can hit one column, not all)
 *       title   — the .meta-title text raster
 *   - VERDICT on the money frame (settle-1, the last animated frame): every
 *     region with a reading must be ~0.00px. A region may only convict or
 *     clear when its reading is trustworthy:
 *       mad < 20        — blurred content biases sub-pixel correlation
 *                         (measured: up to ~0.5px of fake offset that decays
 *                         smoothly with the blur), so it can neither speak;
 *       spread >= 2     — a flat crop (empty text box, uniform band) ties under
 *                         every shift and manufactures offsets out of noise.
 *     Frames that are still audibly blurred are informative only.
 *   - An in-page rAF recorder logs layout rects + grid opacity + the
 *     `library-content-in` state, so "did the DOM geometry move?" has an answer
 *     independent of the pixels.
 *
 * Isolating a suspect without rebuilding: `--mutate stage-notransform` injects
 * the candidate rule into the running page (style tag) before driving, so the
 * same run shape can be replayed with one rule neutralized. A clean sweep with
 * the mutation in place = the rule is the cause.
 *
 * Usage (from the repo root; the backend must serve the built frontend, e.g.
 * `dotnet run -c Release --urls http://0.0.0.0:5340` in the worktree):
 *   node Nostos.Frontend/scripts/map-audit/library-entry-frame-snap.mjs \
 *        [--mode cold|reentry|swap] [--base http://127.0.0.1:5340] [--quick]
 *        [--runs N] [--theme dark|light] [--out DIR] [--save-frames]
 *        [--vp 1280x800@1,1920x1080@2] [--mutate stage-notransform|wrapper-notz]
 *
 * Exit code 0 = every run certified clean; 1 = a jump was measured (dirty);
 * 2 = coverage failed to certify (money frame missed or too blurred) — rerun.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, rmSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const BASE = arg('base', 'http://127.0.0.1:5340');
const MODE = arg('mode', 'cold');
const OUT = arg('out', `Nostos.Frontend/.map-audit-out/library-entry-snap/${MODE}`);
const RUNS = Number(arg('runs', 3));
const THEME = arg('theme', 'dark');
const MUTATE = arg('mutate', 'none'); // none | stage-notransform | wrapper-notz
const QUICK = argv.includes('--quick');
const SAVE_FRAMES = argv.includes('--save-frames');
const VPS = arg('vp', ''); // --vp 1280x800@1,1920x1080@2 overrides the standard list

const CASES = VPS
  ? VPS.split(',').map((s) => {
      const [wh, dpr] = s.split('@');
      const [w, h] = wh.split('x').map(Number);
      return { w, h, dpr: Number(dpr || 1) };
    })
  : QUICK
    ? [{ w: 1920, h: 1080, dpr: 1 }]
    : [
        { w: 1280, h: 800, dpr: 1 },
        { w: 1440, h: 900, dpr: 1 },
        { w: 1600, h: 900, dpr: 1 },
        { w: 1920, h: 1080, dpr: 1 },
        { w: 1920, h: 1080, dpr: 2 },
      ];

mkdirSync(OUT, { recursive: true });
const JSONL = join(OUT, 'runs.jsonl');
if (existsSync(JSONL)) rmSync(JSONL);

// ── pixel helpers ────────────────────────────────────────────────────────────
function decode(buf) {
  const png = PNG.sync.read(buf);
  return { w: png.width, h: png.height, data: png.data };
}

/** Grayscale luminance plane of a crop (x, y, w, h in image px). */
function plane(img, x, y, w, h) {
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = ((y + j) * img.w + (x + i)) << 2;
      out[j * w + i] = 0.299 * img.data[k] + 0.587 * img.data[k + 1] + 0.114 * img.data[k + 2];
    }
  }
  return out;
}

/** Mean abs luminance difference between two crops (sampled, cheap pre-check). */
function preMad(a, b, x, y, w, h) {
  let s = 0, n = 0;
  for (let j = 0; j < h; j += 3) {
    for (let i = 0; i < w; i += 3) {
      const ka = ((y + j) * a.w + (x + i)) << 2;
      const kb = ((y + j) * b.w + (x + i)) << 2;
      s += Math.abs(a.data[ka] - b.data[kb]);
      n++;
    }
  }
  return s / n;
}

/** Whole-frame near-equality for settle detection (sampled, tolerant). */
function frameDiff(a, b) {
  let s = 0, n = 0;
  for (let p = 0; p < a.data.length; p += 4 * 17) {
    s += Math.abs(a.data[p] - b.data[p]) + Math.abs(a.data[p + 1] - b.data[p + 1]) + Math.abs(a.data[p + 2] - b.data[p + 2]);
    n += 3;
  }
  return s / n;
}

/**
 * Best alignment of plane `a` onto plane `b` over integer shifts, refined to a
 * sub-pixel estimate by parabolic fit on the 3x3 SSD bowl. Returns the offset
 * that must be ADDED to a's coordinates to land on b, in px.
 */
function align(a, b, w, h, maxShift = 4) {
  const ssd = (dx, dy) => {
    let s = 0;
    for (let j = maxShift; j < h - maxShift; j++) {
      for (let i = maxShift; i < w - maxShift; i++) {
        const d = a[j * w + i] - b[(j + dy) * w + (i + dx)];
        s += d * d;
      }
    }
    return s;
  };
  let best = { dx: 0, dy: 0, v: Infinity };
  const grid = [];
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      const v = ssd(dx, dy);
      grid.push({ dx, dy, v });
      if (v < best.v) best = { dx, dy, v };
    }
  }
  const at = (dx, dy) => grid.find((g) => g.dx === dx && g.dy === dy)?.v ?? Infinity;
  const refine = (v0, vm, vp) => {
    const denom = vm - 2 * v0 + vp;
    if (!isFinite(denom) || denom === 0) return 0;
    const s = (0.5 * (vm - vp)) / denom;
    return Math.abs(s) <= 1 ? s : 0;
  };
  const dxs = best.dx + refine(best.v, at(best.dx - 1, best.dy), at(best.dx + 1, best.dy));
  const dys = best.dy + refine(best.v, at(best.dx, best.dy - 1), at(best.dx, best.dy + 1));
  return { dx: +dxs.toFixed(3), dy: +dys.toFixed(3), mad: +Math.sqrt(best.v / ((w - 2 * maxShift) * (h - 2 * maxShift))).toFixed(3) };
}

/**
 * Luminance spread of a region's plane. A flat region (empty text box, uniform
 * fill, blank band) gives every shift the same SSD — correlation ties there are
 * meaningless and must never convict or clear a run.
 */
function planeStd(p) {
  let s = 0, s2 = 0;
  for (let i = 0; i < p.length; i++) { const v = p[i]; s += v; s2 += v * v; }
  const m = s / p.length;
  return Math.sqrt(Math.max(0, s2 / p.length - m * m));
}

const MOVING = ['grid', 'card', 'wrapper', 'cover', 'cover2', 'title'];
const MONEY_BLUR_LIMIT = 20; // a region may only convict/clear if its own mad < this
const CONTENT_FLOOR = 2; // ...and if its settled crop has real content (luminance spread)
const SETTLE_EPS = 0.15; // consecutive-frame diff under this = settled; over it = an event

// ── capture ──────────────────────────────────────────────────────────────────
async function captureRun(browser, { w, h, dpr }) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: dpr,
    serviceWorkers: 'block',
  });
  const page = await ctx.newPage();
  await page.addInitScript(({ theme }) => {
    localStorage.setItem('nostos.theme', theme);
    localStorage.setItem(
      'nostos.library.preferences',
      JSON.stringify({
        viewMode: 'grid',
        sort: 'lastread',
        pageSize: 20,
        sidebarExpanded: true,
        groupByWork: true,
        assistantEnabled: false,
        assistantVoiceEnabled: false,
      }),
    );
    // Independent layout/timeline ground truth: rAF sampler storing CHANGES only.
    const state = { entries: [] };
    let last = '';
    const rect = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return [b.left, b.top, b.width, b.height].map((v) => +v.toFixed(3));
    };
    const sample = () => {
      try {
        const grid = document.querySelector('.book-grid');
        const stage = document.querySelector('.results-stage');
        const anim = grid ? grid.getAnimations()[0] : null;
        const entry = {
          t: +performance.now().toFixed(1),
          card: rect(document.querySelector('.book-card')),
          cover: rect(document.querySelector('.book-card .cover-image')),
          wrapper: rect(document.querySelector('.book-card .cover-wrapper')),
          grid: rect(grid),
          gop: grid ? +parseFloat(getComputedStyle(grid).opacity).toFixed(4) : null,
          stageCls: stage ? (stage.className || '') : null,
          stageT: stage ? getComputedStyle(stage).transform : null,
          anim: anim
            ? `${anim.animationName}:${anim.playState}:${anim.currentTime === null ? 'null' : Math.round(Number(anim.currentTime))}`
            : null,
          n: document.querySelectorAll('.book-grid .book-card').length,
        };
        const key = JSON.stringify(entry);
        const rest = key.replace(/"t":[0-9.]+/, '');
        if (rest !== last) {
          state.entries.push(entry);
          last = rest;
        }
        if (state.entries.length < 1200) requestAnimationFrame(sample);
      } catch {
        /* page navigating */
      }
    };
    window.__probe = state;
    requestAnimationFrame(sample);
  }, { theme: THEME });

  const cdp = await page.context().newCDPSession(page);
  // Headless matches `(hover: none)`; the library's bloom branches on it, so
  // emulate a desktop pointer or a different animation variant would be captured.
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'hover', value: 'hover' },
      { name: 'pointer', value: 'fine' },
    ],
  });

  const frames = [];
  cdp.on('Page.screencastFrame', (f) => {
    frames.push({ ts: f.metadata.timestamp, data: f.data });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', {
    format: 'png',
    maxWidth: w * dpr,
    maxHeight: h * dpr,
    everyNthFrame: 1,
  });

  const t0 = Date.now();
  await page.goto(`${BASE}/library`, { waitUntil: 'load' });
  await page.waitForSelector('.book-grid .cover-image', { timeout: 25000 });
  await page.waitForTimeout(MODE === 'cold' ? 1600 : 1100);

  // Fix-candidate isolation: neutralize one code path in the live page and see
  // whether the jump disappears. The real fix is then made in the CSS.
  if (MUTATE === 'stage-notransform') {
    await page.addStyleTag({
      content:
        '.results-stage{transition:opacity var(--library-swap-in) var(--ease-out),filter var(--library-swap-in) var(--ease-out) !important;}' +
        '.results-stage.is-swapping{transform:none !important;}',
    });
  } else if (MUTATE === 'wrapper-notz') {
    await page.addStyleTag({ content: '.cover-wrapper{transform:none !important;}' });
  }

  if (MODE === 'reentry') {
    await page.click('.dock-item[title="Writing Studio"]');
    await page.waitForURL('**/studio', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(900);
    await page.click('.dock-item[title="Library"]');
    await page.waitForSelector('.book-grid .cover-image', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2400);
  } else if (MODE === 'swap') {
    const current = (await page.locator('.sort-select .nostos-dropdown__value').innerText()).trim();
    await page.click('.sort-select .nostos-dropdown__trigger');
    await page.waitForTimeout(250);
    const opts = page.locator('.sort-select .nostos-dropdown__option');
    const n = await opts.count();
    let clicked = false;
    for (let i = 0; i < n; i++) {
      const t = (await opts.nth(i).innerText()).trim();
      if (t !== current) {
        await opts.nth(i).click();
        clicked = true;
        break;
      }
    }
    if (!clicked) console.log('  WARN: no non-current sort option found');
    await page.waitForTimeout(2400);
  } else if (MODE === 'cold') {
    await page.waitForTimeout(0);
  } else {
    throw new Error(`unknown mode ${MODE}`);
  }

  const regions = await page.evaluate(({ dpr }) => {
    const scale = (r) => ({ x: Math.round(r.left * dpr), y: Math.round(r.top * dpr), w: Math.round(r.width * dpr), h: Math.round(r.height * dpr) });
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1 ? scale(r) : null;
    };
    return {
      anchor: pick('.toolbar'),
      grid: pick('.book-grid'),
      card: pick('.book-card'),
      wrapper: pick('.book-card .cover-wrapper'),
      cover: pick('.book-card .cover-image'),
      title: pick('.book-card .meta-title'),
      cover2: pick('.book-grid > .book-card:nth-child(2) .cover-image'),
      cols: getComputedStyle(document.querySelector('.book-grid')).gridTemplateColumns,
      cardRect: (() => { const r = document.querySelector('.book-card').getBoundingClientRect(); return { left: +r.left.toFixed(3), top: +r.top.toFixed(3), w: +r.width.toFixed(3), h: +r.height.toFixed(3) }; })(),
      anims: [...document.querySelector('.book-grid').getAnimations({ subtree: false })].map((a) => ({ name: a.animationName, state: a.playState, fill: a.effect?.getTiming?.().fill })),
      timeline: window.__probe?.entries ?? [],
    };
  }, { dpr });

  await cdp.send('Page.stopScreencast');
  await ctx.close();
  return { frames, regions, elapsed: Date.now() - t0 };
}

// ── main ─────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: [
    '--use-angle=vulkan',
    '--enable-gpu-rasterization',
    '--enable-oop-rasterization',
    '--disable-software-rasterizer',
    '--ignore-gpu-blocklist',
  ],
});

const results = [];
let dirtyTotal = 0, uncoveredTotal = 0;

for (const c of CASES) {
  for (let run = 1; run <= RUNS; run++) {
    const campaign = `${MODE}${MUTATE !== 'none' ? '-' + MUTATE : ''}-${c.w}x${c.h}@${c.dpr}-${THEME}`;
    const dir = join(OUT, campaign, `run${run}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    const { frames, regions } = await captureRun(browser, c);
    process.stdout.write(`\n${campaign} run ${run}: ${frames.length} frames captured\n`);

    const imgs = frames.map((f) => decode(Buffer.from(f.data, 'base64')));
    if (!imgs.length) {
      console.log('  NO FRAMES captured — aborting run');
      uncoveredTotal++;
      continue;
    }
    const fw = imgs[0].w, fh = imgs[0].h;
    const clamp = (r) => {
      if (!r) return null;
      const x = Math.max(0, Math.min(r.x, fw - 8));
      const y = Math.max(0, Math.min(r.y, fh - 8));
      return { x, y, w: Math.min(r.w, fw - x), h: Math.min(r.h, fh - y) };
    };
    const reg = {};
    for (const [k, v] of Object.entries(regions)) {
      if (v && v.x !== undefined) reg[k] = clamp(v);
    }
    const missing = ['anchor', 'grid', 'card', 'wrapper', 'cover', 'title'].filter((k) => !reg[k]);
    if (missing.length) console.log(`  MISSING REGIONS: ${missing.join(', ')}`);

    // Settle point: first frame of the tail where consecutive frames are
    // (near-)identical over the whole frame — tolerant to a lone AA pixel but
    // strict enough that a sub-pixel content shift breaks the run.
    let settle = imgs.length - 1;
    while (settle > 1) {
      if (frameDiff(imgs[settle - 1], imgs[settle]) >= SETTLE_EPS) break;
      settle--;
    }

    const target = imgs[imgs.length - 1];
    const tailStart = Math.max(0, settle - 13);
    const tail = [];
    for (let i = tailStart; i < imgs.length; i++) {
      const row = { frame: i, ts: +frames[i].ts.toFixed(3), transient: false };
      if (reg.grid) {
        const t = preMad(imgs[i], target, reg.grid.x, reg.grid.y, reg.grid.w, reg.grid.h);
        if (t > 40) { row.transient = true; row.preMad = +t.toFixed(1); }
      }
      if (!row.transient) {
        for (const [k, r] of Object.entries(reg)) {
          const pa = plane(imgs[i], r.x, r.y, r.w, r.h);
          const pb = plane(target, r.x, r.y, r.w, r.h);
          const al = align(pa, pb, r.w, r.h, 4);
          row[k] = { dx: al.dx, dy: al.dy, mad: al.mad };
        }
      }
      tail.push(row);
    }

    // Verdict on the money frame — settle-1, the last frame that differs from
    // the settled tail (a difference over SETTLE_EPS means something moved in
    // that step: motion, or the jump). Each region may only convict or clear if
    // its own mad is small (blur makes sub-pixel correlation unreliable — it
    // manufactures offsets that decay with the blur, measured up to ~0.5px).
    const money = tail.find((f) => f.frame === settle - 1) ?? null;
    const std = {};
    for (const k of MOVING.concat(['anchor'])) {
      if (reg[k]) std[k] = +planeStd(plane(target, reg[k].x, reg[k].y, reg[k].w, reg[k].h)).toFixed(2);
    }
    const flat = MOVING.filter((k) => std[k] !== undefined && std[k] < CONTENT_FLOOR);
    let verdict = 'uncovered';
    const dirtyRegions = [];
    const judgeable = [];
    if (money && !money.transient) {
      const anchorOk = !money.anchor || (Math.abs(money.anchor.dx) <= 0.05 && Math.abs(money.anchor.dy) <= 0.05);
      if (!anchorOk) {
        verdict = 'uncovered'; // whole carrier moved — cannot judge this run
      } else {
        for (const k of MOVING) {
          const o = money[k];
          if (!o || std[k] === undefined || std[k] < CONTENT_FLOOR) continue;
          if (o.mad < MONEY_BLUR_LIMIT) {
            judgeable.push(k);
            if (Math.abs(o.dx) > 0.4 || Math.abs(o.dy) > 0.4) dirtyRegions.push(k);
          }
        }
        if (dirtyRegions.length) verdict = 'DIRTY';
        else if (judgeable.length) verdict = 'clean';
      }
    }
    if (verdict === 'DIRTY') dirtyTotal++;
    if (verdict === 'uncovered') uncoveredTotal++;

    console.log(`  settle frame: ${settle} / ${imgs.length - 1}   verdict: ${verdict}${dirtyRegions.length ? ` [${dirtyRegions.join(', ')}]` : ''}${flat.length ? `   flat(ignored): ${flat.join(', ')}` : ''}`);
    if (money && !money.transient) {
      console.log(`  money f${money.frame}: ${MOVING.map((k) => (money[k] ? `${k}:${money[k].dx},${money[k].dy}(m${money[k].mad})` : null)).filter(Boolean).join('  ')}`);
    }
    console.log(`  regions: ${Object.entries(reg).map(([k, r]) => `${k}=${r.w}x${r.h}@${r.x},${r.y}`).join('  ')}`);
    console.log(`  card box: ${JSON.stringify(regions.cardRect)}  cols: ${regions.cols}`);
    console.log(`  grid anim at rest: ${JSON.stringify(regions.anims)}`);
    for (const t of tail) {
      const mark = t.frame === settle - 1 ? ' MONEY' : '';
      if (t.transient) { console.log(`   f${String(t.frame).padStart(4)}  transient(preMad ${t.preMad})${mark}`); continue; }
      const marks = MOVING.filter((k) => t[k]).map((k) => `${k}:${t[k].dx},${t[k].dy}(m${t[k].mad})`).join(' ');
      console.log(`   f${String(t.frame).padStart(4)}  anchor:${t.anchor ? `${t.anchor.dx},${t.anchor.dy}` : '-'}  ${marks}${mark}`);
    }
    const tl = regions.timeline;
    const layoutKeys = ['card', 'wrapper', 'grid'];
    const layoutDrift = [];
    for (let i = 1; i < tl.length; i++) {
      for (const k of layoutKeys) {
        const a = JSON.stringify(tl[i - 1][k]), b = JSON.stringify(tl[i][k]);
        if (a !== b) layoutDrift.push({ t: tl[i].t, key: k, from: tl[i - 1][k], to: tl[i][k] });
      }
    }
    if (layoutDrift.length) console.log(`  LAYOUT DRIFT: ${JSON.stringify(layoutDrift.slice(0, 6))}`);
    const stageTransforms = [...new Set(tl.map((e) => e.stageT).filter(Boolean))];
    if (stageTransforms.length > 1) console.log(`  stage transforms seen: ${stageTransforms.slice(0, 8).join(' | ')}${stageTransforms.length > 8 ? ' ...' : ''}`);

    // Save frames: tail only unless --save-frames.
    const saveFrom = SAVE_FRAMES ? 0 : tailStart;
    for (let i = saveFrom; i < frames.length; i++) {
      writeFileSync(join(dir, `${String(i).padStart(4, '0')}.png`), Buffer.from(frames[i].data, 'base64'));
    }

    const record = {
      campaign, run, theme: THEME, mode: MODE, mutate: MUTATE, viewport: c, verdict,
      dirtyRegions, flatRegions: flat, regionStd: std, money: money ? { frame: money.frame, transient: money.transient, ...Object.fromEntries(MOVING.concat(['anchor']).map((k) => [k, money[k] ?? null])) } : null,
      settle, total: imgs.length, framesSaved: frames.length - saveFrom,
      regions: reg, cardRect: regions.cardRect, cols: regions.cols,
      anims: regions.anims, layoutDrift,
      stageTransforms: stageTransforms.slice(0, 12),
      timeline: tl,
      tail,
    };
    results.push(record);
    appendFileSync(JSONL, JSON.stringify(record) + '\n');
  }
}

writeFileSync(join(OUT, 'summary.json'), JSON.stringify(results, null, 1));
console.log(`\n${results.length} runs, ${dirtyTotal} dirty, ${uncoveredTotal} uncovered. wrote ${join(OUT, 'summary.json')}`);
await browser.close();
process.exit(dirtyTotal ? 1 : uncoveredTotal ? 2 : 0);
