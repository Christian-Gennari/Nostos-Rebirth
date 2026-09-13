/**
 * Cohesion evidence for the Second Brain, seeded with realistic data.
 *
 * The earlier fixtures were 1-5 trivial concepts with no quotes, which is why the
 * design pass missed the quote presentation entirely: nothing on screen exercised
 * it. This seeds several books with mixed note kinds (quote + commentary,
 * quote-only, plain) so every card shape and every index state is represented,
 * then captures desktop and mobile in light and dark.
 *
 * Isolation: the fixture is shared and `visual-regression`'s empty-state test
 * requires it pristine, so this spec records the concept ids that existed before
 * it seeded and deletes only the ones it created (via `cleanupBrain`).
 */
import { expect, test } from '@playwright/test';
import { apiPost, loadFixture } from './support/fixture';
import { cleanupBrain, snapshotConceptIds, type BrainSeed } from './support/brain-fixture';
import { capturePng, DESKTOP_VIEWPORT, MOBILE_VIEWPORT, newCapturePage } from './support/visual-capture';

test.describe.configure({ mode: 'serial' });

const BOOKS: Array<{
  title: string;
  author: string;
  notes: Array<{ content: string; selectedText?: string }>;
}> = [
  {
    title: 'Critique of Practical Reason',
    author: 'Immanuel Kant',
    notes: [
      {
        content:
          'The two sources of awe. Worth returning to when the moral law feels abstract. [[Duty]] [[Moral Law]]',
        selectedText:
          'Two things fill the heart with ever renewed and increasing awe and reverence, the more often and the more steadily we meditate upon them: the starry firmament above and the moral law within.',
      },
      {
        content: '[[Duty]] against inclination — the whole argument in one sentence.',
        selectedText:
          'Duty! Thou sublime and mighty name that dost embrace nothing charming or insinuating.',
      },
      { content: '[[Moral Law]] is the only thing that can be called good without qualification.' },
    ],
  },
  {
    title: 'Meditations',
    author: 'Marcus Aurelius',
    notes: [
      {
        content:
          'On the discipline of attention. This is the passage I keep coming back to. [[Attention]] [[Duty]]',
        selectedText:
          'Confine thyself to the present. Nothing is so conducive to greatness of mind as the ability to examine systematically and honestly everything that meets us.',
      },
      {
        content: '[[Attention]] is a practice, not a talent.',
        selectedText: 'The soul becomes dyed with the colour of its thoughts.',
      },
      { content: '[[Solitude]] and the inner citadel.' },
    ],
  },
  {
    title: 'The World as Will and Representation',
    author: 'Arthur Schopenhauer',
    notes: [
      { content: '[[Memory]] and the persistence of the will.' },
      { content: '[[Solitude]] — the argument that company degrades. [[Attention]]' },
      {
        content: '[[Reading]] as thinking in someone else’s head.',
        selectedText:
          'When we read, another person thinks for us: we merely repeat his mental process. It is the same as the pupil, in learning to write, following with his pen the lines that the teacher has written.',
      },
    ],
  },
  {
    title: 'The Order of Time',
    author: 'Carlo Rovelli',
    notes: [
      { content: '[[Memory]] is what lets us construct a past at all.' },
      { content: '[[Attention]] to the present moment, described physically.' },
    ],
  },
];

let seed: BrainSeed | null = null;

async function ensureSeed(fixture: ReturnType<typeof loadFixture>): Promise<BrainSeed> {
  if (seed) return seed;

  // Snapshot BEFORE creating anything, so cleanup can restore the fixture exactly.
  const beforeConceptIds = await snapshotConceptIds(fixture.baseUrl);
  const firstBook = await apiPost<{ id: string }>(fixture.baseUrl, '/api/books', {
    type: 'physical',
    title: BOOKS[0].title,
    author: BOOKS[0].author,
    categories: 'coh',
  });

  for (const book of BOOKS) {
    // Reuse the first book rather than creating it twice.
    const bookId =
      book === BOOKS[0]
        ? firstBook.id
        : (
            await apiPost<{ id: string }>(fixture.baseUrl, '/api/books', {
              type: 'physical',
              title: book.title,
              author: book.author,
              categories: 'coh',
            })
          ).id;

    for (const note of book.notes) {
      await apiPost(fixture.baseUrl, `/api/books/${bookId}/notes`, {
        content: note.content,
        ...(note.selectedText ? { selectedText: note.selectedText } : {}),
      });
    }
  }

  seed = { bookId: firstBook.id, conceptNames: [], beforeConceptIds };
  return seed;
}

const THEMES = ['light', 'dark'] as const;

for (const theme of THEMES) {
  test(`concept pane with quotes — ${theme}`, async ({ browser }) => {
    const fixture = loadFixture();
    await ensureSeed(fixture);

    const { context, page } = await newCapturePage(browser, DESKTOP_VIEWPORT);
    try {
      await page.goto(`${fixture.baseUrl}/second-brain`, { waitUntil: 'domcontentloaded' });
      await page.locator('.index-item').first().waitFor({ timeout: 30_000 });
      await page.evaluate((t) => {
        document.documentElement.setAttribute('data-theme', t);
        try {
          localStorage.setItem('nostos.theme', t);
        } catch {
          /* ignore */
        }
      }, theme);
      await page.locator('.index-item').first().click();
      await page.locator('.note-card').first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(600);

      // A quote must actually be on screen for this capture to mean anything.
      const quotes = await page.locator('.note-quote').count();
      console.log(`QUOTES RENDERED (${theme}):`, quotes);
      expect(quotes, 'seeded quote notes must render quotes').toBeGreaterThan(0);

      await capturePng(page, `brain-cohesion-quotes-${theme}`);
    } finally {
      await context.close();
    }
  });

  test(`index list on mobile — ${theme}`, async ({ browser }) => {
    const fixture = loadFixture();
    await ensureSeed(fixture);

    const { context, page } = await newCapturePage(browser, MOBILE_VIEWPORT, true);
    try {
      await page.goto(`${fixture.baseUrl}/second-brain`, { waitUntil: 'domcontentloaded' });
      await page.locator('.index-item').first().waitFor({ timeout: 30_000 });
      await page.evaluate((t) => {
        document.documentElement.setAttribute('data-theme', t);
        try {
          localStorage.setItem('nostos.theme', t);
        } catch {
          /* ignore */
        }
      }, theme);
      await page.waitForTimeout(400);
      await capturePng(page, `brain-cohesion-index-mobile-${theme}`);
    } finally {
      await context.close();
    }
  });
}

test.afterAll(async () => {
  if (!seed) return;
  const fixture = loadFixture();
  await cleanupBrain(fixture.baseUrl, seed);
});
