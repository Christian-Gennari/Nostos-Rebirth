#!/usr/bin/env node
/**
 * Task 13 evidence capture: with the isolated fixture already running
 * (launch-fixture.mjs launch), seed a minimal dashboard through supported
 * REST and capture full-page PNGs at desktop (1280x800) and mobile
 * (390x844, touch, 2x DPR) viewports under e2e/test-results/.
 *
 * Usage:
 *   node e2e/support/launch-fixture.mjs launch
 *   node e2e/support/capture-success.mjs
 *   node e2e/support/launch-fixture.mjs kill
 *
 * Prints the artifact paths on success.
 */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const E2E_DIR = path.resolve(HERE, '..');
const STATE_FILE = path.join(HERE, 'fixture-state.json');
const OUT_DIR = path.join(E2E_DIR, 'test-results');

if (!existsSync(STATE_FILE)) {
  console.error('[capture] fixture-state.json missing; launch the fixture first.');
  process.exit(2);
}
const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));

async function post(urlPath, body) {
  const res = await fetch(`${state.baseUrl}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${urlPath} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Seed books + an Active session so the dashboard is fully populated. */
async function seedDashboard() {
  await post('/api/reading-training/initialize', {
    clientId: 'task13-capture',
    idempotencyKey: 'task13-capture-init',
  });
  const candide = await post('/api/books', {
    type: 'physical',
    title: 'Candide',
    author: 'Voltaire',
    language: 'French',
    categories: 'literature',
  });
  const meditations = await post('/api/books', {
    type: 'physical',
    title: 'Meditations',
    author: 'Marcus Aurelius',
    language: 'English',
    categories: 'philosophy',
  });
  const assignCandide = await post('/api/reading-training/books', {
    clientId: 'task13-capture',
    idempotencyKey: 'task13-capture-assign-1',
    bookId: candide.id,
    mode: 1, // Deep
    makeDefault: true,
  });
  await post('/api/reading-training/books', {
    clientId: 'task13-capture',
    idempotencyKey: 'task13-capture-assign-2',
    bookId: meditations.id,
    mode: 0, // Endurance
    makeDefault: true,
  });
  const plan = await post('/api/reading-training/sessions/plan', {
    clientId: 'task13-capture',
    idempotencyKey: 'task13-capture-plan',
    bookAssignmentId: assignCandide.data.id,
    mode: 1,
    targetMinutes: 45,
  });
  const start = await post('/api/reading-training/sessions/start', {
    clientId: 'task13-capture',
    idempotencyKey: 'task13-capture-start',
  });
  if (start.data.status !== 2) {
    throw new Error(`session did not start (status ${start.data?.status}): ${start.reply}`);
  }
  if (plan.data.id !== start.data.id) {
    throw new Error('start did not continue the planned session');
  }
}

async function capturePage(browser, opts, outName, waitHeading) {
  const page = await browser.newPage(opts);
  try {
    await page.goto(`${state.baseUrl}/training`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: waitHeading }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1_000); // let the elapsed ticker and layout settle
    const outPath = path.join(OUT_DIR, outName);
    await page.screenshot({ path: outPath, fullPage: true });
    console.log(`[capture] ${outName} (${opts.viewport.width}x${opts.viewport.height}) -> ${outPath}`);
    return outPath;
  } finally {
    await page.close();
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  await seedDashboard();

  const browser = await chromium.launch();
  try {
    const desktopPath = await capturePage(
      browser,
      { viewport: { width: 1280, height: 800 } },
      'desktop-success.png',
      'Reading Training'
    );
    const mobilePath = await capturePage(
      browser,
      {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
      'mobile-success.png',
      'Reading Training'
    );
    console.log(`[capture] artifacts: ${desktopPath}, ${mobilePath}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`[capture] failed: ${err.message}`);
  process.exit(1);
});
