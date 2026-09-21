import { expect, test } from '@playwright/test';

import { apiPost, loadFixture } from './support/fixture';

interface SeedBook {
  id: string;
  title: string;
}

const CASES = [
  { name: 'desktop-light', width: 1280, height: 800, mobile: false, theme: 'light' as const, minHero: 470 },
  { name: 'desktop-dark', width: 1280, height: 800, mobile: false, theme: 'dark' as const, minHero: 470 },
  { name: 'mobile-light', width: 390, height: 844, mobile: true, theme: 'light' as const, minHero: 300 },
  { name: 'mobile-dark', width: 390, height: 844, mobile: true, theme: 'dark' as const, minHero: 300 },
];

test.describe('Book Detail long-title hero', () => {
  const fixture = loadFixture();
  let book: SeedBook | null = null;
  let normalBook: SeedBook | null = null;

  test.beforeAll(async () => {
    normalBook = await apiPost<SeedBook>(fixture.baseUrl, '/api/books', {
      type: 'physical',
      title: 'Meditations',
      author: 'Marcus Aurelius',
    });

    const title = Array.from(
      { length: 14 },
      (_, i) => `A deliberately long volume title part ${i + 1} about memory, reading, interpretation and the return home`,
    ).join(' — ');

    book = await apiPost<SeedBook>(fixture.baseUrl, '/api/books', {
      type: 'physical',
      title,
      subtitle:
        'A similarly extended subtitle that forces the title block to demonstrate its real wrapping and vertical growth behavior instead of fitting the ordinary hero by accident',
      author:
        'An Author With An Intentionally Long Display Name That Must Wrap Without Escaping The Hero',
      editor:
        'An Editor Whose Contributor Line Is Also Long Enough To Participate In The Stress Layout',
      translator:
        'A Translator With Another Long Contributor Line For The Same Geometry Stress Case',
    });
  });

  test.afterAll(async () => {
    if (book) {
      await fetch(`${fixture.baseUrl}/api/books/${book.id}`, { method: 'DELETE' });
    }
    if (normalBook) {
      await fetch(`${fixture.baseUrl}/api/books/${normalBook.id}`, { method: 'DELETE' });
    }
  });

  for (const tc of CASES) {
    test(tc.name, async ({ browser }) => {
      expect(book).not.toBeNull();
      expect(normalBook).not.toBeNull();

      const context = await browser.newContext({
        viewport: { width: tc.width, height: tc.height },
        isMobile: tc.mobile,
        hasTouch: tc.mobile,
        deviceScaleFactor: 1,
      });
      await context.addInitScript((theme: 'light' | 'dark') => {
        localStorage.setItem('nostos.theme', theme);
      }, tc.theme);

      const page = await context.newPage();
      try {
        // The fix must not move an ordinary book: the old fixed height becomes
        // the minimum, so the normal composition stays at the exact same rung.
        await page.goto(`${fixture.baseUrl}/library/${normalBook!.id}`, {
          waitUntil: 'domcontentloaded',
        });
        await page.locator('.book-title').waitFor();
        const normalHeroHeight = await page
          .locator('.book-hero')
          .evaluate((el) => el.getBoundingClientRect().height);
        expect(normalHeroHeight).toBeCloseTo(tc.minHero, 0);

        await page.goto(`${fixture.baseUrl}/library/${book!.id}`, {
          waitUntil: 'domcontentloaded',
        });
        await page.locator('.book-title').waitFor();
        await page.locator('.cover-card').waitFor();

        const metrics = await page.evaluate(() => {
          const hero = document.querySelector('.book-hero') as HTMLElement;
          const copy = document.querySelector('.hero-copy') as HTMLElement;
          const cover = document.querySelector('.cover-card') as HTMLElement;
          const stage = document.querySelector('.hero-stage') as HTMLElement;

          const heroRect = hero.getBoundingClientRect();
          const coverRect = cover.getBoundingClientRect();
          const stageRect = stage.getBoundingClientRect();
          const contentBottom = Math.max(
            ...Array.from(copy.children)
              .filter((node) => (node as HTMLElement).getClientRects().length > 0)
              .map((node) => (node as HTMLElement).getBoundingClientRect().bottom),
          );

          return {
            heroHeight: heroRect.height,
            heroBottom: heroRect.bottom,
            contentBottom,
            coverTop: coverRect.top,
            stageTop: stageRect.top,
            contentToCoverGap: coverRect.top - contentBottom,
            overflowX:
              document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        });

        // This fixture must actually exceed the old hard cap; otherwise it is not
        // exercising the regression that #376 exists to prevent.
        expect(metrics.heroHeight).toBeGreaterThan(tc.minHero + 1);

        // The stage's cover deliberately overhangs the hero. What must never
        // overlap it is the title/author/contributor content itself.
        expect(metrics.contentToCoverGap).toBeGreaterThanOrEqual(16);
        expect(metrics.contentBottom).toBeLessThan(metrics.coverTop);
        expect(metrics.overflowX).toBeLessThanOrEqual(1);

        // The stage still begins after the hero in document flow; its negative
        // inner margin is what creates the intended cover overhang.
        expect(metrics.stageTop).toBeGreaterThanOrEqual(metrics.heroBottom - 1);
      } finally {
        await context.close();
      }
    });
  }
});
