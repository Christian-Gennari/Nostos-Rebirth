import { chromium } from '@playwright/test';
import { resolve } from 'node:path';

// Captures the landing-page screenshot suite from the *showcase* instance on
// port 5341, which holds a curated public-domain library rather than a private
// one. Writes into the landing repo's assets/images/app-screens.
//
// Every shot is taken at deviceScaleFactor 2 so a 1920x1080 desktop shot is a
// true 3840x2160 retina capture, and each theme is captured in its own context.

const OUT_DIR = '/home/dev/coding/projects/nostos-rebirth-webpage/assets/images/app-screens';
const BASE_URL = 'http://127.0.0.1:5341';

// Showcase ids (resolved from the running instance, not hardcoded guesses).
const EPUB_ID = 'fdab7c94-5fd7-4ddd-8f14-aa334959eed9';   // Crime and Punishment
const PDF_ID  = '0bba1599-ae8a-4388-83a7-3ea175650912';   // Dostoevsky, Studia Litterarum
const AUDIO_ID = '6169c747-9a3b-46fa-8d4b-625ffc544140';  // Flatland (LibriVox)

const DESKTOP = { w: 1920, h: 1080 };
const MOBILE = { w: 390, h: 844 };

const tasks = [];
for (const theme of ['light', 'dark']) {
  // Reading Room / Library: the hero screenshot.
  tasks.push({ name: `library-desktop-${theme}.png`, route: '/library', theme, ...DESKTOP });
  tasks.push({ name: `library-mobile-${theme}.png`, route: '/library', theme, ...MOBILE });

  // EPUB reader.
  tasks.push({ name: `epub-desktop-${theme}.png`, route: `/read/${EPUB_ID}`, theme, ...DESKTOP, waitReader: 2600 });
  tasks.push({ name: `epub-mobile-${theme}.png`, route: `/read/${EPUB_ID}`, theme, ...MOBILE, waitReader: 2600 });

  // PDF reader.
  tasks.push({ name: `pdf-desktop-${theme}.png`, route: `/read/${PDF_ID}`, theme, ...DESKTOP, waitReader: 2800 });
  tasks.push({ name: `pdf-mobile-${theme}.png`, route: `/read/${PDF_ID}`, theme, ...MOBILE, waitReader: 2800 });

  // Audiobook player.
  tasks.push({ name: `reader-desktop-${theme}.png`, route: `/read/${AUDIO_ID}`, theme, ...DESKTOP, waitReader: 7000 });
  tasks.push({ name: `reader-mobile-${theme}.png`, route: `/read/${AUDIO_ID}`, theme, ...MOBILE, waitReader: 7000 });

  // Writing Studio.
  tasks.push({ name: `studio-desktop-${theme}.png`, route: '/studio', theme, ...DESKTOP, openStudioDoc: true });
  tasks.push({ name: `studio-mobile-${theme}.png`, route: '/studio', theme, ...MOBILE, openStudioDoc: true });

  // Concept Brain.
  tasks.push({ name: `brain-desktop-${theme}.png`, route: '/second-brain', theme, ...DESKTOP, clickMap: true });
  tasks.push({ name: `brain-mobile-${theme}.png`, route: '/second-brain', theme, ...MOBILE, clickMap: true });

  // Add Book, source mode (Project Gutenberg / LibriVox).
  tasks.push({ name: `add-book-source-${theme}.png`, route: '/library', theme, ...DESKTOP, openSourceModal: true });
}

async function openStudioDoc(page) {
  try {
    const toggle = page.locator('.toggle-btn').first();
    if (await toggle.isVisible()) {
      await toggle.click();
      await page.waitForTimeout(400);
    }
    const childDoc = page.locator('.tree-row.nested').first();
    if (await childDoc.isVisible()) {
      await childDoc.click();
      await page.waitForTimeout(1100);
    }
  } catch (e) {
    console.warn('Studio doc warning:', e.message);
  }
}

async function clickMap(page) {
  try {
    const mapBtn = page
      .locator('button[title*="Map" i], button[aria-label*="Map" i], button[title*="Graph" i], button[aria-label*="Graph" i]')
      .first();
    if (await mapBtn.isVisible()) {
      await mapBtn.click();
      await page.waitForTimeout(1100);
    }
  } catch (e) {
    console.warn('Map click warning:', e.message);
  }
}

async function openSourceModal(page) {
  try {
    // Wait for the control rather than sampling once: a DOM-ready document does
    // not mean the toolbar has rendered yet.
    const addBtn = page
      .locator('button:has-text("Add Book"), a:has-text("Add Book"), button:has-text("+ Add"), [data-testid="add-book"]')
      .first();
    await addBtn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    if (!(await addBtn.isVisible())) {
      console.warn('Add Book button not found');
      return;
    }
    await addBtn.click();
    await page.waitForTimeout(1200);

    // Move to the online-source mode of the modal.
    const sourceBtn = page
      .locator('button:has-text("Search online"), button:has-text("Online"), button:has-text("Gutenberg"), button:has-text("Source")')
      .first();
    if (await sourceBtn.isVisible()) {
      await sourceBtn.click();
      await page.waitForTimeout(800);
    }

    const queryInput = page.locator('#source-query, input[type="search"], .source-search input').first();
    if (await queryInput.isVisible()) {
      await queryInput.fill('Dostoevsky');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2500);
    }
  } catch (e) {
    console.warn('Add modal warning:', e.message);
  }
}

async function capture() {
  const browser = await chromium.launch({ headless: true });

  for (const t of tasks) {
    console.log(`Capturing ${t.name} (${t.w}x${t.h} @2x)...`);
    const context = await browser.newContext({
      viewport: { width: t.w, height: t.h },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    await page.addInitScript((theme) => {
      localStorage.setItem('nostos_theme', theme);
      document.documentElement.setAttribute('data-theme', theme);
    }, t.theme);

    // 'networkidle' never fires on the audiobook route: the player streams a
    // ~120 MB M4B, so the network is legitimately busy. Wait for the document
    // and then rely on the per-task settle time below.
    await page.goto(`${BASE_URL}${t.route}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
    await page.evaluate((theme) => {
      document.documentElement.setAttribute('data-theme', theme);
    }, t.theme);

    // The app is an SPA: give it a beat to render before any task-specific
    // interaction, since a DOM-ready document does not mean a painted route.
    await page.waitForTimeout(1500);

    if (t.waitReader) {
      await page.waitForTimeout(t.waitReader);
    } else if (t.openStudioDoc) {
      await openStudioDoc(page);
    } else if (t.clickMap) {
      await clickMap(page);
    } else if (t.openSourceModal) {
      await openSourceModal(page);
    }

    await page.waitForTimeout(900);
    await page.screenshot({ path: resolve(OUT_DIR, t.name) });
    await context.close();
  }

  await browser.close();
  console.log('Showcase capture suite finished.');
}

capture().catch((err) => {
  console.error('Suite error:', err);
  process.exit(1);
});
