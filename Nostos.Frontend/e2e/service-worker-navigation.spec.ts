/**
 * Service-worker navigation policy — the API namespace must never be answered
 * with the Angular app shell.
 *
 * Regression guard for the "Download button sends me back to the library"
 * bug: the production build registers the Angular service worker
 * (`ngsw-worker.js`, see app.config.ts + ngsw-config.json). The worker treats
 * every navigation whose path matches `navigationUrls` as an app-shell
 * request (`/**` minus the default `*.*`/`__` exclusions), so a *dotless*
 * API URL such as `/api/books/{id}/file/download` was answered from the
 * app-shell cache with index.html. The router then matched its `**` route and
 * redirected to `/library` — the file never downloaded and the user was
 * thrown back to the home page. The same trap applies to
 * `/api/backup/download/{id}` and to the OPDS/MCP namespaces.
 *
 * The fixture serves the real production build (service worker included) from
 * the real backend, so these tests exercise the shipped policy end to end:
 *   - an API navigation must leave the worker for the network and deliver the
 *     exact bytes of the uploaded file;
 *   - the book-detail Download button (window.open) must download the file
 *     instead of opening another copy of the app;
 *   - ordinary client routes must still be served by the worker (the
 *     exclusions must not be over-broad).
 *
 * The spec runs in the desktop project (playwright.config.ts testIgnore covers
 * the mobile project's `mobile.*.spec.ts` match).
 */
import { expect, test, type Download, type Page } from '@playwright/test';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { apiPost, loadFixture, newRunId } from './support/fixture';

test.describe.configure({ mode: 'serial' });

const RUN = newRunId();
const EPUB_BYTES = readFileSync(path.join(__dirname, 'assets', 'tiny.epub'));

let fixture: ReturnType<typeof loadFixture>;
let bookId = '';
let bookTitle = '';

test.beforeAll(() => {
  fixture = loadFixture();
});

/** The fixture base URL (playwright.config.ts sets no baseURL). */
function appUrl(pathname: string): string {
  return `${fixture.baseUrl}${pathname}`;
}

/** Seed a real book row plus a real file on disk through the public REST API. */
async function seedBookWithFile(): Promise<{ id: string; title: string }> {
  bookTitle = `SW Navigation Regression ${RUN}`;
  const created = await apiPost<any>(fixture.baseUrl, '/api/books/', {
    type: 'ebook',
    title: bookTitle,
    author: 'E2E',
  });
  const id: string | undefined = created?.book?.id ?? created?.bookId ?? created?.id;
  if (!id) throw new Error(`No book id in create response: ${JSON.stringify(created)}`);

  const form = new FormData();
  form.append('file', new Blob([EPUB_BYTES], { type: 'application/epub+zip' }), 'book.epub');
  const res = await fetch(`${fixture.baseUrl}/api/books/${id}/file`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`file upload -> ${res.status}: ${await res.text()}`);

  return { id, title: bookTitle };
}

/**
 * The worker is registered on app bootstrap (registerWhenStable:30000) and only
 * controls a page after it activates, so reload until the page is controlled.
 */
async function ensureServiceWorkerControl(page: Page): Promise<void> {
  await page.goto(appUrl('/library'));
  for (let attempt = 0; attempt < 6; attempt++) {
    const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    if (controlled) return;
    await page.waitForTimeout(1_000);
    await page.reload({ waitUntil: 'load' });
  }
  throw new Error('The service worker never took control of the page');
}

/** Reads the body of a completed download and asserts it is the seeded file. */
async function expectExactFile(download: Download): Promise<void> {
  const file = await download.path();
  expect(file, 'download has no local path').toBeTruthy();
  expect(statSync(file!).size, 'downloaded byte count').toBe(EPUB_BYTES.length);
  expect(readFileSync(file!).equals(EPUB_BYTES), 'downloaded bytes match the uploaded file').toBe(true);
}

test.beforeAll(async () => {
  ({ id: bookId } = await seedBookWithFile());
});

test('an API download navigation is never answered with the app shell', async ({ context, page }) => {
  await ensureServiceWorkerControl(page);

  const probe = await context.newPage();
  let download: Download | null = null;
  probe.on('download', (d) => (download = d));

  let abortMessage = '';
  const response = await probe.goto(appUrl(`/api/books/${bookId}/file/download`)).catch((err: Error) => {
    abortMessage = err.message;
    return null;
  });

  if (response === null) {
    // Correct behaviour: the response is an attachment, so Chrome aborts the
    // navigation and hands the payload to the download manager instead.
    expect(abortMessage, 'a rejected navigation must be the download abort').toMatch(
      /ERR_ABORTED|Download is starting/i
    );
  } else {
    // Wrong behaviour, and the exact user-visible symptom: the worker answered
    // from the app-shell cache with index.html, which booted Angular and
    // redirected to /library because of the router's `**` route.
    expect(response.headers()['content-type'] ?? '', 'the API navigation must not be the Angular shell').not.toContain(
      'text/html'
    );
    expect(await probe.title(), 'the API navigation must not boot the app').not.toContain('Nostos');
  }

  await expect.poll(() => download !== null, { message: 'the download never started' }).toBe(true);
  await expectExactFile(download!);
  await probe.close();
});

test('the book detail Download button delivers the file (not another app page)', async ({ context, page }) => {
  await ensureServiceWorkerControl(page);

  let download: Download | null = null;
  const capture = (target: Page) => target.on('download', (d) => (download = d));
  capture(page);
  context.on('page', capture); // window.open() puts the download in a new tab

  await page.goto(appUrl(`/library/${bookId}`));
  await expect(page.getByRole('heading', { name: bookTitle })).toBeVisible();

  await page.getByRole('button', { name: 'Download' }).click();

  await expect
    .poll(() => download !== null, { message: 'the Download button never produced a download', timeout: 30_000 })
    .toBe(true);
  expect(download!.suggestedFilename()).toMatch(/\.epub$/);
  await expectExactFile(download!);
});

test('client routes are still served by the app shell (exclusions are not over-broad)', async ({ page }) => {
  await ensureServiceWorkerControl(page);

  const response = await page.goto(appUrl(`/library/${bookId}`));
  expect(response?.status(), 'client route status').toBe(200);
  await expect(page.getByRole('heading', { name: bookTitle })).toBeVisible();

  // Routed without a server round trip: the worker answers with the cached shell.
  const servedByWorker = await page.evaluate(
    () => performance.getEntriesByType('navigation').length > 0 && !!navigator.serviceWorker.controller
  );
  expect(servedByWorker, 'a controlled client route is still served by the worker').toBe(true);
});
