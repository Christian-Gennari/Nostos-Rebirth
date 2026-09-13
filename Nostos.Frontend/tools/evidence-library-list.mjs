#!/usr/bin/env node
/**
 * Builds the before/after evidence sheets for the library list-view polish.
 *
 * Runs both builds through the probe in --verify mode (identical viewport,
 * filter and row set, real library data), captures the results region at rest
 * and with a row hovered, then composites them into a single labelled sheet so
 * the visual diff is readable at a glance.
 *
 * Usage: node tools/evidence-library-list.mjs <before-dist> <after-dist> <out-dir>
 */
import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const beforeDist = path.resolve(process.argv[2]);
const afterDist = path.resolve(process.argv[3]);
const outDir = path.resolve(process.argv[4] ?? 'tools/probe-out/evidence');
mkdirSync(outDir, { recursive: true });

const API = 'http://127.0.0.1:5099';

async function shoot(distDir, label, port) {
  const server = spawn(
    process.execPath,
    [path.join(import.meta.dirname, 'probe-server.mjs'), distDir, String(port), API],
    { stdio: 'ignore' }
  );
  await new Promise((r) => setTimeout(r, 1600));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/library`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() =>
    localStorage.setItem(
      'nostos.library.preferences',
      JSON.stringify({ viewMode: 'list', sort: 'lastread', pageSize: 14, sidebarExpanded: false, groupByWork: true })
    )
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // Same crop for both builds: the first N rows, header included, at 1:1.
  const stage = page.locator('.results-stage');
  await stage.screenshot({ path: path.join(outDir, `${label}-rest.png`) });

  await page.locator('.table-row').nth(1).hover();
  await page.waitForTimeout(500);
  await stage.screenshot({ path: path.join(outDir, `${label}-hover.png`) });

  const shot = { label };
  const blur = await page.evaluate(() =>
    [...document.querySelectorAll('*')].filter((el) => {
      const s = getComputedStyle(el);
      return s.backdropFilter && s.backdropFilter !== 'none' && s.display !== 'none' && s.opacity !== '0';
    }).length
  );
  shot.liveBlurLayers = blur;
  shot.badgeFilter = await page.evaluate(() => {
    const b = document.querySelector('.table-view .format-badge');
    return b ? getComputedStyle(b).backdropFilter : null;
  });
  shot.geometry = await page.evaluate(() => {
    const row = document.querySelector('.table-row');
    const r = (sel) => {
      const el = row.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height) };
    };
    const btns = [...row.querySelectorAll('.finished-btn-list, .fav-btn-list')].map((el) => {
      const b = el.getBoundingClientRect();
      return { cls: el.className.split(' ')[0], x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height) };
    });
    return {
      cover: r('.list-cover-frame'),
      titleHeaderX: Math.round(document.querySelector('#title-header').getBoundingClientRect().x),
      titleCell: r('.col.title'),
      statusCluster: r('.list-row-status'),
      buttons: btns,
    };
  });
  shot.domNodes = await page.evaluate(() => document.getElementsByTagName('*').length);

  await browser.close();
  server.kill();
  return shot;
}

const before = await shoot(beforeDist, 'before', 4341);
const after = await shoot(afterDist, 'after', 4342);

/** Composite the two shots into one labelled sheet (PIL, no ImageMagick dep). */
const SHEET_PY = `
import sys
from PIL import Image, ImageDraw, ImageFont
out, name, before_label, before_file, after_label, after_file = sys.argv[1:7]
fs = []
for f in (before_file, after_file):
    im = Image.open(f).convert('RGB')
    w = 1180
    im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    fs.append(im)
pad, band = 16, 46
W = max(im.width for im in fs) + pad * 2
H = sum(im.height + band for im in fs) + pad * 2
sheet = Image.new('RGB', (W, H), (27, 30, 38))
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
except Exception:
    font = ImageFont.load_default()
y = pad
for label, im in zip((before_label, after_label), fs):
    draw.text((pad, y + 8), label, fill=(237, 238, 242), font=font)
    y += band
    sheet.paste(im, (pad, y))
    y += im.height + pad
sheet.save(out)
print(out, sheet.size)
`;

function sheet(name, beforeFile, beforeLabel, afterFile, afterLabel) {
  const out = path.join(outDir, `${name}.png`);
  const stdout = execFileSync(
    'python3',
    ['-c', SHEET_PY, out, name, beforeLabel, beforeFile, afterLabel, afterFile],
    { encoding: 'utf8' }
  );
  process.stdout.write(stdout);
}

sheet(
  'list-before-after-rest',
  path.join(outDir, 'before-rest.png'),
  'BEFORE — list at rest (heart/check crammed in the left gutter, before the cover)',
  path.join(outDir, 'after-rest.png'),
  'AFTER — list at rest (cover flush left; status appears on hover, active always visible)'
);
sheet(
  'list-before-after-hover',
  path.join(outDir, 'before-hover.png'),
  'BEFORE — row hovered (both toggles sit tight against the cover, 16x20 hit area)',
  path.join(outDir, 'after-hover.png'),
  'AFTER — row hovered (status pair trails the title, 26x26 hit area, clear of edit/delete)'
);

writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify({ before, after }, null, 2));
console.log(JSON.stringify({ before, after }, null, 2));
console.log(`sheets -> ${outDir}`);
