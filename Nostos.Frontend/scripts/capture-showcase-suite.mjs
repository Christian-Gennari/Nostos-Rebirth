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
// Subject choice is part of the screenshot: the EPUB opens at a real reading
// position (Middlemarch, chapter VIII) so the shot shows body prose and a
// dual-page spread instead of a 0% cover page. The PDF is an English-language
// humanities article; the other three PDFs in the showcase are Russian-language
// journals, which read as an accident on an English landing page.
const EPUB_ID = '89bffc2a-5946-4453-ac6b-f1860e45b264';   // Middlemarch
const PDF_ID  = '84f841e0-705e-4f7a-94ea-71475fcd512a';   // Oral Tradition 16/1 (2001)
const AUDIO_ID = '6169c747-9a3b-46fa-8d4b-625ffc544140';  // Flatland (LibriVox)
// The Studio needs a document to be open, not just a populated tree, or the
// editor pane photographs its empty state. Seeded by showcase-tools/seed_writings.py.
const STUDIO_DOC_ID = '81e78659-3c39-4570-aba9-193301ff01f3';  // "Unhistoric Acts" 

const DESKTOP = { w: 1920, h: 1080 };
const MOBILE = { w: 390, h: 844 };

// ONLY=<substring> re-shoots a single screen while iterating, so a fix to one
// task does not require re-running the whole 22-shot suite.
const ONLY = process.env.ONLY || '';

const tasks = [];
for (const theme of ['light', 'dark']) {
  // Reading Room / Library: the hero screenshot.
  tasks.push({ name: `library-desktop-${theme}.png`, route: '/library', theme, ...DESKTOP });
  tasks.push({ name: `library-mobile-${theme}.png`, route: '/library', theme, ...MOBILE });

  // EPUB reader.
  tasks.push({ name: `epub-desktop-${theme}.png`, route: `/read/${EPUB_ID}`, theme, ...DESKTOP, waitReader: 2600 });
  tasks.push({ name: `epub-mobile-${theme}.png`, route: `/read/${EPUB_ID}`, theme, ...MOBILE, waitReader: 2600 });

  // PDF reader.
  tasks.push({ name: `pdf-desktop-${theme}.png`, route: `/read/${PDF_ID}`, theme, ...DESKTOP, waitReader: 2800, clickViewSettings: true });
  tasks.push({ name: `pdf-mobile-${theme}.png`, route: `/read/${PDF_ID}`, theme, ...MOBILE, waitReader: 2800, setFitWidth: true });

  // Audiobook player.
  tasks.push({ name: `reader-desktop-${theme}.png`, route: `/read/${AUDIO_ID}`, theme, ...DESKTOP, waitReader: 7000 });
  tasks.push({ name: `reader-mobile-${theme}.png`, route: `/read/${AUDIO_ID}`, theme, ...MOBILE, waitReader: 7000 });

  // Writing Studio.
  tasks.push({ name: `studio-desktop-${theme}.png`, route: '/studio', theme, ...DESKTOP, openStudioDoc: STUDIO_DOC_ID });
  tasks.push({ name: `studio-mobile-${theme}.png`, route: '/studio', theme, ...MOBILE, openStudioDoc: STUDIO_DOC_ID });

  // Concept Brain.
  tasks.push({ name: `brain-desktop-${theme}.png`, route: '/second-brain', theme, ...DESKTOP, clickMap: true });
  tasks.push({ name: `brain-mobile-${theme}.png`, route: '/second-brain', theme, ...MOBILE, clickMap: true });

  // Add Book, source mode (Project Gutenberg / LibriVox).
  tasks.push({ name: `add-book-source-${theme}.png`, route: '/library', theme, ...DESKTOP, openSourceModal: true });
}

/**
 * Open a specific Studio document.
 *
 * The file tree renders every folder collapsed, and on mobile the whole sidebar
 * starts closed, so on arrival neither the target row nor its ancestor folder is
 * in the DOM. This opens the sidebar when the empty state is showing, expands
 * folders until the row exists, then clicks it by data-node-id.
 *
 * The previous version clicked '.tree-row.nested' positionally, which depended
 * on whichever row happened to be first and, against an empty tree, did nothing
 * at all without failing - the editor pane photographed its empty state and the
 * suite reported success.
 */
async function openStudioDoc(page, docId) {
  const row = page.locator(`[data-node-id="${docId}"]`);

  // Mobile opens with the sidebar closed; the empty state holds the only
  // control that reveals it.
  const openSidebar = page.locator('.empty-state .btn-outline');
  if ((await row.count()) === 0 && (await openSidebar.count()) > 0) {
    await openSidebar.first().click();
    await page.waitForTimeout(500);
  }

  for (let attempt = 0; attempt < 4 && (await row.count()) === 0; attempt++) {
    const collapsed = page.locator('.toggle-btn:not(.expanded)').first();
    if ((await collapsed.count()) === 0) break;
    await collapsed.click();
    await page.waitForTimeout(400);
  }

  if ((await row.count()) === 0) {
    throw new Error(`Studio: no tree row for document ${docId}`);
  }

  await row.first().click();

  // TinyMCE boots asynchronously and only then parses the markdown into the
  // body, so wait for the editor to exist rather than on a fixed delay.
  await page
    .locator('.tox-editor-container')
    .first()
    .waitFor({ state: 'visible', timeout: 20000 })
    .catch(() => console.warn('Studio: TinyMCE container did not appear in time'));
  await page.waitForTimeout(2000);
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

/**
 * The PDF reader's reading mode (page-by-page vs continuous), page fit and zoom
 * now live behind the View settings panel. The desktop shot opens it so the
 * screenshot shows the modes rather than just a page.
 */
async function openViewSettings(page) {
  try {
    const btn = page.locator('button[aria-label="View settings"]').first();
    await btn.waitFor({ state: 'visible', timeout: 8000 });
    await btn.click({ timeout: 5000 });
    await page.waitForTimeout(900);
  } catch (e) {
    console.warn('View settings warning:', e.message);
  }
}

/**
 * A PDF opens at "whole page" fit, which is right on a desktop and leaves the
 * text too small to read on a phone. Switching to Fit width is what a reader
 * would actually do there, and the choice is remembered per document.
 */
async function setFitWidth(page) {
  try {
    const btn = page.locator('button[aria-label="View settings"]').first();
    await btn.waitFor({ state: 'visible', timeout: 8000 });
    await btn.click({ timeout: 5000 });
    await page.waitForTimeout(700);
    const fit = page.getByRole('button', { name: 'Fit width', exact: true }).first();
    await fit.waitFor({ state: 'visible', timeout: 5000 });
    await fit.click({ timeout: 5000 });
    await page.waitForTimeout(1800);
    // The scrim sits over the header, so the toggle that opened the panel is not
    // clickable while it is open - the shell closes it on Escape instead.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
  } catch (e) {
    console.warn('Fit width warning:', e.message);
  }
}

async function capture() {
  const browser = await chromium.launch({ headless: true });

  for (const t of tasks) {
    if (ONLY && !t.name.includes(ONLY)) continue;
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
      await openStudioDoc(page, t.openStudioDoc);
    } else if (t.clickMap) {
      await clickMap(page);
    } else if (t.openSourceModal) {
      await openSourceModal(page);
    }

    if (t.clickViewSettings) {
      await openViewSettings(page);
    }

    if (t.setFitWidth) {
      await setFitWidth(page);
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
